import { join } from "node:path";

import { findManualKeepConflicts } from "../contract/manual-keeps.js";
import type { GrantTraceContract } from "../contract/schema.js";
import {
  readContractWithMetadata,
  writeContractAtomic,
} from "../contract/serialize.js";
import { assignmentKey } from "../permissions/canonical.js";
import { MANDATORY_INSTALLATION_PERMISSIONS } from "../proof/permission-baseline.js";
import {
  acquireLocalOperationLock,
  LocalOperationLockError,
  type LocalOperationLock,
} from "../security/local-state.js";
import type { CliContext } from "./context.js";
import { writeLine } from "./context.js";
import { ExitCode, type ExitCodeValue } from "./exit-codes.js";
import {
  isContinuousIntegration,
  renderCiContractMutationRefused,
} from "./ci-environment.js";

type FrontierOperation =
  | { kind: "list" }
  | { index: number; kind: "select" };

type FrontierExecution = {
  code: ExitCodeValue;
  destination: "stderr" | "stdout";
  text: string;
};

export async function runFrontier(
  args: string[],
  context: CliContext,
): Promise<ExitCodeValue> {
  if (
    args.length === 0 ||
    (args.length === 1 && (args[0] === "--help" || args[0] === "-h"))
  ) {
    writeLine(context.stdout, helpText());
    return ExitCode.success;
  }

  const operation = parseOperation(args);
  if (operation === null) {
    writeLine(context.stderr, helpText());
    return ExitCode.usage;
  }

  if (
    operation.kind === "select" &&
    isContinuousIntegration(context.environment)
  ) {
    writeLine(
      context.stderr,
      renderCiContractMutationRefused("frontier selection"),
    );
    return ExitCode.usage;
  }

  const lockPath = join(context.cwd, "granttrace.lock.json");
  let operationLock: LocalOperationLock | null = null;
  let execution = frontierExecution(
    ExitCode.analysisFailure,
    "stderr",
    "GrantTrace frontier failed: contract processing did not complete.",
  );
  try {
    if (operation.kind === "select") {
      operationLock = await (
        context.frontierDependencies?.acquireOperationLock ??
        acquireLocalOperationLock
      )(context.cwd);
    }

    const loaded = await readContractWithMetadata(lockPath);
    if (operation.kind === "select" && loaded.migrations.length > 0) {
      execution = frontierExecution(
        ExitCode.contractChanged,
        "stderr",
        [
          "GrantTrace frontier blocked",
          "",
          "The accepted contract is not schema v3.",
          "",
          "Next",
          "  Re-record if needed, review granttrace check, then run:",
          "  granttrace check --accept",
          "",
        ].join("\n"),
      );
    } else {
      execution = await executeFrontierOperation(
        operation,
        loaded.contract,
        lockPath,
      );
    }
  } catch (error) {
    if (error instanceof LocalOperationLockError) {
      execution = frontierExecution(
        ExitCode.analysisFailure,
        "stderr",
        [
          "GrantTrace frontier blocked",
          "",
          "Another GrantTrace operation is active or left a stale lock.",
          "",
          "Next",
          "  Run granttrace doctor and inspect local session state before retrying.",
          "",
        ].join("\n"),
      );
    } else {
      execution = frontierExecution(
        ExitCode.analysisFailure,
        "stderr",
        [
          "GrantTrace frontier failed",
          "",
          "GrantTrace could not read or update granttrace.lock.json.",
          "",
          "Next",
          "  Create or validate granttrace.lock.json with granttrace check.",
          "",
        ].join("\n"),
      );
    }
  }

  if (operationLock !== null) {
    try {
      await operationLock.release();
    } catch {
      writeLine(
        context.stderr,
        [
          "GrantTrace frontier cleanup failed",
          "",
          "The contract update may have completed, but the operation lock could not be removed.",
          "Inspect .granttrace/active-operation and validate the contract before retrying.",
          "",
        ].join("\n"),
      );
      return ExitCode.analysisFailure;
    }
  }
  writeLine(context[execution.destination], execution.text);
  return execution.code;
}

async function executeFrontierOperation(
  operation: FrontierOperation,
  contract: GrantTraceContract,
  lockPath: string,
): Promise<FrontierExecution> {
  if (operation.kind === "list") {
    return frontierExecution(
      ExitCode.success,
      "stdout",
      renderFrontier(contract),
    );
  }

  const selected = contract.permissionFrontier[operation.index - 1];
  if (selected === undefined) {
    return frontierExecution(
      ExitCode.usage,
      "stderr",
      `GrantTrace frontier usage error: choose a candidate from 1 to ${contract.permissionFrontier.length}.`,
    );
  }

  const next = { ...contract, selectedPermissions: selected };
  const conflicts = findManualKeepConflicts(
    next,
    selected,
    MANDATORY_INSTALLATION_PERMISSIONS,
  );
  if (conflicts.length > 0) {
    return frontierExecution(
      ExitCode.usage,
      "stderr",
      [
        "GrantTrace frontier selection blocked",
        "",
        "The candidate duplicates access already recorded as a manual keep:",
        ...conflicts.map((conflict) => `  ${conflict.permission}`),
        "",
        "Next",
        "  Remove the conflicting manual keep only if the frontier candidate should replace it.",
        "",
      ].join("\n"),
    );
  }

  if (
    assignmentKey(contract.selectedPermissions) === assignmentKey(selected)
  ) {
    return frontierExecution(
      ExitCode.success,
      "stdout",
      [
        "Permission frontier selection unchanged",
        "",
        `  Candidate ${operation.index} is already selected.`,
        "",
      ].join("\n"),
    );
  }

  await writeContractAtomic(lockPath, next);
  return frontierExecution(
    ExitCode.success,
    "stdout",
    [
      "Permission frontier selection updated",
      "",
      "Previous selection",
      ...renderAssignment(contract.selectedPermissions).map(
        (line) => `  ${line}`,
      ),
      "",
      "Selected assignment",
      `  Candidate ${operation.index} of ${contract.permissionFrontier.length}`,
      ...renderAssignment(selected).map((line) => `  ${line}`),
      "",
      "Next",
      "  Review and commit the granttrace.lock.json diff.",
      "",
    ].join("\n"),
  );
}

function frontierExecution(
  code: ExitCodeValue,
  destination: FrontierExecution["destination"],
  text: string,
): FrontierExecution {
  return { code, destination, text };
}

function parseOperation(args: string[]): FrontierOperation | null {
  if (args.length === 1 && args[0] === "list") {
    return { kind: "list" };
  }
  if (args.length !== 2 || args[0] !== "select") {
    return null;
  }
  const value = args[1];
  if (value === undefined || !/^[1-9]\d*$/u.test(value)) {
    return null;
  }
  const index = Number(value);
  return Number.isSafeInteger(index) ? { kind: "select", index } : null;
}

function renderFrontier(contract: {
  permissionFrontier: Array<Record<string, "read" | "write">>;
  selectedPermissions: Record<string, "read" | "write">;
}): string {
  const selectedKey = assignmentKey(contract.selectedPermissions);
  const lines = [
    "Permission frontier (complete sufficient assignments)",
    "",
  ];
  contract.permissionFrontier.forEach((candidate, index) => {
    const marker = assignmentKey(candidate) === selectedKey ? " (selected)" : "";
    lines.push(`  ${index + 1}${marker}`);
    lines.push(...renderAssignment(candidate).map((line) => `    ${line}`));
  });
  lines.push(
    "",
    "To choose a different complete assignment:",
    "  granttrace frontier select <number>",
    "",
  );
  return lines.join("\n");
}

function renderAssignment(
  assignment: Record<string, "read" | "write">,
): string[] {
  const permissions = Object.entries(assignment);
  return permissions.length === 0
    ? ["(none)"]
    : permissions.map(([permission, level]) => `${permission}: ${level}`);
}

function helpText(): string {
  return [
    "List or select a complete permission-frontier assignment",
    "",
    "Usage",
    "  granttrace frontier list",
    "  granttrace frontier select <number>",
    "",
    "Listing is read-only. Selection changes only selectedPermissions in the",
    "accepted contract and must always name an existing numbered candidate.",
    "Selection is refused when CI is enabled.",
    "Review and commit the resulting granttrace.lock.json diff.",
    "",
  ].join("\n");
}

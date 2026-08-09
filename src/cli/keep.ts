import { join } from "node:path";

import { comparePermissionLevels } from "../permissions/canonical.js";
import {
  PermissionLevelSchema,
  PermissionNameSchema,
} from "../permissions/schema.js";
import {
  readContractWithMetadata,
  writeContractAtomic,
} from "../contract/serialize.js";
import type { CliContext } from "./context.js";
import { writeLine } from "./context.js";
import { ExitCode, type ExitCodeValue } from "./exit-codes.js";
import { isSafeReviewText } from "../security/review-text.js";
import {
  acquireLocalOperationLock,
  LocalOperationLockError,
  type LocalOperationLock,
} from "../security/local-state.js";
import {
  isContinuousIntegration,
  renderCiContractMutationRefused,
} from "./ci-environment.js";

type KeepExecution = {
  code: ExitCodeValue;
  destination: "stderr" | "stdout";
  text: string;
};

export async function runKeep(
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

  if (
    (args[0] === "add" || args[0] === "remove") &&
    isContinuousIntegration(context.environment)
  ) {
    writeLine(context.stderr, renderCiContractMutationRefused("keep"));
    return ExitCode.usage;
  }

  const lockPath = join(context.cwd, "granttrace.lock.json");
  let operationLock: LocalOperationLock | null = null;
  let execution = keepExecution(
    ExitCode.analysisFailure,
    "stderr",
    "GrantTrace keep failed: contract processing did not complete.",
  );
  try {
    if (args[0] === "add" || args[0] === "remove") {
      operationLock = await (
        context.keepDependencies?.acquireOperationLock ??
        acquireLocalOperationLock
      )(context.cwd);
    }
    const loaded = await readContractWithMetadata(lockPath);
    if (loaded.migrations.length > 0) {
      execution = keepExecution(
        ExitCode.contractChanged,
        "stderr",
        [
          "GrantTrace keep blocked",
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
      execution = await executeKeepCommand(args, loaded.contract, lockPath);
    }
  } catch (error) {
    if (error instanceof LocalOperationLockError) {
      execution = keepExecution(
        ExitCode.analysisFailure,
        "stderr",
        [
          "GrantTrace keep blocked",
          "",
          "Another GrantTrace operation is active or left a stale lock.",
          "",
          "Next",
          "  Run granttrace doctor and inspect local session state before retrying.",
          "",
        ].join("\n"),
      );
    } else {
      execution = keepExecution(
        ExitCode.analysisFailure,
        "stderr",
        [
          "GrantTrace keep failed",
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
          "GrantTrace keep cleanup failed",
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

async function executeKeepCommand(
  args: string[],
  contract: Awaited<ReturnType<typeof readContractWithMetadata>>["contract"],
  lockPath: string,
): Promise<KeepExecution> {
  if (args[0] === "list" && args.length === 1) {
    const keeps = Object.entries(contract.manualKeeps);
    return keepExecution(
      ExitCode.success,
      "stdout",
      [
        "Manual keeps (retained, not proven necessary)",
        "",
        ...(keeps.length === 0
          ? ["  (none)"]
          : keeps.flatMap(([permission, keep]) => [
              `  ${permission}: ${keep.level}`,
              `    ${keep.reason}`,
            ])),
        "",
      ].join("\n"),
    );
  }

  if (args[0] === "add") {
    const parsed = parseAdd(args.slice(1));
    if (parsed === null) {
      return keepExecution(
        ExitCode.usage,
        "stderr",
        [
          "GrantTrace keep usage error",
          "",
          "Use <permission>:<read|write> and a 1–240 character reason.",
          "Use plain text without secrets, URLs, or personal identifiers.",
          "",
          helpText(),
          "",
        ].join("\n"),
      );
    }
    if (parsed.permission === "metadata") {
      return keepExecution(
        ExitCode.usage,
        "stderr",
        "GrantTrace keep blocked: metadata:read is already modeled as GitHub's mandatory baseline.",
      );
    }
    const observed = contract.selectedPermissions[parsed.permission];
    if (
      observed !== undefined &&
      comparePermissionLevels(observed, parsed.level) >= 0
    ) {
      return keepExecution(
        ExitCode.usage,
        "stderr",
        "GrantTrace keep blocked: the accepted scenarios already select that access level.",
      );
    }
    const previous = contract.manualKeeps[parsed.permission];
    const next = {
      ...contract,
      manualKeeps: {
        ...contract.manualKeeps,
        [parsed.permission]: {
          level: parsed.level,
          reason: parsed.reason,
        },
      },
    };
    await writeContractAtomic(lockPath, next);
    return keepExecution(
      ExitCode.success,
      "stdout",
      [
        previous === undefined ? "Manual keep added" : "Manual keep updated",
        "",
        `  ${parsed.permission}: ${parsed.level}`,
        `  Reason: ${parsed.reason}`,
        "",
        "Meaning",
        "  This permission will be requested during live proof, but GrantTrace",
        "  will not call it observed or proven necessary.",
        "",
        "Next",
        "  Review and commit granttrace.lock.json.",
        "",
      ].join("\n"),
    );
  }

  if (args[0] === "remove") {
    if (args.length !== 2) {
      return keepExecution(ExitCode.usage, "stderr", helpText());
    }
    const permission = PermissionNameSchema.safeParse(args[1]);
    if (!permission.success) {
      return keepExecution(ExitCode.usage, "stderr", helpText());
    }
    if (contract.manualKeeps[permission.data] === undefined) {
      return keepExecution(
        ExitCode.usage,
        "stderr",
        `GrantTrace keep failed: no manual keep exists for ${permission.data}.`,
      );
    }
    const manualKeeps = { ...contract.manualKeeps };
    delete manualKeeps[permission.data];
    await writeContractAtomic(lockPath, { ...contract, manualKeeps });
    return keepExecution(
      ExitCode.success,
      "stdout",
      [
        "Manual keep removed",
        "",
        `  ${permission.data}`,
        "",
        "Meaning",
        "  Future live proofs will no longer request this unproven access.",
        "",
        "Next",
        "  Review and commit granttrace.lock.json.",
        "",
      ].join("\n"),
    );
  }

  return keepExecution(ExitCode.usage, "stderr", helpText());
}

function keepExecution(
  code: ExitCodeValue,
  destination: KeepExecution["destination"],
  text: string,
): KeepExecution {
  return { code, destination, text };
}

function parseAdd(args: string[]): {
  permission: string;
  level: "read" | "write";
  reason: string;
} | null {
  if (args.length !== 3 || args[1] !== "--reason") {
    return null;
  }
  const [permissionInput, levelInput, extra] = (args[0] ?? "").split(":");
  if (extra !== undefined) {
    return null;
  }
  const permission = PermissionNameSchema.safeParse(permissionInput);
  const level = PermissionLevelSchema.safeParse(levelInput);
  const reason = args[2]?.trim() ?? "";
  if (
    !permission.success ||
    !level.success ||
    !isSafeReviewText(reason)
  ) {
    return null;
  }
  return {
    permission: permission.data,
    level: level.data,
    reason,
  };
}

function helpText(): string {
  return [
    "Manage explicitly retained, unproven permissions",
    "",
    "Usage",
    "  granttrace keep add <permission>:<read|write> --reason <text>",
    "  granttrace keep remove <permission>",
    "  granttrace keep list",
    "",
    "Manual keeps are requested in live tokens but are never reported as",
    "observed or proven necessary. Every keep requires a committed,",
    "identity-free and secret-free human reason.",
    "Adding or removing a keep is refused when CI is enabled.",
    "",
  ].join("\n");
}

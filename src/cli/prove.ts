import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { readContractWithMetadata } from "../contract/serialize.js";
import { ScenarioNameSchema } from "../permissions/schema.js";
import type { ProofFailure } from "../proof/failure.js";
import { LiveFixtureConfig } from "../proof/live-config.js";
import { executeProof } from "../proof/orchestrator.js";
import { validateAcceptedProofContract } from "../proof/contract-verification.js";
import {
  writeProofReport,
  type ProofRunReport,
} from "../proof/report.js";
import type { CliContext } from "./context.js";
import { writeLine } from "./context.js";
import { ExitCode, type ExitCodeValue } from "./exit-codes.js";
import { parseScenarioCommand } from "./scenario-command.js";
import { formatDuration } from "./duration.js";
import {
  acquireLocalOperationLock,
  ensurePrivateStateSubdirectory,
  inspectLocalState,
  type LocalOperationLock,
  stateIgnorePresent,
} from "../security/local-state.js";

const MAX_PROOF_TIMEOUT_MS = 30 * 60 * 1_000;

const execFileAsync = promisify(execFile);

export async function runProve(
  args: string[],
  context: CliContext,
): Promise<ExitCodeValue> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    writeLine(
      context.stdout,
      [
        "Prove one accepted scenario with a restricted installation token",
        "",
        "Usage",
        "  granttrace prove <name> [--timeout 15m] -- <command> [args...]",
        "  granttrace prove --scenario <name> ...  (legacy)",
        "",
        "The child receives the restricted token, not App broker credentials.",
        "The proof is scoped to the named scenario and disposable fixture.",
        "",
        "Prerequisites",
        "  granttrace doctor",
        "",
      ].join("\n"),
    );
    return ExitCode.success;
  }
  const parsedResult = parseScenarioCommand(args, MAX_PROOF_TIMEOUT_MS);
  if (!parsedResult.success) {
    writeLine(
      context.stderr,
      [
        `GrantTrace prove usage error: ${parsedResult.message}`,
        "",
        "Usage",
        "  granttrace prove <name> [--timeout 15m] -- <command> [args...]",
        "",
      ].join("\n"),
    );
    return ExitCode.usage;
  }
  const parsed = parsedResult.value;

  const scenarioResult = ScenarioNameSchema.safeParse(parsed.scenario);
  if (!scenarioResult.success) {
    writeLine(
      context.stderr,
      "GrantTrace prove failed: scenario names must use lowercase letters, numbers, hyphens, or underscores.",
    );
    return ExitCode.usage;
  }
  if (process.platform === "win32") {
    writeLine(
      context.stderr,
      [
        "GrantTrace prove blocked",
        "",
        "Live proof is not supported on Windows because GrantTrace cannot verify termination of an arbitrary descendant process tree.",
        "",
        "Next",
        "  Run live proof from a disposable Unix-like environment.",
        "",
      ].join("\n"),
    );
    return ExitCode.analysisFailure;
  }

  try {
    const state = await inspectLocalState(context.cwd);
    if (
      !state.ready ||
      state.staleSessions > 0 ||
      !(await stateIgnorePresent(context.cwd))
    ) {
      writeLine(
        context.stderr,
        [
          "GrantTrace prove blocked",
          "",
          "Private ignored local state is required before live proof.",
          "",
          "Next",
          "  granttrace init",
          "  granttrace doctor",
          "",
        ].join("\n"),
      );
      return ExitCode.analysisFailure;
    }
    await ensurePrivateStateSubdirectory(context.cwd, "reports");
    let operationLock: LocalOperationLock;
    try {
      operationLock = await acquireLocalOperationLock(context.cwd);
    } catch {
      writeLine(
        context.stderr,
        [
          "GrantTrace prove blocked",
          "",
          "Another GrantTrace operation is active or left a stale lock.",
          "",
          "Next",
          "  Run granttrace doctor and inspect local session state before retrying.",
          "",
        ].join("\n"),
      );
      return ExitCode.analysisFailure;
    }
    try {
      const loaded = await readContractWithMetadata(
        join(context.cwd, "granttrace.lock.json"),
      );
      if (loaded.migrations.length > 0) {
        writeLine(
          context.stderr,
          [
            "GrantTrace prove blocked",
            "",
            "This accepted contract is not schema v3.",
            "",
            "Next",
            "  Re-record the scenario if needed, review granttrace check, then run:",
            "  granttrace check --accept",
            "",
          ].join("\n"),
        );
        return ExitCode.contractChanged;
      }
      const contract = loaded.contract;
      try {
        validateAcceptedProofContract(contract, scenarioResult.data);
      } catch {
        writeLine(
          context.stderr,
          [
            "GrantTrace prove blocked",
            "",
            "The accepted contract does not exactly match the named scenario and current pinned catalog.",
            "",
            "Next",
            "  Record the scenario, review granttrace check, then run:",
            "  granttrace check --accept",
            "",
          ].join("\n"),
        );
        return ExitCode.contractChanged;
      }
      let config: LiveFixtureConfig | null = null;
      try {
        config = (
          context.loadLiveFixtureConfig ?? LiveFixtureConfig.load
        )(context.environment);
      } catch {
        config = null;
      }
      const sourceCommit =
        context.proofDependencies !== undefined &&
        "sourceCommit" in context.proofDependencies
          ? (context.proofDependencies.sourceCommit ?? null)
          : await readSourceCommit(context.cwd);
      writeLine(
        context.stdout,
        [
        "Proof started",
          `  Scenario  ${scenarioResult.data}`,
          `  Timeout   ${formatDuration(parsed.timeoutMs)}`,
          "",
        ].join("\n"),
      );
      const result = await executeProof({
        config,
        contract,
        scenario: scenarioResult.data,
        cwd: context.cwd,
        command: parsed.command,
        args: parsed.commandArgs,
        baseEnvironment: context.environment,
        timeoutMs: parsed.timeoutMs,
        dependencies: {
          ...context.proofDependencies,
          sourceCommit,
        },
      });
      const reportPath = join(
        context.cwd,
        ".granttrace",
        "reports",
        `${scenarioResult.data}.json`,
      );
      await writeProofReport(
        reportPath,
        result.report,
      );

      if (result.success) {
        writeLine(
          context.stdout,
          renderProofSuccess(result.report, scenarioResult.data),
        );
        return ExitCode.success;
      }
      writeLine(
        context.stderr,
        renderProofFailure(result.report, scenarioResult.data),
      );
      return exitCodeForReport(result.report);
    } finally {
      await operationLock.release();
    }
  } catch {
    writeLine(
      context.stderr,
      "GrantTrace prove failed: the accepted contract or proof report is invalid.",
    );
    return ExitCode.analysisFailure;
  }
}

export async function readSourceCommit(cwd: string): Promise<string | null> {
  try {
    const status = await execFileAsync(
      "git",
      [
        "status",
        "--porcelain=v1",
        "--untracked-files=normal",
        "--ignore-submodules=none",
      ],
      {
        cwd,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      },
    );
    if (status.stdout.length !== 0) {
      return null;
    }

    const result = await execFileAsync(
      "git",
      ["rev-parse", "--verify", "HEAD"],
      {
        cwd,
        encoding: "utf8",
        maxBuffer: 1_024,
      },
    );
    const commit = result.stdout.trim();
    return /^[a-f0-9]{7,64}$/u.test(commit) ? commit : null;
  } catch {
    return null;
  }
}

function renderProofSuccess(
  report: ProofRunReport,
  scenario: string,
): string {
  return [
    "GrantTrace prove passed",
    "",
    `Scenario    ${report.scenario}`,
    `Observed    ${report.child.observedOperations} GitHub REST operation${
      report.child.observedOperations === 1 ? "" : "s"
    }`,
    `Strength    ${proofStrengthLabel(report.proofStrength)}`,
    `Report      .granttrace/reports/${scenario}.json`,
    "",
    "Negative controls",
    ...renderNegativeStatuses(report),
    "",
    "Permission contract",
    ...renderPermissions(report.selectedPermissions),
    "",
    "Manual keeps (retained, not proven necessary)",
    ...renderPermissions(
      Object.fromEntries(
        Object.entries(report.manualKeeps).map(([permission, keep]) => [
          permission,
          keep.level,
        ]),
      ),
    ),
    "",
    "Mandatory effective baseline",
    ...renderPermissions(report.mandatoryPermissions),
    "",
    "Coverage",
    "  This proof covers only REST operations exercised by this scenario.",
    "",
  ].join("\n");
}

function renderProofFailure(
  report: ProofRunReport,
  scenario: string,
): string {
  return [
    "GrantTrace prove failed",
    "",
    `Positive    ${renderPositiveStatus(report)}`,
    `Cleanup     ${statusLabel(report.cleanup.status)}`,
    `Strength    ${proofStrengthLabel(report.proofStrength)}`,
    `Report      .granttrace/reports/${scenario}.json`,
    "",
    "Negative controls",
    ...renderNegativeStatuses(report),
    "",
    "No permission claim was made.",
    "",
    "Next",
    `  ${proofRecovery(report)}`,
    "",
  ].join("\n");
}

function renderPermissions(
  permissions: Record<string, string>,
): string[] {
  const entries = Object.entries(permissions);
  return entries.length === 0
    ? ["  (none)"]
    : entries.map(([permission, level]) => `  ${permission}: ${level}`);
}

function renderPositiveStatus(report: ProofRunReport): string {
  return report.positiveProof.status === "failed"
    ? `Failed (${statusLabel(report.positiveProof.failure)})`
    : statusLabel(report.positiveProof.status);
}

function renderNegativeStatuses(report: ProofRunReport): string[] {
  return report.negativeControls.map((control) =>
    control.status === "indeterminate"
      ? `  ${controlLabel(control.id)}: ${statusLabel(control.status)} (${statusLabel(control.failure)})`
      : `  ${controlLabel(control.id)}: ${statusLabel(control.status)}`,
  );
}

function controlLabel(id: string): string {
  switch (id) {
    case "issue-comment-create":
      return "Issue comment creation";
    case "issue-comments-read":
      return "Issue comment reading";
    default:
      return statusLabel(id);
  }
}

function statusLabel(value: string | undefined): string {
  if (value === undefined) {
    return "Unknown";
  }
  const overrides: Record<string, string> = {
    github_unavailable: "GitHub unavailable",
    not_applicable: "Not applicable",
    not_required: "Not required",
    not_run: "Not run",
    expected_rejection: "Rejected as expected",
    unexpected_pass: "Unexpectedly succeeded",
  };
  return (
    overrides[value] ??
    value
      .split("_")
      .map((word) => word[0]?.toUpperCase() + word.slice(1))
      .join(" ")
  );
}

function proofStrengthLabel(
  strength: ProofRunReport["proofStrength"],
): string {
  switch (strength) {
    case "not_established":
      return "Not established";
    case "restricted_scope_reproduced":
      return "Restricted scope reproduced";
    case "necessity_partially_tested":
      return "Necessity partially tested (permission-name removal)";
    case "necessity_tested":
      return "Necessity tested (permission-name removal)";
  }
}

function proofRecovery(report: ProofRunReport): string {
  if (report.cleanup.status === "failed") {
    return "Verify the disposable fixture has no mutation residue before retrying.";
  }
  if (report.positiveProof.status === "failed") {
    switch (report.positiveProof.failure) {
      case "configuration_failure":
        return "Run granttrace doctor, then correct the disposable live configuration.";
      case "contract_mismatch":
        return "Re-record this scenario, run granttrace check, and review the diff.";
      case "instrumentation_failure":
        return "Ensure the scenario uses the instrumented GrantTrace Octokit instance.";
      case "test_failure":
      case "test_flake_or_indeterminate":
        return "Fix or stabilize the scenario, then retry the same proof.";
      case "rate_limited":
        return "Wait for the documented GitHub rate-limit window, then retry.";
      default:
        return "Resolve the reported proof failure without broadening permissions, then retry.";
    }
  }
  if (
    report.negativeControls.some(
      (control) => control.status === "unexpected_pass",
    )
  ) {
    return "Do not accept the claim; investigate why reduced access still succeeded.";
  }
  return "Resolve the reported negative-control failure, then retry unchanged.";
}

function exitCodeForReport(report: ProofRunReport): ExitCodeValue {
  if (
    report.child.signal !== null &&
    report.positiveProof.status === "failed" &&
    report.positiveProof.failure === "test_failure"
  ) {
    return ExitCode.interrupted;
  }
  if (report.cleanup.status === "failed") {
    return ExitCode.proofFailed;
  }
  if (report.positiveProof.status !== "failed") {
    return ExitCode.proofFailed;
  }
  const failure = report.positiveProof.failure;
  if (failure === "configuration_failure") {
    return ExitCode.analysisFailure;
  }
  if (failure === "instrumentation_failure") {
    return ExitCode.instrumentation;
  }
  if (failure === "test_failure") {
    return ExitCode.testFailure;
  }
  return proofFailureExitCode(failure);
}

function proofFailureExitCode(_failure: ProofFailure): ExitCodeValue {
  return ExitCode.proofFailed;
}

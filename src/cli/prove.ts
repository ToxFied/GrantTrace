import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { readContractWithMetadata } from "../contract/serialize.js";
import { ScenarioNameSchema } from "../permissions/schema.js";
import type { ProofFailure } from "../proof/failure.js";
import { LiveFixtureConfig } from "../proof/live-config.js";
import { executeProof } from "../proof/orchestrator.js";
import {
  writeProofReport,
  type ProofRunReport,
} from "../proof/report.js";
import type { CliContext } from "./context.js";
import { writeLine } from "./context.js";
import { ExitCode, type ExitCodeValue } from "./exit-codes.js";
import { parseBoundedDuration } from "./duration.js";

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
        "  granttrace prove --scenario <safe-name> [--timeout 15m] -- <command> [args...]",
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
  const parsed = parseProveArguments(args);
  if (parsed === null) {
    writeLine(
      context.stderr,
      "Usage: granttrace prove --scenario <safe-name> [--timeout 15m] -- <command> [args...]",
    );
    return ExitCode.usage;
  }

  const scenarioResult = ScenarioNameSchema.safeParse(parsed.scenario);
  if (!scenarioResult.success) {
    writeLine(
      context.stderr,
      "GrantTrace prove failed: scenario names must use lowercase letters, numbers, hyphens, or underscores.",
    );
    return ExitCode.usage;
  }

  try {
    const loaded = await readContractWithMetadata(
      join(context.cwd, "granttrace.lock.json"),
    );
    if (loaded.migratedFromV1) {
      writeLine(
        context.stderr,
        [
          "GrantTrace prove blocked",
          "",
          "Schema v1 contracts do not contain exact route-to-scenario attribution.",
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
    let config: LiveFixtureConfig | null = null;
    try {
      config = LiveFixtureConfig.load(context.environment);
    } catch {
      config = null;
    }
    const sourceCommit =
      context.proofDependencies !== undefined &&
      "sourceCommit" in context.proofDependencies
        ? (context.proofDependencies.sourceCommit ?? null)
        : await readSourceCommit(context.cwd);
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
  } catch {
    writeLine(
      context.stderr,
      "GrantTrace prove failed: the accepted contract or proof report could not be validated safely.",
    );
    return ExitCode.analysisFailure;
  }
}

function parseProveArguments(args: string[]):
  | {
      scenario: string;
      command: string;
      commandArgs: string[];
      timeoutMs: number;
    }
  | null {
  const separator = args.indexOf("--");
  if (separator < 0 || separator === args.length - 1) {
    return null;
  }
  const options = args.slice(0, separator);
  let scenario: string | null = null;
  let timeoutMs = 15 * 60 * 1_000;
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    const value = options[index + 1];
    if (option === "--scenario" && scenario === null && value !== undefined) {
      scenario = value;
      index += 1;
      continue;
    }
    if (option === "--timeout" && value !== undefined) {
      const parsed = parseBoundedDuration(value, {
        minimumMs: 1_000,
        maximumMs: 60 * 60 * 1_000,
      });
      if (parsed === null) {
        return null;
      }
      timeoutMs = parsed;
      index += 1;
      continue;
    }
    return null;
  }
  const command = args[separator + 1];
  if (scenario === null || command === undefined || command.length === 0) {
    return null;
  }
  return {
    scenario,
    command,
    commandArgs: args.slice(separator + 2),
    timeoutMs,
  };
}

async function readSourceCommit(cwd: string): Promise<string | null> {
  try {
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
    `Cleanup     ${report.cleanup.status}`,
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
    ? `failed (${report.positiveProof.failure})`
    : report.positiveProof.status;
}

function renderNegativeStatuses(report: ProofRunReport): string[] {
  return report.negativeControls.map((control) =>
    control.status === "indeterminate"
      ? `  ${control.id}: ${control.status} (${control.failure})`
      : `  ${control.id}: ${control.status}`,
  );
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

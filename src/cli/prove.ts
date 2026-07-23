import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { readContract } from "../contract/serialize.js";
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

const execFileAsync = promisify(execFile);

export async function runProve(
  args: string[],
  context: CliContext,
): Promise<ExitCodeValue> {
  const parsed = parseProveArguments(args);
  if (parsed === null) {
    writeLine(
      context.stderr,
      "Usage: granttrace prove --scenario <safe-name> -- <command> [args...]",
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
    const contract = await readContract(
      join(context.cwd, "granttrace.lock.json"),
    );
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
      dependencies: {
        ...context.proofDependencies,
        sourceCommit,
      },
    });
    await writeProofReport(
      join(context.cwd, ".granttrace", "report.json"),
      result.report,
    );

    if (result.success) {
      writeLine(context.stdout, renderProofSuccess(result.report));
      return ExitCode.success;
    }
    writeLine(context.stderr, renderProofFailure(result.report));
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
    }
  | null {
  const separator = args.indexOf("--");
  if (separator < 0 || separator === args.length - 1) {
    return null;
  }
  const options = args.slice(0, separator);
  if (
    options.length !== 2 ||
    options[0] !== "--scenario" ||
    options[1] === undefined
  ) {
    return null;
  }
  const command = args[separator + 1];
  if (command === undefined || command.length === 0) {
    return null;
  }
  return {
    scenario: options[1],
    command,
    commandArgs: args.slice(separator + 2),
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

function renderProofSuccess(report: ProofRunReport): string {
  return [
    "GrantTrace prove passed",
    "",
    `Scenario    ${report.scenario}`,
    `Observed    ${report.child.observedOperations} GitHub REST operation${
      report.child.observedOperations === 1 ? "" : "s"
    }`,
    `Negative    ${renderNegativeStatus(report)}`,
    `Report      .granttrace/report.json`,
    "",
    "Permission contract",
    ...renderPermissions(report.selectedPermissions),
    "",
    "Mandatory effective baseline",
    ...renderPermissions(report.mandatoryPermissions),
    "",
    "Coverage",
    "  This proof covers only REST operations exercised by this scenario.",
    "",
  ].join("\n");
}

function renderProofFailure(report: ProofRunReport): string {
  return [
    "GrantTrace prove failed",
    "",
    `Positive    ${renderPositiveStatus(report)}`,
    `Negative    ${renderNegativeStatus(report)}`,
    `Cleanup     ${report.cleanup.status}`,
    `Report      .granttrace/report.json`,
    "",
    "No permission claim was made.",
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

function renderNegativeStatus(report: ProofRunReport): string {
  return report.negativeControl.status === "indeterminate"
    ? `indeterminate (${report.negativeControl.failure})`
    : report.negativeControl.status;
}

function exitCodeForReport(report: ProofRunReport): ExitCodeValue {
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

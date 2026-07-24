import {
  access,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  loadObservations,
  writeObservations,
} from "../contract/observation-file.js";
import type { Observation } from "../contract/observation.js";
import { ScenarioNameSchema } from "../permissions/schema.js";
import { renderInstrumentationError } from "../reporting/terminal.js";
import { injectRuntimePreload } from "../runtime/injection.js";
import type { CliContext } from "./context.js";
import { writeLine } from "./context.js";
import { ExitCode, type ExitCodeValue } from "./exit-codes.js";
import { runCheck } from "./check.js";
import {
  ensureStateIsIgnored,
  initializeProjectState,
} from "./init.js";
import { parseScenarioCommand } from "./scenario-command.js";
import { formatDuration } from "./duration.js";
import { runManagedChild } from "../security/managed-child.js";
import {
  acquireLocalOperationLock,
  ensurePrivateStateSubdirectory,
  inspectLocalState,
  type LocalOperationLock,
  stateIgnorePresent,
} from "../security/local-state.js";

export async function runRecord(
  args: string[],
  context: CliContext,
): Promise<ExitCodeValue> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    writeLine(
      context.stdout,
      [
        "Record one named test scenario",
        "",
        "Usage",
        "  granttrace record <name> [--timeout 15m] -- <command> [args...]",
        "  granttrace record --scenario <name> ...  (legacy)",
        "",
        "GrantTrace prepares local state, automatically observes standard Node",
        "GitHub REST traffic, and presents the resulting contract for review.",
        "In an interactive terminal, confirm with y to accept it.",
        "",
        "The command runs directly without a shell. Output is streamed;",
        "request and response bodies are never retained by GrantTrace.",
        "",
        "Use --no-review only when a later granttrace check is guaranteed.",
        "",
      ].join("\n"),
    );
    return ExitCode.success;
  }
  const reviewOptions = parseReviewOptions(args);
  if (reviewOptions === null) {
    writeLine(
      context.stderr,
      "GrantTrace record usage error: provide --no-review at most once before --.",
    );
    return ExitCode.usage;
  }
  const parsedResult = parseScenarioCommand(
    reviewOptions.args,
    60 * 60 * 1_000,
  );
  if (!parsedResult.success) {
    writeLine(
      context.stderr,
      [
        `GrantTrace record usage error: ${parsedResult.message}`,
        "",
        "Usage",
        "  granttrace record <name> [--timeout 15m] -- <command> [args...]",
        "",
      ].join("\n"),
    );
    return ExitCode.usage;
  }
  const parsed = parsedResult.value;

  let scenario: string;
  try {
    scenario = ScenarioNameSchema.parse(parsed.scenario);
  } catch {
    writeLine(
      context.stderr,
      "GrantTrace record failed: scenario names must use lowercase letters, numbers, hyphens, or underscores.",
    );
    return ExitCode.usage;
  }

  let state = await inspectLocalState(context.cwd);
  let initialized = false;
  try {
    if (state.issue === "missing") {
      await initializeProjectState(context.cwd);
      initialized = true;
      state = await inspectLocalState(context.cwd);
    } else if (
      state.ready &&
      state.staleSessions === 0 &&
      !(await stateIgnorePresent(context.cwd))
    ) {
      await ensureStateIsIgnored(context.cwd);
      initialized = true;
    }
  } catch {
    writeLine(
      context.stderr,
      [
        "GrantTrace record blocked",
        "",
        "Private ignored local state could not be prepared safely.",
        "",
        "Next",
        "  Run granttrace init for details.",
        "  Run granttrace doctor after correcting the local state.",
        "",
      ].join("\n"),
    );
    return ExitCode.analysisFailure;
  }

  if (
    !state.ready ||
    state.staleSessions > 0 ||
    !(await stateIgnorePresent(context.cwd))
  ) {
    writeLine(
      context.stderr,
      [
        "GrantTrace record blocked",
        "",
        "Private ignored local state is required before a child can run.",
        "",
        "Next",
        "  granttrace init",
        "  granttrace doctor",
        "",
      ].join("\n"),
    );
    return ExitCode.analysisFailure;
  }

  if (initialized) {
    writeLine(
      context.stdout,
      [
        "GrantTrace initialized",
        "  Local state  .granttrace/ (private, ignored)",
        "",
      ].join("\n"),
    );
  }

  const stateDirectory = join(context.cwd, ".granttrace");
  let sessionsDirectory: string;
  try {
    sessionsDirectory = await ensurePrivateStateSubdirectory(
      context.cwd,
      "sessions",
    );
  } catch {
    writeLine(
      context.stderr,
      "GrantTrace record blocked: local session state is unsafe.",
    );
    return ExitCode.analysisFailure;
  }
  let operationLock: LocalOperationLock;
  try {
    operationLock = await acquireLocalOperationLock(context.cwd);
  } catch {
    writeLine(
      context.stderr,
      [
        "GrantTrace record blocked",
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
  let sessionDirectory: string | null = null;
  let resultCode: ExitCodeValue = ExitCode.analysisFailure;
  let pendingObservations: Observation[] | null = null;
  let output: { destination: "stderr" | "stdout"; message: string } | null =
    null;

  try {
    sessionDirectory = await mkdtemp(join(sessionsDirectory, "session-"));

    const childEnvironment = createChildEnvironment(
      context.environment,
      scenario,
      sessionDirectory,
    );
    writeLine(
      context.stdout,
      [
        "Recording started",
        `  Scenario  ${scenario}`,
        `  Timeout   ${formatDuration(parsed.timeoutMs)}`,
        "",
      ].join("\n"),
    );
    const result = await runManagedChild({
      command: parsed.command,
      args: parsed.commandArgs,
      cwd: context.cwd,
      environment: childEnvironment,
      timeoutMs: parsed.timeoutMs,
    });

    if (result.processTreeCleanupFailed) {
      resultCode = ExitCode.analysisFailure;
      output = {
        destination: "stderr",
        message: [
          "GrantTrace record cleanup failed",
          "",
          "The managed child process tree could not be verified as terminated.",
          "Partial observations were discarded.",
          "",
        ].join("\n"),
      };
    } else if (result.spawnFailed) {
      resultCode = ExitCode.testFailure;
      output = {
        destination: "stderr",
        message: [
          "GrantTrace record failed",
          "",
          "The test process could not be started.",
          "",
          "No contract decision was made.",
          "",
        ].join("\n"),
      };
    } else if (result.interruptedBy !== null) {
      resultCode = ExitCode.interrupted;
      output = {
        destination: "stderr",
        message: [
          "GrantTrace record interrupted",
          "",
          "The terminal interrupted the child. Partial observations were discarded.",
          "",
          "No contract decision was made.",
          "",
        ].join("\n"),
      };
    } else if (result.timedOut) {
      resultCode = ExitCode.testFailure;
      output = {
        destination: "stderr",
        message: [
          "GrantTrace record timed out",
          "",
          "The test process exceeded the configured limit and was terminated.",
          "",
          "No contract decision was made.",
          "",
          "Next",
          "  Fix the hung scenario or retry with --timeout <duration>.",
          "",
        ].join("\n"),
      };
    } else {
      const markerPath = join(sessionDirectory, "plugin-loaded");
      if (!(await pathExists(markerPath))) {
        resultCode = ExitCode.instrumentation;
        output = {
          destination: "stderr",
          message: renderInstrumentationError(),
        };
      } else if (result.exitCode !== 0) {
        resultCode =
          result.signal === null ? ExitCode.testFailure : ExitCode.interrupted;
        output = {
          destination: "stderr",
          message: [
          "GrantTrace record failed",
          "",
          result.signal === null
            ? "The instrumented test process failed."
            : "The instrumented test process was interrupted.",
          "",
          "No contract decision was made.",
          "",
        ].join("\n"),
        };
      } else {
        const observationsPath = join(sessionDirectory, "observations.ndjson");
        if (!(await pathExists(observationsPath))) {
          resultCode = ExitCode.instrumentation;
          output = {
            destination: "stderr",
            message: renderInstrumentationError(),
          };
        } else {
          const observations = await loadObservations(observationsPath);
          if (
            observations.length === 0 ||
            observations.some(
              (observation) => observation.scenario !== scenario,
            )
          ) {
            resultCode = ExitCode.instrumentation;
            output = {
              destination: "stderr",
              message: renderInstrumentationError(),
            };
          } else {
            pendingObservations = observations;
            resultCode = ExitCode.success;
            output = {
              destination: "stdout",
              message: [
                "GrantTrace record complete",
                "",
                `Scenario  ${scenario}`,
                `Observed  ${observations.length} GitHub REST operation${
                  observations.length === 1 ? "" : "s"
                }`,
                "",
                ...(reviewOptions.review
                  ? ["Reviewing the permission contract now.", ""]
                  : ["Next", "  granttrace check", ""]),
                "Coverage",
                "  This recording covers only REST operations exercised by this scenario.",
                "  Recording the same scenario name again replaces its prior recording.",
                "",
              ].join("\n"),
            };
          }
        }
      }
    }
  } catch {
    resultCode = ExitCode.analysisFailure;
    output = {
      destination: "stderr",
      message:
        "GrantTrace record failed: the child process failed or produced an invalid observation file.",
    };
  }

  const cleaned =
    sessionDirectory === null ||
    (await (context.recordDependencies?.removeSession === undefined
      ? rm(sessionDirectory, { recursive: true, force: true })
      : context.recordDependencies.removeSession(sessionDirectory))
      .then(() => true)
      .catch(() => false));
  if (!cleaned) {
    await operationLock.release().catch(() => undefined);
    writeLine(
      context.stderr,
      [
        "GrantTrace record cleanup failed",
        "",
        "No recording was saved because session cleanup failed.",
        "Inspect .granttrace/sessions/ before retrying.",
        "",
      ].join("\n"),
    );
    return ExitCode.analysisFailure;
  }
  if (pendingObservations !== null) {
    try {
      await writeObservations(
        join(stateDirectory, "observations", `${scenario}.ndjson`),
        pendingObservations,
      );
    } catch {
      await operationLock.release().catch(() => undefined);
      writeLine(
        context.stderr,
        "GrantTrace record failed: the observation file could not be saved.",
      );
      return ExitCode.analysisFailure;
    }
  }
  try {
    await operationLock.release();
  } catch {
    writeLine(
      context.stderr,
      [
        "GrantTrace record cleanup failed",
        "",
        "The operation lock could not be removed. Inspect .granttrace/active-operation before retrying.",
        "",
      ].join("\n"),
    );
    return ExitCode.analysisFailure;
  }
  if (output !== null) {
    writeLine(context[output.destination], output.message);
  }
  if (resultCode !== ExitCode.success || !reviewOptions.review) {
    return resultCode;
  }

  const reviewCode = await runCheck([], context, "record");
  if (reviewCode !== ExitCode.contractChanged) {
    return reviewCode;
  }
  if (context.confirm === undefined) {
    return ExitCode.contractChanged;
  }

  let accepted: boolean;
  try {
    accepted = await context.confirm(
      "Accept this permission contract? [y/N] ",
    );
  } catch {
    writeLine(context.stderr, "GrantTrace review interrupted.");
    return ExitCode.interrupted;
  }
  if (!accepted) {
    writeLine(
      context.stdout,
      "Contract not accepted. The recording was saved for later review.",
    );
    return ExitCode.contractChanged;
  }
  return runCheck(["--accept"], context);
}

function createChildEnvironment(
  environment: NodeJS.ProcessEnv,
  scenario: string,
  sessionDirectory: string,
): NodeJS.ProcessEnv {
  const childEnvironment = { ...environment };
  delete childEnvironment["GRANTTRACE_RECORDING"];
  delete childEnvironment["GRANTTRACE_SCENARIO"];
  delete childEnvironment["GRANTTRACE_SESSION_DIR"];

  childEnvironment["GRANTTRACE_RECORDING"] = "1";
  childEnvironment["GRANTTRACE_SCENARIO"] = scenario;
  childEnvironment["GRANTTRACE_SESSION_DIR"] = resolve(sessionDirectory);
  return injectRuntimePreload(childEnvironment);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseReviewOptions(
  args: string[],
): { args: string[]; review: boolean } | null {
  const separator = args.indexOf("--");
  if (separator < 0) {
    return { args, review: true };
  }
  const options = args.slice(0, separator);
  const reviewFlags = options.filter((argument) => argument === "--no-review");
  if (reviewFlags.length > 1) {
    return null;
  }
  return {
    args: [
      ...options.filter((argument) => argument !== "--no-review"),
      ...args.slice(separator),
    ],
    review: reviewFlags.length === 0,
  };
}

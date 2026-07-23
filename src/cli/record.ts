import { spawn } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  loadObservations,
  writeObservations,
} from "../contract/observation-file.js";
import { ScenarioNameSchema } from "../permissions/schema.js";
import { renderInstrumentationError } from "../reporting/terminal.js";
import type { CliContext } from "./context.js";
import { writeLine } from "./context.js";
import { ExitCode, type ExitCodeValue } from "./exit-codes.js";
import { parseBoundedDuration } from "./duration.js";

type ChildResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  spawnFailed: boolean;
  timedOut: boolean;
};

export async function runRecord(
  args: string[],
  context: CliContext,
): Promise<ExitCodeValue> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    writeLine(
      context.stdout,
      [
        "Record one named, instrumented test scenario",
        "",
        "Usage",
        "  granttrace record --scenario <safe-name> [--timeout 15m] -- <command> [args...]",
        "",
        "The command is launched directly with shell:false. Output is streamed;",
        "request and response bodies are never retained by GrantTrace.",
        "",
        "Next",
        "  granttrace check",
        "",
      ].join("\n"),
    );
    return ExitCode.success;
  }
  const parsed = parseRecordArguments(args);
  if (parsed === null) {
    writeLine(
      context.stderr,
      "Usage: granttrace record --scenario <safe-name> [--timeout 15m] -- <command> [args...]",
    );
    return ExitCode.usage;
  }

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

  const stateDirectory = join(context.cwd, ".granttrace");
  const sessionsDirectory = join(stateDirectory, "sessions");
  let sessionDirectory: string | null = null;

  try {
    await mkdir(sessionsDirectory, { recursive: true, mode: 0o700 });
    await chmod(stateDirectory, 0o700);
    await chmod(sessionsDirectory, 0o700);
    sessionDirectory = await mkdtemp(join(sessionsDirectory, "session-"));
    await chmod(sessionDirectory, 0o700);

    const childEnvironment = createChildEnvironment(
      context.environment,
      scenario,
      sessionDirectory,
    );
    const result = await spawnChild(
      parsed.command,
      parsed.commandArgs,
      context.cwd,
      childEnvironment,
      parsed.timeoutMs,
    );

    if (result.spawnFailed) {
      writeLine(
        context.stderr,
        [
          "GrantTrace record failed",
          "",
          "The test process could not be started.",
          "",
          "No contract decision was made.",
          "",
        ].join("\n"),
      );
      return ExitCode.testFailure;
    }
    if (result.timedOut) {
      writeLine(
        context.stderr,
        [
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
      );
      return ExitCode.testFailure;
    }

    const markerPath = join(sessionDirectory, "plugin-loaded");
    if (!(await pathExists(markerPath))) {
      writeLine(context.stderr, renderInstrumentationError());
      return ExitCode.instrumentation;
    }

    if (result.code !== 0) {
      writeLine(
        context.stderr,
        [
          "GrantTrace record failed",
          "",
          result.signal === null
            ? "The instrumented test process failed."
            : "The instrumented test process was interrupted.",
          "",
          "No contract decision was made.",
          "",
        ].join("\n"),
      );
      return result.signal === null
        ? ExitCode.testFailure
        : ExitCode.interrupted;
    }

    const observationsPath = join(sessionDirectory, "observations.ndjson");
    if (!(await pathExists(observationsPath))) {
      writeLine(context.stderr, renderInstrumentationError());
      return ExitCode.instrumentation;
    }
    const observations = await loadObservations(observationsPath);
    if (
      observations.length === 0 ||
      observations.some(
        (observation) => observation.scenario !== scenario,
      )
    ) {
      writeLine(context.stderr, renderInstrumentationError());
      return ExitCode.instrumentation;
    }

    const outputDirectory = join(stateDirectory, "observations");
    await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
    await chmod(outputDirectory, 0o700);
    await writeObservations(
      join(outputDirectory, `${scenario}.ndjson`),
      observations,
    );

    writeLine(
      context.stdout,
      [
        "GrantTrace record complete",
        "",
        `Scenario  ${scenario}`,
        `Observed  ${observations.length} GitHub REST operation${
          observations.length === 1 ? "" : "s"
        }`,
        "",
        "Next",
        "  granttrace check",
        "",
        "Coverage",
        "  This recording covers only REST operations exercised by this scenario.",
        "  Recording the same scenario name again replaces its prior recording.",
        "",
      ].join("\n"),
    );
    return ExitCode.success;
  } catch {
    writeLine(
      context.stderr,
      "GrantTrace record failed: the child process or safe observation artifact could not be handled.",
    );
    return ExitCode.analysisFailure;
  } finally {
    if (sessionDirectory !== null) {
      await rm(sessionDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
}

function parseRecordArguments(args: string[]):
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
  return childEnvironment;
}

function spawnChild(
  command: string,
  args: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<ChildResult> {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, {
      cwd,
      detached: process.platform !== "win32",
      env: environment,
      shell: false,
      stdio: "inherit",
    });
    let spawnFailed = false;
    let timedOut = false;
    let forceKillTimer: NodeJS.Timeout | null = null;
    const terminate = (signal: NodeJS.Signals) => {
      killProcessTree(child.pid, signal, child);
    };
    const interrupt = () => terminate("SIGINT");
    const terminateSignal = () => terminate("SIGTERM");
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", terminateSignal);
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate("SIGTERM");
      forceKillTimer = setTimeout(() => {
        terminate("SIGKILL");
      }, 5_000);
      forceKillTimer.unref();
    }, timeoutMs);
    timeout.unref();

    child.once("error", () => {
      spawnFailed = true;
    });
    child.once("close", (code, signal) => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminateSignal);
      clearTimeout(timeout);
      if (forceKillTimer !== null) {
        clearTimeout(forceKillTimer);
      }
      resolveResult({ code, signal, spawnFailed, timedOut });
    });
  });
}

function killProcessTree(
  pid: number | undefined,
  signal: NodeJS.Signals,
  child: ReturnType<typeof spawn>,
): void {
  if (process.platform !== "win32" && pid !== undefined) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // Fall through to direct-child termination.
    }
  }
  child.kill(signal);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

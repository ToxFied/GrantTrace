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

type ChildResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  spawnFailed: boolean;
};

export async function runRecord(
  args: string[],
  context: CliContext,
): Promise<ExitCodeValue> {
  const parsed = parseRecordArguments(args);
  if (parsed === null) {
    writeLine(
      context.stderr,
      "Usage: granttrace record --scenario <safe-name> -- <command> [args...]",
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
      return ExitCode.testFailure;
    }

    const observationsPath = join(sessionDirectory, "observations.ndjson");
    if (!(await pathExists(observationsPath))) {
      writeLine(context.stderr, renderInstrumentationError());
      return ExitCode.instrumentation;
    }
    const observations = await loadObservations(observationsPath);
    if (observations.length === 0) {
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
): Promise<ChildResult> {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      shell: false,
      stdio: "inherit",
    });
    let spawnFailed = false;

    child.once("error", () => {
      spawnFailed = true;
    });
    child.once("close", (code, signal) => {
      resolveResult({ code, signal, spawnFailed });
    });
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

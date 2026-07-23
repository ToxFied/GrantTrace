import { spawn } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { join } from "node:path";

import {
  loadObservations,
} from "../contract/observation-file.js";
import type { Observation } from "../contract/observation.js";
import { ScenarioNameSchema } from "../permissions/schema.js";
import {
  createProofChildEnvironment,
} from "../security/proof-environment.js";
import type { SensitiveValue } from "../security/sensitive-value.js";
import type { FixtureCoordinates } from "./live-config.js";

type ChildProcessResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  spawnFailed: boolean;
  timedOut: boolean;
};

export type ProofChildOutcome =
  | "pass"
  | "spawn_failure"
  | "timeout"
  | "test_failure"
  | "instrumentation_failure"
  | "analysis_failure";

export type ProofChildResult = {
  outcome: ProofChildOutcome;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  observations: Observation[];
  sessionCleanup: "pass" | "cleanup_failure";
};

export async function runProofChild(input: {
  cwd: string;
  command: string;
  args: string[];
  baseEnvironment: NodeJS.ProcessEnv;
  token: SensitiveValue;
  fixture: FixtureCoordinates;
  scenario: string;
  timeoutMs?: number;
}): Promise<ProofChildResult> {
  const scenario = ScenarioNameSchema.parse(input.scenario);
  const timeoutMs = input.timeoutMs ?? 15 * 60 * 1_000;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 60 * 60 * 1_000
  ) {
    throw new Error("The proof child timeout is outside the safe range.");
  }
  const sessionsDirectory = join(
    input.cwd,
    ".granttrace",
    "proof-sessions",
  );
  let sessionDirectory: string | null = null;
  let result: Omit<ProofChildResult, "sessionCleanup"> = {
    outcome: "analysis_failure",
    exitCode: null,
    signal: null,
    observations: [],
  };

  try {
    await mkdir(sessionsDirectory, { recursive: true, mode: 0o700 });
    await chmod(join(input.cwd, ".granttrace"), 0o700);
    await chmod(sessionsDirectory, 0o700);
    sessionDirectory = await mkdtemp(
      join(sessionsDirectory, "session-"),
    );
    await chmod(sessionDirectory, 0o700);

    const environment = createProofChildEnvironment({
      baseEnvironment: input.baseEnvironment,
      token: input.token,
      fixture: input.fixture,
      scenario,
      sessionDirectory,
    });
    const child = await spawnChild(
      input.command,
      input.args,
      input.cwd,
      environment,
      timeoutMs,
    );

    result = {
      outcome: child.spawnFailed ? "spawn_failure" : "analysis_failure",
      exitCode: child.exitCode,
      signal: child.signal,
      observations: [],
    };
    if (child.spawnFailed) {
      return await finishWithCleanup(result, sessionDirectory);
    }

    const markerPath = join(sessionDirectory, "plugin-loaded");
    const observationsPath = join(
      sessionDirectory,
      "observations.ndjson",
    );
    const pluginLoaded = await pathExists(markerPath);
    const observationsExist = await pathExists(observationsPath);

    if (observationsExist) {
      result.observations = await loadObservations(observationsPath);
      if (
        result.observations.some(
          (observation) => observation.scenario !== scenario,
        )
      ) {
        result.outcome = "analysis_failure";
        return await finishWithCleanup(result, sessionDirectory);
      }
    }

    if (child.timedOut) {
      result.outcome = "timeout";
    } else if (!pluginLoaded) {
      result.outcome = "instrumentation_failure";
    } else if (child.exitCode !== 0) {
      result.outcome = "test_failure";
    } else if (result.observations.length === 0) {
      result.outcome = "instrumentation_failure";
    } else {
      result.outcome = "pass";
    }
  } catch {
    result.outcome = "analysis_failure";
  }

  return await finishWithCleanup(result, sessionDirectory);
}

async function finishWithCleanup(
  result: Omit<ProofChildResult, "sessionCleanup">,
  sessionDirectory: string | null,
): Promise<ProofChildResult> {
  let sessionCleanup: ProofChildResult["sessionCleanup"] = "pass";
  if (sessionDirectory !== null) {
    try {
      await rm(sessionDirectory, { recursive: true, force: true });
    } catch {
      sessionCleanup = "cleanup_failure";
    }
  }
  return { ...result, sessionCleanup };
}

function spawnChild(
  command: string,
  args: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<ChildProcessResult> {
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
    child.once("close", (exitCode, signal) => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminateSignal);
      clearTimeout(timeout);
      if (forceKillTimer !== null) {
        clearTimeout(forceKillTimer);
      }
      resolveResult({ exitCode, signal, spawnFailed, timedOut });
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

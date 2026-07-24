import {
  access,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { join } from "node:path";

import {
  loadObservations,
} from "../contract/observation-file.js";
import type { Observation } from "../contract/observation.js";
import { ScenarioNameSchema } from "../permissions/schema.js";
import { injectRuntimePreload } from "../runtime/injection.js";
import {
  createProofChildEnvironment,
} from "../security/proof-environment.js";
import type { SensitiveValue } from "../security/sensitive-value.js";
import type { FixtureCoordinates } from "./live-config.js";
import { runManagedChild } from "../security/managed-child.js";
import {
  ensurePrivateStateSubdirectory,
  initializeLocalState,
} from "../security/local-state.js";

export type ProofChildOutcome =
  | "pass"
  | "spawn_failure"
  | "timeout"
  | "interrupted"
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
    timeoutMs > 30 * 60 * 1_000
  ) {
    throw new Error("The proof child timeout is outside the safe range.");
  }
  await initializeLocalState(input.cwd);
  const sessionsDirectory = await ensurePrivateStateSubdirectory(
    input.cwd,
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
    sessionDirectory = await mkdtemp(
      join(sessionsDirectory, "session-"),
    );

    const environment = injectRuntimePreload(
      createProofChildEnvironment({
        baseEnvironment: input.baseEnvironment,
        token: input.token,
        fixture: input.fixture,
        scenario,
        sessionDirectory,
      }),
    );
    const child = await runManagedChild({
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      environment,
      timeoutMs,
    });

    result = {
      outcome: child.spawnFailed ? "spawn_failure" : "analysis_failure",
      exitCode: child.interruptedBy === null ? child.exitCode : null,
      signal: child.interruptedBy ?? child.signal,
      observations: [],
    };
    if (child.processTreeCleanupFailed) {
      result.outcome = "analysis_failure";
      return await finishWithCleanup(result, sessionDirectory, true);
    }
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

    if (child.interruptedBy !== null) {
      result.outcome = "interrupted";
    } else if (child.timedOut) {
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
  processTreeCleanupFailed = false,
): Promise<ProofChildResult> {
  let sessionCleanup: ProofChildResult["sessionCleanup"] =
    processTreeCleanupFailed ? "cleanup_failure" : "pass";
  if (sessionDirectory !== null) {
    try {
      await rm(sessionDirectory, { recursive: true, force: true });
    } catch {
      sessionCleanup = "cleanup_failure";
    }
  }
  return { ...result, sessionCleanup };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";

import { z } from "zod";

import type { PermissionCatalog } from "../evidence/catalog.js";
import { githubPermissionCatalog } from "../evidence/catalog.js";
import { ScenarioNameSchema } from "../permissions/schema.js";

const RecorderEnvironmentSchema = z.strictObject({
  GRANTTRACE_RECORDING: z.literal("1"),
  GRANTTRACE_SCENARIO: ScenarioNameSchema,
  GRANTTRACE_SESSION_DIR: z.string().min(1).max(4_096),
});

export type RecorderConfig = {
  scenario: string;
  sessionDirectory: string;
  observationsFile: string;
  markerFile: string;
  catalog: PermissionCatalog;
};

export function loadRecorderConfig(
  environment: NodeJS.ProcessEnv,
): RecorderConfig | null {
  if (environment["GRANTTRACE_RECORDING"] !== "1") {
    return null;
  }

  const parsed = RecorderEnvironmentSchema.parse({
    GRANTTRACE_RECORDING: environment["GRANTTRACE_RECORDING"],
    GRANTTRACE_SCENARIO: environment["GRANTTRACE_SCENARIO"],
    GRANTTRACE_SESSION_DIR: environment["GRANTTRACE_SESSION_DIR"],
  });

  return createRecorderConfig(
    parsed.GRANTTRACE_SCENARIO,
    parsed.GRANTTRACE_SESSION_DIR,
    githubPermissionCatalog,
  );
}

export function createRecorderConfig(
  scenarioInput: string,
  sessionDirectory: string,
  catalog: PermissionCatalog = githubPermissionCatalog,
): RecorderConfig {
  const scenario = ScenarioNameSchema.parse(scenarioInput);
  validateSessionDirectory(sessionDirectory);

  return {
    scenario,
    sessionDirectory,
    observationsFile: join(sessionDirectory, "observations.ndjson"),
    markerFile: join(sessionDirectory, "plugin-loaded"),
    catalog,
  };
}

function validateSessionDirectory(path: string): void {
  if (!isAbsolute(path)) {
    throw new Error("GrantTrace session directory must be absolute.");
  }

  let descriptor: number | null = null;
  try {
    if (process.platform === "win32") {
      const stat = lstatSync(path);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        !ownedByCurrentUser(stat) ||
        !hasPrivateMode(stat)
      ) {
        throw new Error("Unsafe GrantTrace session directory.");
      }
      return;
    }
    descriptor = openSync(
      path,
      constants.O_RDONLY |
        constants.O_DIRECTORY |
        (constants.O_NOFOLLOW ?? 0),
    );
    const stat = fstatSync(descriptor);
    if (
      !stat.isDirectory() ||
      !ownedByCurrentUser(stat) ||
      !hasPrivateMode(stat)
    ) {
      throw new Error("Unsafe GrantTrace session directory.");
    }
  } catch {
    throw new Error("GrantTrace session directory is unavailable.");
  } finally {
    if (descriptor !== null) {
      closeSync(descriptor);
    }
  }
}

function ownedByCurrentUser(details: { uid: number }): boolean {
  const uid = process.getuid?.();
  return uid === undefined || details.uid === uid;
}

function hasPrivateMode(details: { mode: number }): boolean {
  return (
    process.platform === "win32" ||
    (details.mode & 0o777) === 0o700
  );
}

import { statSync } from "node:fs";
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

  let stat;
  try {
    stat = statSync(path);
  } catch {
    throw new Error("GrantTrace session directory is unavailable.");
  }

  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0) {
    throw new Error(
      "GrantTrace session directory must exist with mode 0700.",
    );
  }
}

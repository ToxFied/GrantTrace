import { isAbsolute } from "node:path";

import { ScenarioNameSchema } from "../permissions/schema.js";
import type { FixtureCoordinates } from "../proof/live-config.js";
import { SensitiveValue } from "./sensitive-value.js";

const SAFE_INHERITED_KEYS = [
  "CI",
  "COMSPEC",
  "FORCE_COLOR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NO_COLOR",
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "TZ",
] as const;

export function createProofChildEnvironment(input: {
  baseEnvironment: NodeJS.ProcessEnv;
  token: SensitiveValue;
  fixture: FixtureCoordinates;
  scenario: string;
  sessionDirectory: string;
}): NodeJS.ProcessEnv {
  const scenario = ScenarioNameSchema.parse(input.scenario);
  if (!isAbsolute(input.sessionDirectory)) {
    throw new Error("The proof session directory must be absolute.");
  }

  const environment: NodeJS.ProcessEnv = {};
  for (const key of SAFE_INHERITED_KEYS) {
    const value = input.baseEnvironment[key];
    if (value !== undefined) {
      environment[key] = value;
    }
  }

  environment["GITHUB_TOKEN"] = input.token.reveal();
  environment["GRANTTRACE_PROOF_MODE"] = "1";
  environment["GRANTTRACE_RECORDING"] = "1";
  environment["GRANTTRACE_SCENARIO"] = scenario;
  environment["GRANTTRACE_SESSION_DIR"] = input.sessionDirectory;
  environment["GRANTTRACE_LIVE_OWNER"] = input.fixture.owner;
  environment["GRANTTRACE_LIVE_REPOSITORY"] = input.fixture.repository;
  environment["GRANTTRACE_LIVE_ISSUE_NUMBER"] = input.fixture.issueNumber;

  return environment;
}

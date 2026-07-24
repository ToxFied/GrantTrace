import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { loadObservations } from "../contract/observation-file.js";
import { ScenarioNameSchema } from "../permissions/schema.js";
import { compareAscii } from "../deterministic.js";
import type { CliContext } from "./context.js";
import { writeLine } from "./context.js";
import { ExitCode, type ExitCodeValue } from "./exit-codes.js";
import {
  acquireLocalOperationLock,
  inspectLocalState,
  LocalOperationLockError,
} from "../security/local-state.js";

export async function runScenario(
  args: string[],
  context: CliContext,
): Promise<ExitCodeValue> {
  if (
    args.length === 0 ||
    (args.length === 1 && (args[0] === "--help" || args[0] === "-h"))
  ) {
    writeLine(context.stdout, helpText());
    return ExitCode.success;
  }
  const directory = join(context.cwd, ".granttrace", "observations");

  if (args[0] === "list" && args.length === 1) {
    try {
      const state = await inspectLocalState(context.cwd);
      if (state.issue === "missing") {
        writeLine(
          context.stdout,
          [
            "Recorded scenarios",
            "",
            "  (none)",
            "",
            "Next",
            "  granttrace init",
            "",
          ].join("\n"),
        );
        return ExitCode.success;
      }
      if (!state.ready) {
        throw new Error("Unsafe local state.");
      }
      const entries = (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".ndjson"))
        .sort((left, right) => compareAscii(left.name, right.name));
      const scenarios: string[] = [];
      for (const entry of entries) {
        const observations = await loadObservations(join(directory, entry.name));
        const names = [...new Set(observations.map((item) => item.scenario))];
        if (names.length !== 1) {
          throw new Error("Invalid scenario recording.");
        }
        scenarios.push(names[0]!);
      }
      writeLine(
        context.stdout,
        [
          "Recorded scenarios",
          "",
          ...(scenarios.length === 0
            ? ["  (none)"]
            : scenarios.map((scenario) => `  ${scenario}`)),
          "",
          "The accepted contract changes only after granttrace check --accept.",
          "",
        ].join("\n"),
      );
      return ExitCode.success;
    } catch {
      writeLine(
        context.stderr,
        "GrantTrace scenario failed: the local recordings are invalid or unreadable.",
      );
      return ExitCode.analysisFailure;
    }
  }

  if (args[0] === "remove" && args.length === 2) {
    const scenario = ScenarioNameSchema.safeParse(args[1]);
    if (!scenario.success) {
      writeLine(context.stderr, helpText());
      return ExitCode.usage;
    }
    try {
      const operationLock = await acquireLocalOperationLock(context.cwd);
      try {
        const state = await inspectLocalState(context.cwd);
        if (!state.ready || state.staleSessions !== 1) {
          throw new Error("Unsafe local state.");
        }
        await rm(join(directory, `${scenario.data}.ndjson`));
      } finally {
        await operationLock.release();
      }
      writeLine(
        context.stdout,
        [
          "Scenario recording removed",
          "",
          `  ${scenario.data}`,
          "",
          "Next",
          "  Run granttrace check and review the coverage removal.",
          "",
        ].join("\n"),
      );
      return ExitCode.success;
    } catch (error) {
      if (error instanceof LocalOperationLockError) {
        writeLine(
          context.stderr,
          [
            "GrantTrace scenario blocked",
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
      writeLine(
        context.stderr,
        "GrantTrace scenario failed: that recording does not exist or could not be removed.",
      );
      return ExitCode.analysisFailure;
    }
  }

  writeLine(context.stderr, helpText());
  return ExitCode.usage;
}

function helpText(): string {
  return [
    "List or remove named scenario recordings",
    "",
    "Usage",
    "  granttrace scenario list",
    "  granttrace scenario remove <safe-name>",
    "",
    "Removing a recording never changes granttrace.lock.json automatically.",
    "The next granttrace check makes the coverage change explicit.",
    "",
  ].join("\n");
}

import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { buildContract } from "../contract/build.js";
import { loadObservations } from "../contract/observation-file.js";
import { githubPermissionCatalog } from "../evidence/catalog.js";
import { renderAnalysisReport } from "../reporting/terminal.js";
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
        .filter((entry) => entry.isFile() && entry.name.endsWith(".ndjson"));
      const scenarios: string[] = [];
      for (const entry of entries) {
        const name = ScenarioNameSchema.parse(entry.name.slice(0, -7));
        await loadScenarioRecording(directory, name);
        scenarios.push(name);
      }
      scenarios.sort(compareAscii);
      writeLine(
        context.stdout,
        [
          "Recorded scenarios",
          "",
          ...(scenarios.length === 0
            ? ["  (none)"]
            : scenarios.map((scenario) => `  ${scenario}`)),
          "",
          "Inspect one recording with granttrace scenario inspect <name>.",
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

  if (args[0] === "inspect" && args.length === 2) {
    const scenario = ScenarioNameSchema.safeParse(args[1]);
    if (!scenario.success) {
      writeLine(context.stderr, helpText());
      return ExitCode.usage;
    }
    try {
      const state = await inspectLocalState(context.cwd);
      if (!state.ready) {
        throw new Error("Unsafe local state.");
      }
      const observations = await loadScenarioRecording(directory, scenario.data);
      const contract = buildContract(observations, githubPermissionCatalog);
      const blocked = contract.unknowns.length > 0;
      writeLine(
        blocked ? context.stderr : context.stdout,
        renderAnalysisReport(contract, observations.length, {
          includeRoutes: true,
        }),
      );
      return blocked ? ExitCode.evidenceBlocked : ExitCode.success;
    } catch {
      writeLine(
        context.stderr,
        "GrantTrace scenario failed: that recording is missing, invalid, or unsafe to read.",
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

async function loadScenarioRecording(directory: string, name: string) {
  const observations = await loadObservations(join(directory, `${name}.ndjson`));
  if (
    observations.length === 0 ||
    observations.some((observation) => observation.scenario !== name)
  ) {
    throw new Error("Invalid scenario recording.");
  }
  return observations;
}

function helpText(): string {
  return [
    "List, inspect, or remove named scenario recordings",
    "",
    "Usage",
    "  granttrace scenario list",
    "  granttrace scenario inspect <safe-name>",
    "  granttrace scenario remove <safe-name>",
    "",
    "Inspect shows one recording's permissions, routes, and evidence without writing.",
    "It does not include accepted frontier choices or manual keeps.",
    "",
    "Removing a recording never changes granttrace.lock.json automatically.",
    "The next granttrace check makes the coverage change explicit.",
    "",
  ].join("\n");
}

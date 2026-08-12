import { runAnalyze } from "./analyze.js";
import { runCheck } from "./check.js";
import { defaultCliContext, type CliContext, writeLine } from "./context.js";
import { runDoctor } from "./doctor.js";
import { ExitCode, type ExitCodeValue } from "./exit-codes.js";
import { runFrontier } from "./frontier.js";
import { runInit } from "./init.js";
import { runKeep } from "./keep.js";
import { runRecord } from "./record.js";
import { runProve } from "./prove.js";
import { runScenario } from "./scenario.js";
import { TOOL_VERSION } from "../version.js";

const COMMANDS = [
  "analyze",
  "check",
  "doctor",
  "frontier",
  "init",
  "keep",
  "prove",
  "record",
  "scenario",
] as const;

export async function runCli(
  args: string[],
  context: CliContext = defaultCliContext(),
): Promise<ExitCodeValue> {
  const [command, ...commandArgs] = args;
  if (command === "analyze") {
    return runAnalyze(commandArgs, context);
  }
  if (command === "record") {
    return runRecord(commandArgs, context);
  }
  if (command === "check") {
    return runCheck(commandArgs, context);
  }
  if (command === "prove") {
    return runProve(commandArgs, context);
  }
  if (command === "doctor") {
    return runDoctor(commandArgs, context);
  }
  if (command === "init") {
    return runInit(commandArgs, context);
  }
  if (command === "keep") {
    return runKeep(commandArgs, context);
  }
  if (command === "frontier") {
    return runFrontier(commandArgs, context);
  }
  if (command === "scenario") {
    return runScenario(commandArgs, context);
  }
  if (command === "help") {
    const [helpCommand, ...unexpected] = commandArgs;
    if (helpCommand === undefined) {
      writeLine(context.stdout, helpText());
      return ExitCode.success;
    }
    if (unexpected.length > 0) {
      writeLine(context.stderr, "Usage: granttrace help [command]");
      return ExitCode.usage;
    }
    return runCli([helpCommand, "--help"], context);
  }
  if (command === "--version" || command === "-v" || command === "version") {
    writeLine(context.stdout, TOOL_VERSION);
    return ExitCode.success;
  }
  if (command === "--help" || command === "-h" || command === undefined) {
    writeLine(context.stdout, helpText());
    return ExitCode.success;
  }

  const suggestion = suggestCommand(command);
  writeLine(
    context.stderr,
    [
      "GrantTrace command not found",
      "",
      ...(suggestion === null
        ? []
        : ["Did you mean", `  granttrace ${suggestion}`, ""]),
      "Next",
      "  granttrace --help",
      "",
    ].join("\n"),
  );
  return ExitCode.usage;
}

function helpText(): string {
  return [
    `GrantTrace ${TOOL_VERSION}`,
    "Scenario-bound GitHub App REST permission contracts",
    "",
    "Core workflow",
    "  granttrace record     Run, observe, review, and optionally accept a scenario",
    "  granttrace check      Review or accept the aggregate contract",
    "  granttrace scenario   List or retire scenario recordings",
    "",
    "Setup and diagnostics",
    "  granttrace init       Explicitly create private ignored local state",
    "  granttrace doctor     Diagnose local and optional live prerequisites",
    "",
    "Access exceptions",
    "  granttrace keep add|remove|list",
    "                         Manage documented permission exceptions",
    "",
    "Permission policy",
    "  granttrace frontier list|select",
    "                         Review or choose a complete frontier assignment",
    "",
    "Live verification",
    "  granttrace prove      Prove one accepted scenario with restricted access",
    "",
    "Advanced",
    "  granttrace analyze    Analyze one NDJSON file without writing",
    "",
    "Help",
    "  granttrace help <command>",
    "  granttrace --version",
    "",
    "Start",
    "  granttrace record <name> -- <test-command>",
    "",
    "Guarantee",
    "  For the GitHub REST operations observed in named scenarios,",
    "  GrantTrace reports the permissions those scenarios",
    "  demonstrably require. Untested behavior is outside the claim.",
    "",
    "Run granttrace <command> --help for command-specific usage.",
    "",
  ].join("\n");
}

function suggestCommand(input: string): (typeof COMMANDS)[number] | null {
  if (input.length > 64 || !/^[a-z-]+$/u.test(input)) {
    return null;
  }

  const ranked = COMMANDS.map((command) => ({
    command,
    distance: editDistance(input, command),
  })).sort(
    (left, right) =>
      left.distance - right.distance || left.command.localeCompare(right.command),
  );
  const closest = ranked[0];
  const maximumDistance = input.length <= 4 ? 1 : 2;
  return closest !== undefined && closest.distance <= maximumDistance
    ? closest.command
    : null;
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const substitution =
        (previous[rightIndex] ?? 0) +
        (left[leftIndex] === right[rightIndex] ? 0 : 1);
      current.push(
        Math.min(
          (current[rightIndex] ?? leftIndex + 1) + 1,
          (previous[rightIndex + 1] ?? rightIndex + 1) + 1,
          substitution,
        ),
      );
    }
    previous = current;
  }

  return previous[right.length] ?? right.length;
}

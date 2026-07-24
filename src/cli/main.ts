import { runAnalyze } from "./analyze.js";
import { runCheck } from "./check.js";
import { defaultCliContext, type CliContext, writeLine } from "./context.js";
import { runDoctor } from "./doctor.js";
import { ExitCode, type ExitCodeValue } from "./exit-codes.js";
import { runInit } from "./init.js";
import { runKeep } from "./keep.js";
import { runRecord } from "./record.js";
import { runProve } from "./prove.js";
import { runScenario } from "./scenario.js";
import { TOOL_VERSION } from "../version.js";

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
  if (command === "scenario") {
    return runScenario(commandArgs, context);
  }
  if (command === "--version" || command === "-v") {
    writeLine(context.stdout, TOOL_VERSION);
    return ExitCode.success;
  }
  if (command === "--help" || command === "-h" || command === undefined) {
    writeLine(context.stdout, helpText());
    return ExitCode.success;
  }

  writeLine(context.stderr, "Unknown command.");
  writeLine(context.stderr, "");
  writeLine(context.stderr, helpText());
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
    "Live verification",
    "  granttrace prove      Prove one accepted scenario with restricted access",
    "",
    "Advanced",
    "  granttrace analyze    Analyze one NDJSON file without writing",
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

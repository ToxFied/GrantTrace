#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { runAnalyze } from "./analyze.js";
import { runCheck } from "./check.js";
import { defaultCliContext, type CliContext, writeLine } from "./context.js";
import { ExitCode, type ExitCodeValue } from "./exit-codes.js";
import { runRecord } from "./record.js";
import { runProve } from "./prove.js";

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
  if (command === "--help" || command === "-h" || command === undefined) {
    writeLine(context.stdout, helpText());
    return ExitCode.success;
  }

  writeLine(context.stderr, `Unknown GrantTrace command.`);
  writeLine(context.stderr, helpText());
  return ExitCode.usage;
}

function helpText(): string {
  return [
    "GrantTrace",
    "",
    "Usage",
    "  granttrace analyze <observations.ndjson>",
    "  granttrace record --scenario <safe-name> -- <command> [args...]",
    "  granttrace check [--accept]",
    "  granttrace prove --scenario <safe-name> -- <command> [args...]",
    "",
    "GrantTrace reports only GitHub REST operations observed in instrumented scenarios.",
    "",
  ].join("\n");
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  import.meta.url === pathToFileURL(entryPath).href
) {
  process.exitCode = await runCli(process.argv.slice(2));
}

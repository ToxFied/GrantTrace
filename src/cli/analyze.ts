import { resolve } from "node:path";

import { buildContract } from "../contract/build.js";
import { loadObservations } from "../contract/observation-file.js";
import { fixtureCatalog } from "../evidence/catalog.js";
import { renderAnalysisReport } from "../reporting/terminal.js";
import type { CliContext } from "./context.js";
import { writeLine } from "./context.js";
import { ExitCode, type ExitCodeValue } from "./exit-codes.js";

export async function runAnalyze(
  args: string[],
  context: CliContext,
): Promise<ExitCodeValue> {
  if (args.length !== 1 || args[0]?.startsWith("-") === true) {
    writeLine(
      context.stderr,
      "Usage: granttrace analyze <observations.ndjson>",
    );
    return ExitCode.usage;
  }
  const observationPath = args[0];
  if (observationPath === undefined) {
    return ExitCode.usage;
  }

  try {
    const observations = await loadObservations(
      resolve(context.cwd, observationPath),
    );
    if (observations.length === 0) {
      writeLine(
        context.stderr,
        "GrantTrace analysis failed: the observation file is empty.",
      );
      return ExitCode.instrumentation;
    }

    const contract = buildContract(observations, fixtureCatalog);
    const report = renderAnalysisReport(contract, observations.length);
    writeLine(
      contract.unknowns.length > 0 ? context.stderr : context.stdout,
      report,
    );
    return contract.unknowns.length > 0
      ? ExitCode.evidenceBlocked
      : ExitCode.success;
  } catch (error) {
    writeLine(
      context.stderr,
      safeAnalysisMessage(error),
    );
    return ExitCode.analysisFailure;
  }
}

function safeAnalysisMessage(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("Observation ")) {
    return `GrantTrace analysis failed: ${error.message}`;
  }
  return "GrantTrace analysis failed: observations could not be analyzed safely.";
}

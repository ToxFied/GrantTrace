import { access, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { buildContract } from "../contract/build.js";
import { diffContracts } from "../contract/diff.js";
import { loadObservations } from "../contract/observation-file.js";
import {
  readContract,
  serializeContract,
  writeContractAtomic,
} from "../contract/serialize.js";
import { fixtureCatalog } from "../evidence/catalog.js";
import { compareAscii } from "../deterministic.js";
import {
  renderAccepted,
  renderAnalysisReport,
  renderCheckSuccess,
  renderContractDiff,
  renderContractWarnings,
} from "../reporting/terminal.js";
import type { Observation } from "../contract/observation.js";
import type { CliContext } from "./context.js";
import { writeLine } from "./context.js";
import { ExitCode, type ExitCodeValue } from "./exit-codes.js";

type CheckOptions = {
  accept: boolean;
  lockPath: string;
  observationsPath: string;
};

const MAX_OBSERVATION_FILES = 128;
const MAX_AGGREGATE_OBSERVATIONS = 10_000;
const MAX_AGGREGATE_BYTES = 10 * 1024 * 1024;

export async function runCheck(
  args: string[],
  context: CliContext,
): Promise<ExitCodeValue> {
  const options = parseCheckArguments(args, context.cwd);
  if (options === null) {
    writeLine(
      context.stderr,
      "Usage: granttrace check [--accept] [--observations <path>] [--lock <path>]",
    );
    return ExitCode.usage;
  }

  try {
    if (!(await pathExists(options.observationsPath))) {
      writeLine(context.stderr, renderNoObservations());
      return ExitCode.instrumentation;
    }
    const observations = await loadObservationSource(options.observationsPath);
    if (observations.length === 0) {
      writeLine(context.stderr, renderNoObservations());
      return ExitCode.instrumentation;
    }

    const next = buildContract(observations, fixtureCatalog);
    if (next.unknowns.length > 0) {
      writeLine(
        context.stderr,
        renderAnalysisReport(next, observations.length),
      );
      return ExitCode.evidenceBlocked;
    }

    if (!(await pathExists(options.lockPath))) {
      if (options.accept) {
        await writeContractAtomic(options.lockPath, next);
        writeLine(context.stdout, renderAccepted(next));
        return ExitCode.success;
      }

      const emptyPrevious = {
        ...next,
        routes: [],
        selectedPermissions: {},
        permissionFrontier: [{}],
      };
      writeLine(
        context.stderr,
        renderContractDiff(diffContracts(emptyPrevious, next), next),
      );
      return ExitCode.contractChanged;
    }

    const previous = await readContract(options.lockPath);
    const nextWithManualKeeps = {
      ...next,
      manualKeeps: previous.manualKeeps,
    };
    if (
      serializeContract(previous) === serializeContract(nextWithManualKeeps)
    ) {
      writeLine(context.stdout, renderCheckSuccess(nextWithManualKeeps));
      return ExitCode.success;
    }

    if (options.accept) {
      await writeContractAtomic(options.lockPath, nextWithManualKeeps);
      writeLine(context.stdout, renderAccepted(nextWithManualKeeps));
      return ExitCode.success;
    }

    const diff = diffContracts(previous, nextWithManualKeeps);
    if (!diff.hasBlockingChange) {
      writeLine(
        context.stdout,
        renderContractWarnings(diff, nextWithManualKeeps),
      );
      return ExitCode.success;
    }

    writeLine(
      context.stderr,
      renderContractDiff(diff, nextWithManualKeeps),
    );
    return ExitCode.contractChanged;
  } catch {
    writeLine(
      context.stderr,
      "GrantTrace check failed: observations or the existing contract could not be validated safely.",
    );
    return ExitCode.analysisFailure;
  }
}

function parseCheckArguments(
  args: string[],
  cwd: string,
): CheckOptions | null {
  let accept = false;
  let lockPath = join(cwd, "granttrace.lock.json");
  let observationsPath = join(cwd, ".granttrace", "observations");

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--accept" && !accept) {
      accept = true;
      continue;
    }
    if (argument === "--lock" || argument === "--observations") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        return null;
      }
      if (argument === "--lock") {
        lockPath = resolve(cwd, value);
      } else {
        observationsPath = resolve(cwd, value);
      }
      index += 1;
      continue;
    }
    return null;
  }

  return { accept, lockPath, observationsPath };
}

async function loadObservationSource(path: string) {
  const sourceStat = await stat(path);
  if (sourceStat.isFile()) {
    return loadObservations(path);
  }
  if (!sourceStat.isDirectory()) {
    return [];
  }

  const entries = (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ndjson"))
    .sort((left, right) => compareAscii(left.name, right.name));
  if (entries.length > MAX_OBSERVATION_FILES) {
    throw new Error("Aggregate observation file limit exceeded.");
  }

  let aggregateBytes = 0;
  for (const entry of entries) {
    aggregateBytes += (await stat(join(path, entry.name))).size;
    if (aggregateBytes > MAX_AGGREGATE_BYTES) {
      throw new Error("Aggregate observation byte limit exceeded.");
    }
  }

  const observations: Observation[] = [];
  for (const entry of entries) {
    observations.push(...(await loadObservations(join(path, entry.name))));
    if (observations.length > MAX_AGGREGATE_OBSERVATIONS) {
      throw new Error("Aggregate observation record limit exceeded.");
    }
  }
  return observations;
}

function renderNoObservations(): string {
  return [
    "GrantTrace check failed",
    "",
    "No observations were found.",
    "",
    "Next",
    "  Run an instrumented scenario with granttrace record.",
    "",
  ].join("\n");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

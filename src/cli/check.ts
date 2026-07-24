import { access, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { buildContract } from "../contract/build.js";
import { diffContracts } from "../contract/diff.js";
import {
  loadObservations,
  ObservationFileError,
} from "../contract/observation-file.js";
import {
  readContractWithMetadata,
  ContractFileError,
  serializeContract,
  writeContractAtomic,
} from "../contract/serialize.js";
import { githubPermissionCatalog } from "../evidence/catalog.js";
import { compareAscii } from "../deterministic.js";
import {
  renderAccepted,
  renderAnalysisReport,
  renderCheckSuccess,
  renderContractDiff,
} from "../reporting/terminal.js";
import type { Observation } from "../contract/observation.js";
import { retainUnobservedManualKeeps } from "../contract/manual-keeps.js";
import type { CliContext } from "./context.js";
import { writeLine } from "./context.js";
import { ExitCode, type ExitCodeValue } from "./exit-codes.js";
import {
  acquireLocalOperationLock,
  type LocalOperationLock,
} from "../security/local-state.js";

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
  presentation: "record" | "standalone" = "standalone",
): Promise<ExitCodeValue> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    writeLine(
      context.stdout,
      [
        "Compare recorded scenarios with the accepted permission contract",
        "",
        "Usage",
        "  granttrace check",
        "  granttrace check --accept",
        "  granttrace check [--observations <path>] [--lock <path>]",
        "",
        "Without --accept, every semantic change exits 6 for CI review.",
        "--accept writes the reviewed contract to granttrace.lock.json.",
        "",
      ].join("\n"),
    );
    return ExitCode.success;
  }
  const options = parseCheckArguments(args, context.cwd);
  if (options === null) {
    writeLine(
      context.stderr,
      "Usage: granttrace check [--accept] [--observations <path>] [--lock <path>]",
    );
    return ExitCode.usage;
  }

  let operationLock: LocalOperationLock | null = null;
  if (options.accept) {
    try {
      operationLock = await acquireLocalOperationLock(context.cwd);
    } catch {
      writeLine(context.stderr, renderOperationLocked("check --accept"));
      return ExitCode.analysisFailure;
    }
  }

  const result = await executeCheck(options, context, presentation);
  if (operationLock !== null) {
    try {
      await operationLock.release();
    } catch {
      writeLine(
        context.stderr,
        [
          "GrantTrace check cleanup failed",
          "",
          "The operation lock could not be removed. Inspect .granttrace/active-operation before retrying.",
          "",
        ].join("\n"),
      );
      return ExitCode.analysisFailure;
    }
  }
  return result;
}

async function executeCheck(
  options: CheckOptions,
  context: CliContext,
  presentation: "record" | "standalone",
): Promise<ExitCodeValue> {
  try {
    if (!(await pathExists(options.observationsPath))) {
      writeLine(context.stderr, renderNoObservations());
      return ExitCode.instrumentation;
    }
    const observations = await loadObservationSource(options.observationsPath);
    const lockExists = await pathExists(options.lockPath);
    if (observations.length === 0 && !lockExists) {
      writeLine(context.stderr, renderNoObservations());
      return ExitCode.instrumentation;
    }

    const next = buildContract(observations, githubPermissionCatalog);
    if (next.unknowns.length > 0) {
      writeLine(
        context.stderr,
        renderAnalysisReport(next, observations.length),
      );
      return ExitCode.evidenceBlocked;
    }

    if (!lockExists) {
      if (options.accept) {
        await writeContractAtomic(options.lockPath, next);
        writeLine(context.stdout, renderAccepted(next));
        return ExitCode.success;
      }

      const emptyPrevious = {
        ...next,
        scenarios: [],
        routes: [],
        selectedPermissions: {},
        permissionFrontier: [{}],
      };
      writeLine(
        context.stderr,
        renderContractDiff(diffContracts(emptyPrevious, next), next, {
          nextAction: reviewNextAction(presentation, context),
        }),
      );
      return ExitCode.contractChanged;
    }

    const loadedPrevious = await readContractWithMetadata(options.lockPath);
    const previous = loadedPrevious.contract;
    const nextWithManualKeeps = {
      ...next,
      manualKeeps: retainUnobservedManualKeeps(
        previous,
        next.selectedPermissions,
      ),
    };
    if (
      !loadedPrevious.migratedFromV1 &&
      !loadedPrevious.migratedFromLegacyV2 &&
      serializeContract(previous) === serializeContract(nextWithManualKeeps)
    ) {
      writeLine(context.stdout, renderCheckSuccess(nextWithManualKeeps));
      return ExitCode.success;
    }

    if (options.accept) {
      await writeContractAtomic(options.lockPath, nextWithManualKeeps);
      const removedKeeps = Object.keys(previous.manualKeeps).filter(
        (permission) =>
          nextWithManualKeeps.manualKeeps[permission] === undefined,
      );
      writeLine(
        context.stdout,
        renderAccepted(nextWithManualKeeps, { removedKeeps }),
      );
      return ExitCode.success;
    }

    const diff = diffContracts(previous, nextWithManualKeeps);

    writeLine(
      context.stderr,
      renderContractDiff(diff, nextWithManualKeeps, {
        migratedFromV1: loadedPrevious.migratedFromV1,
        migratedFromLegacyV2: loadedPrevious.migratedFromLegacyV2,
        nextAction: reviewNextAction(presentation, context),
      }),
    );
    return ExitCode.contractChanged;
  } catch (error) {
    if (
      error instanceof ObservationFileError ||
      error instanceof ContractFileError
    ) {
      writeLine(
        context.stderr,
        [
          "GrantTrace check blocked",
          "",
          error.message,
          "",
          "Next",
          "  Repair or regenerate the affected file, then retry.",
          "",
        ].join("\n"),
      );
      return ExitCode.analysisFailure;
    }
    writeLine(
      context.stderr,
      "GrantTrace check failed: the observations or accepted contract are invalid.",
    );
    return ExitCode.analysisFailure;
  }
}

function reviewNextAction(
  presentation: "record" | "standalone",
  context: CliContext,
): "noninteractive" | "prompt" | "standalone" {
  if (presentation === "standalone") {
    return "standalone";
  }
  return context.confirm === undefined ? "noninteractive" : "prompt";
}

function renderOperationLocked(operation: string): string {
  return [
    "GrantTrace check blocked",
    "",
    `Another GrantTrace operation is active, so ${operation} cannot write safely.`,
    "",
    "Next",
    "  Run granttrace doctor and inspect local session state before retrying.",
    "",
  ].join("\n");
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

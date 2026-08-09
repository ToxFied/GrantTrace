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
import {
  renderCheckMarkdown,
  serializeCheckReport,
  type CheckReportInput,
} from "../reporting/check-output.js";
import { appendGithubStepSummary } from "../reporting/github-summary.js";
import type { Observation } from "../contract/observation.js";
import { retainUnobservedManualKeeps } from "../contract/manual-keeps.js";
import { preserveFrontierSelection } from "../contract/frontier.js";
import type { CliContext } from "./context.js";
import { writeLine } from "./context.js";
import { ExitCode, type ExitCodeValue } from "./exit-codes.js";
import {
  acquireLocalOperationLock,
  type LocalOperationLock,
} from "../security/local-state.js";

type CheckOptions = {
  accept: boolean;
  format: "json" | "markdown" | "text";
  githubStepSummary: boolean;
  lockPath: string;
  observationsPath: string;
};

type CheckExecution = {
  code: ExitCodeValue;
  destination: "stdout" | "stderr";
  report: CheckReportInput;
  text: string;
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
        "  granttrace check [--format <text|json|markdown>]",
        "  granttrace check [--github-step-summary]",
        "  granttrace check [--observations <path>] [--lock <path>]",
        "",
        "Without --accept, every semantic change exits 6 for CI review.",
        "--accept writes the reviewed contract to granttrace.lock.json.",
        "--accept is refused when CI is enabled.",
        "--github-step-summary safely appends Markdown only when explicitly requested.",
        "",
      ].join("\n"),
    );
    return ExitCode.success;
  }
  const options = parseCheckArguments(args, context.cwd);
  if (options === null) {
    writeLine(
      context.stderr,
      "Usage: granttrace check [--accept] [--format <text|json|markdown>] [--github-step-summary] [--observations <path>] [--lock <path>]",
    );
    return ExitCode.usage;
  }

  if (options.accept && isContinuousIntegration(context.environment)) {
    return emitCheckExecution(options, context, {
      code: ExitCode.usage,
      destination: "stderr",
      report: {
        status: "acceptance_refused",
        exitCode: ExitCode.usage,
        reason: "ci_accept_forbidden",
      },
      text: renderCiAcceptRefused(),
    });
  }

  let operationLock: LocalOperationLock | null = null;
  if (options.accept) {
    try {
      operationLock = await acquireLocalOperationLock(context.cwd);
    } catch {
      return emitCheckExecution(options, context, {
        code: ExitCode.analysisFailure,
        destination: "stderr",
        report: {
          status: "analysis_failed",
          exitCode: ExitCode.analysisFailure,
          reason: "operation_locked",
        },
        text: renderOperationLocked("check --accept"),
      });
    }
  }

  const result = await executeCheck(options, context, presentation);
  if (operationLock !== null) {
    try {
      await operationLock.release();
    } catch {
      return emitCheckExecution(options, context, {
        code: ExitCode.analysisFailure,
        destination: "stderr",
        report: {
          status: "analysis_failed",
          exitCode: ExitCode.analysisFailure,
          reason: "operation_lock_cleanup_failed",
        },
        text: [
          "GrantTrace check cleanup failed",
          "",
          "The operation lock could not be removed. Inspect .granttrace/active-operation before retrying.",
          "",
        ].join("\n"),
      });
    }
  }
  return emitCheckExecution(options, context, result);
}

async function executeCheck(
  options: CheckOptions,
  context: CliContext,
  presentation: "record" | "standalone",
): Promise<CheckExecution> {
  try {
    if (!(await pathExists(options.observationsPath))) {
      return checkExecution(
        ExitCode.instrumentation,
        "no_observations",
        renderNoObservations(),
        "stderr",
      );
    }
    const observations = await loadObservationSource(options.observationsPath);
    const lockExists = await pathExists(options.lockPath);
    if (observations.length === 0 && !lockExists) {
      return checkExecution(
        ExitCode.instrumentation,
        "no_observations",
        renderNoObservations(),
        "stderr",
      );
    }

    const next = buildContract(observations, githubPermissionCatalog);
    if (next.unknowns.length > 0) {
      return checkExecution(
        ExitCode.evidenceBlocked,
        "evidence_blocked",
        renderAnalysisReport(next, observations.length),
        "stderr",
        { contract: next },
      );
    }

    if (!lockExists) {
      if (options.accept) {
        await writeContractAtomic(options.lockPath, next);
        return checkExecution(
          ExitCode.success,
          "accepted",
          renderAccepted(next),
          "stdout",
          { contract: next },
        );
      }

      const emptyPrevious = {
        ...next,
        scenarios: [],
        routes: [],
        selectedPermissions: {},
        permissionFrontier: [{}],
      };
      const diff = diffContracts(emptyPrevious, next);
      return checkExecution(
        ExitCode.contractChanged,
        "review_required",
        renderContractDiff(diff, next, {
          nextAction: reviewNextAction(presentation, context),
        }),
        "stderr",
        { contract: next, diff },
      );
    }

    const loadedPrevious = await readContractWithMetadata(options.lockPath);
    const previous = loadedPrevious.contract;
    const nextWithSelection = preserveFrontierSelection(
      next,
      previous.selectedPermissions,
    );
    const nextWithManualKeeps = {
      ...nextWithSelection,
      manualKeeps: retainUnobservedManualKeeps(
        previous,
        nextWithSelection.selectedPermissions,
      ),
    };
    if (
      !loadedPrevious.migratedFromV1 &&
      !loadedPrevious.migratedFromLegacyV2 &&
      serializeContract(previous) === serializeContract(nextWithManualKeeps)
    ) {
      return checkExecution(
        ExitCode.success,
        "passed",
        renderCheckSuccess(nextWithManualKeeps),
        "stdout",
        { contract: nextWithManualKeeps },
      );
    }

    const diff = diffContracts(previous, nextWithManualKeeps);

    if (options.accept) {
      await writeContractAtomic(options.lockPath, nextWithManualKeeps);
      const removedKeeps = Object.keys(previous.manualKeeps).filter(
        (permission) =>
          nextWithManualKeeps.manualKeeps[permission] === undefined,
      );
      return checkExecution(
        ExitCode.success,
        "accepted",
        renderAccepted(nextWithManualKeeps, { removedKeeps }),
        "stdout",
        {
          contract: nextWithManualKeeps,
          diff,
          migratedFromV1: loadedPrevious.migratedFromV1,
          migratedFromLegacyV2: loadedPrevious.migratedFromLegacyV2,
        },
      );
    }

    return checkExecution(
      ExitCode.contractChanged,
      "review_required",
      renderContractDiff(diff, nextWithManualKeeps, {
        migratedFromV1: loadedPrevious.migratedFromV1,
        migratedFromLegacyV2: loadedPrevious.migratedFromLegacyV2,
        nextAction: reviewNextAction(presentation, context),
      }),
      "stderr",
      {
        contract: nextWithManualKeeps,
        diff,
        migratedFromV1: loadedPrevious.migratedFromV1,
        migratedFromLegacyV2: loadedPrevious.migratedFromLegacyV2,
      },
    );
  } catch (error) {
    if (
      error instanceof ObservationFileError ||
      error instanceof ContractFileError
    ) {
      return checkExecution(
        ExitCode.analysisFailure,
        "analysis_failed",
        [
          "GrantTrace check blocked",
          "",
          error.message,
          "",
          "Next",
          "  Repair or regenerate the affected file, then retry.",
          "",
        ].join("\n"),
        "stderr",
        { reason: "invalid_artifact" },
      );
    }
    return checkExecution(
      ExitCode.analysisFailure,
      "analysis_failed",
      "GrantTrace check failed: the observations or accepted contract are invalid.",
      "stderr",
      { reason: "invalid_artifact" },
    );
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
  let format: CheckOptions["format"] = "text";
  let formatSet = false;
  let githubStepSummary = false;
  let lockPath = join(cwd, "granttrace.lock.json");
  let observationsPath = join(cwd, ".granttrace", "observations");

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--accept" && !accept) {
      accept = true;
      continue;
    }
    if (argument === "--github-step-summary" && !githubStepSummary) {
      githubStepSummary = true;
      continue;
    }
    if (argument === "--format" && !formatSet) {
      const value = args[index + 1];
      if (value !== "text" && value !== "json" && value !== "markdown") {
        return null;
      }
      format = value;
      formatSet = true;
      index += 1;
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

  return {
    accept,
    format,
    githubStepSummary,
    lockPath,
    observationsPath,
  };
}

async function emitCheckExecution(
  options: CheckOptions,
  context: CliContext,
  execution: CheckExecution,
): Promise<ExitCodeValue> {
  if (options.githubStepSummary) {
    try {
      await appendGithubStepSummary(
        context.environment,
        renderCheckMarkdown(execution.report),
      );
    } catch {
      const summaryFailure = checkExecution(
        ExitCode.analysisFailure,
        "analysis_failed",
        [
          "GrantTrace check blocked",
          "",
          "The GitHub step summary file is unavailable or unsafe.",
          "",
        ].join("\n"),
        "stderr",
        { reason: "summary_unavailable" },
      );
      writeCheckExecution(options.format, context, summaryFailure);
      return summaryFailure.code;
    }
  }

  writeCheckExecution(options.format, context, execution);
  return execution.code;
}

function writeCheckExecution(
  format: CheckOptions["format"],
  context: CliContext,
  execution: CheckExecution,
): void {
  if (format === "json") {
    writeLine(context.stdout, serializeCheckReport(execution.report));
    return;
  }
  if (format === "markdown") {
    writeLine(context.stdout, renderCheckMarkdown(execution.report));
    return;
  }
  writeLine(context[execution.destination], execution.text);
}

function checkExecution(
  code: ExitCodeValue,
  status: CheckReportInput["status"],
  text: string,
  destination: CheckExecution["destination"],
  report: Omit<CheckReportInput, "exitCode" | "status"> = {},
): CheckExecution {
  return {
    code,
    destination,
    report: { status, exitCode: code, ...report },
    text,
  };
}

function isContinuousIntegration(environment: NodeJS.ProcessEnv): boolean {
  if (environment["GITHUB_ACTIONS"] === "true") {
    return true;
  }
  const value = environment["CI"]?.trim().toLowerCase();
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

function renderCiAcceptRefused(): string {
  return [
    "GrantTrace check refused",
    "",
    "Contract acceptance is disabled when CI is enabled.",
    "Review and accept the contract in a trusted local checkout.",
    "",
  ].join("\n");
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

import type { GrantTraceContract } from "../contract/schema.js";
import { contractHash } from "../contract/serialize.js";
import { GITHUB_API_VERSION, TOOL_VERSION } from "../version.js";
import {
  runProofChild,
  type ProofChildOutcome,
  type ProofChildResult,
} from "./child-runner.js";
import type { LiveCommentTransport } from "./comment-transport.js";
import {
  verifyProofObservations,
  validateAcceptedProofContract,
} from "./contract-verification.js";
import {
  ProofFailureSchema,
  type ProofFailure,
} from "./failure.js";
import type { LiveFixtureConfig } from "./live-config.js";
import { runPermissionNegativeControl } from "./negative-control.js";
import { MANDATORY_INSTALLATION_PERMISSIONS } from "./permission-baseline.js";
import type { ProofRunReport } from "./report.js";
import {
  mintRestrictedInstallationToken,
  type InstallationTokenTransport,
} from "./token-broker.js";

export type ProofExecutionDependencies = {
  tokenTransport?: InstallationTokenTransport;
  commentTransport?: LiveCommentTransport;
  runChild?: typeof runProofChild;
  now?: Date;
  sourceCommit?: string | null;
};

export type ProofExecutionResult = {
  report: ProofRunReport;
  success: boolean;
};

export async function executeProof(input: {
  config: LiveFixtureConfig | null;
  contract: GrantTraceContract;
  scenario: string;
  cwd: string;
  command: string;
  args: string[];
  baseEnvironment: NodeJS.ProcessEnv;
  dependencies?: ProofExecutionDependencies;
}): Promise<ProofExecutionResult> {
  const dependencies = input.dependencies ?? {};
  let report = initialReport(
    input.contract,
    input.scenario,
    dependencies.sourceCommit ?? null,
  );

  try {
    validateAcceptedProofContract(input.contract, input.scenario);
  } catch {
    report = failPositive(report, "contract_mismatch");
    return { report, success: false };
  }
  if (input.config === null) {
    report = failPositive(report, "configuration_failure");
    return { report, success: false };
  }

  let token;
  try {
    token = await mintRestrictedInstallationToken(
      input.config,
      input.contract.selectedPermissions,
      {
        ...(dependencies.tokenTransport === undefined
          ? {}
          : { transport: dependencies.tokenTransport }),
        ...(dependencies.now === undefined
          ? {}
          : { now: dependencies.now }),
      },
    );
  } catch (error) {
    report = failPositive(report, readFailureCode(error));
    return { report, success: false };
  }

  report = {
    ...report,
    mandatoryPermissions: token.mandatoryPermissions,
    effectivePermissions: token.effectivePermissions,
    repositoryScopeVerified: true,
  };

  const childRunner = dependencies.runChild ?? runProofChild;
  const child = await childRunner({
    cwd: input.cwd,
    command: input.command,
    args: input.args,
    baseEnvironment: input.baseEnvironment,
    token: token.token,
    fixture: input.config.fixtureCoordinates(),
    scenario: input.scenario,
  });
  report = withChild(report, child);

  if (child.outcome !== "pass") {
    report = failPositive(report, mapChildFailure(child.outcome));
    report = {
      ...report,
      cleanup:
        child.sessionCleanup === "pass"
          ? { status: "pass" }
          : { status: "failed", failure: "cleanup_failure" },
    };
    return { report, success: false };
  }

  try {
    verifyProofObservations(
      input.contract,
      input.scenario,
      child.observations,
    );
  } catch {
    report = failPositive(report, "contract_mismatch");
    report = {
      ...report,
      cleanup:
        child.sessionCleanup === "pass"
          ? { status: "pass" }
          : { status: "failed", failure: "cleanup_failure" },
    };
    return { report, success: false };
  }
  report = {
    ...report,
    contractMatched: true,
    positiveProof: { status: "pass" },
    cleanup: { status: "pass" },
  };
  if (child.sessionCleanup === "cleanup_failure") {
    report = {
      ...report,
      cleanup: { status: "failed", failure: "cleanup_failure" },
    };
    return { report, success: false };
  }

  const negative = await runPermissionNegativeControl({
    config: input.config,
    contract: input.contract,
    positiveToken: token,
    ...(dependencies.tokenTransport === undefined
      ? {}
      : { tokenTransport: dependencies.tokenTransport }),
    ...(dependencies.commentTransport === undefined
      ? {}
      : { commentTransport: dependencies.commentTransport }),
    ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
  });
  report = {
    ...report,
    negativeControl: negative.result,
    cleanup:
      negative.cleanup === "pass"
        ? { status: "pass" }
        : { status: "failed", failure: "cleanup_failure" },
  };
  const negativePassed =
    negative.result.status === "expected_rejection" ||
    negative.result.status === "not_applicable";
  return {
    report,
    success: negativePassed && negative.cleanup === "pass",
  };
}

function initialReport(
  contract: GrantTraceContract,
  scenario: string,
  sourceCommit: string | null,
): ProofRunReport {
  return {
    schemaVersion: 1,
    toolVersion: TOOL_VERSION,
    apiVersion: GITHUB_API_VERSION,
    sourceCommit,
    scenario,
    catalog: contract.catalog,
    contractHash: contractHash(contract),
    selectedPermissions: contract.selectedPermissions,
    mandatoryPermissions: MANDATORY_INSTALLATION_PERMISSIONS,
    effectivePermissions: null,
    repositoryScopeVerified: false,
    contractMatched: false,
    child: {
      exitCode: null,
      signal: null,
      observedOperations: 0,
    },
    positiveProof: { status: "not_run" },
    negativeControl: { status: "not_run" },
    cleanup: { status: "not_run" },
  };
}

function failPositive(
  report: ProofRunReport,
  failure: ProofFailure,
): ProofRunReport {
  return {
    ...report,
    positiveProof: { status: "failed", failure },
  };
}

function withChild(
  report: ProofRunReport,
  child: ProofChildResult,
): ProofRunReport {
  return {
    ...report,
    child: {
      exitCode: child.exitCode,
      signal: child.signal,
      observedOperations: child.observations.length,
    },
  };
}

function mapChildFailure(outcome: ProofChildOutcome): ProofFailure {
  switch (outcome) {
    case "instrumentation_failure":
      return "instrumentation_failure";
    case "test_failure":
    case "spawn_failure":
      return "test_failure";
    case "timeout":
      return "test_flake_or_indeterminate";
    case "analysis_failure":
      return "test_flake_or_indeterminate";
    case "pass":
      return "test_flake_or_indeterminate";
  }
}

function readFailureCode(error: unknown): ProofFailure {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    const parsed = ProofFailureSchema.safeParse(
      (error as { code: unknown }).code,
    );
    if (parsed.success) {
      return parsed.data;
    }
  }
  return "test_flake_or_indeterminate";
}

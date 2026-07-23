import { Octokit } from "@octokit/core";

import { assignmentSatisfiesDNF } from "../permissions/canonical.js";
import type { GrantTraceContract } from "../contract/schema.js";
import type { PermissionAssignment } from "../permissions/types.js";
import { manualKeepPermissions } from "../contract/manual-keeps.js";
import { SensitiveValue } from "../security/sensitive-value.js";
import {
  classifyGitHubFailure,
  ProofFailureSchema,
  type ProofFailure,
} from "./failure.js";
import type {
  FixtureCoordinates,
  LiveFixtureConfig,
} from "./live-config.js";
import {
  mintRestrictedInstallationToken,
  type InstallationTokenTransport,
} from "./token-broker.js";
import type { ValidatedInstallationToken } from "./token-response.js";
import {
  OctokitCommentTransport,
  type CommentReference,
  type LiveCommentTransport,
} from "./comment-transport.js";
import { GITHUB_API_VERSION } from "../version.js";

const COMMENT_ROUTE =
  "/repos/{owner}/{repo}/issues/{issue_number}/comments";
const ISSUE_COMMENTS_READ_ROUTE =
  "/repos/{owner}/{repo}/issues/{issue_number}/comments";

export type NegativeControlMode = "read_only" | "mutating";
export type NegativeControlResult = {
  id: "issue-comments-read" | "issue-comment-create";
  mode: NegativeControlMode;
  removedPermission: "issues";
  status:
    | "not_run"
    | "not_applicable"
    | "expected_rejection"
    | "unexpected_pass"
    | "indeterminate";
  failure?: ProofFailure;
  cleanup: "not_required" | "pass" | "failed";
};

export interface LiveReadControlTransport {
  listIssueComments(input: {
    token: SensitiveValue;
    fixture: FixtureCoordinates;
  }): Promise<void>;
}

export class OctokitReadControlTransport
  implements LiveReadControlTransport
{
  public async listIssueComments(input: {
    token: SensitiveValue;
    fixture: FixtureCoordinates;
  }): Promise<void> {
    const octokit = new Octokit({ auth: input.token.reveal() });
    await octokit.request(
      "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        owner: input.fixture.owner,
        repo: input.fixture.repository,
        issue_number: Number(input.fixture.issueNumber),
        per_page: 1,
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": GITHUB_API_VERSION,
        },
      },
    );
  }
}

export type NegativeControlsExecution = {
  results: NegativeControlResult[];
  cleanup: "pass" | "cleanup_failure";
};

export async function runPermissionNegativeControls(input: {
  config: LiveFixtureConfig;
  contract: GrantTraceContract;
  positiveToken: ValidatedInstallationToken;
  tokenTransport?: InstallationTokenTransport;
  commentTransport?: LiveCommentTransport;
  readTransport?: LiveReadControlTransport;
  now?: Date;
}): Promise<NegativeControlsExecution> {
  const readResult = await runReadControl(input);
  const commentResult = await runCommentControl(input);
  const results = [readResult, commentResult];
  return {
    results,
    cleanup: results.some((result) => result.cleanup === "failed")
      ? "cleanup_failure"
      : "pass",
  };
}

function planPermissionRemoval(
  input: {
    contract: GrantTraceContract;
    positiveToken: ValidatedInstallationToken;
  },
  method: "GET" | "POST",
  template: string,
  permission: "issues",
): PermissionAssignment | null {
  const route = input.contract.routes.find(
    (candidate) =>
      candidate.method === method && candidate.template === template,
  );
  if (
    route === undefined ||
    input.contract.selectedPermissions[permission] === undefined ||
    manualKeepPermissions(input.contract)[permission] !== undefined
  ) {
    return null;
  }

  const permissions = { ...input.positiveToken.requestedPermissions };
  delete permissions[permission];
  return assignmentSatisfiesDNF(permissions, route.alternatives)
    ? null
    : permissions;
}

async function runReadControl(input: {
  config: LiveFixtureConfig;
  contract: GrantTraceContract;
  positiveToken: ValidatedInstallationToken;
  tokenTransport?: InstallationTokenTransport;
  readTransport?: LiveReadControlTransport;
  now?: Date;
}): Promise<NegativeControlResult> {
  const base = {
    id: "issue-comments-read" as const,
    mode: "read_only" as const,
    removedPermission: "issues" as const,
  };
  const permissions = planPermissionRemoval(
    input,
    "GET",
    ISSUE_COMMENTS_READ_ROUTE,
    "issues",
  );
  if (permissions === null) {
    return {
      ...base,
      status: "not_applicable",
      cleanup: "not_required",
    };
  }

  const token = await mintNegativeToken(input, permissions);
  if ("failure" in token) {
    return {
      ...base,
      status: "indeterminate",
      failure: token.failure,
      cleanup: "not_required",
    };
  }

  try {
    await (input.readTransport ?? new OctokitReadControlTransport())
      .listIssueComments({
        token: token.value.token,
        fixture: input.config.fixtureCoordinates(),
      });
    return {
      ...base,
      status: "unexpected_pass",
      cleanup: "not_required",
    };
  } catch (error) {
    const failure = classifyGitHubFailure(error, {
      tokenExpiresAt: token.value.expiresAt,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
    return failure === "authorization_failure"
      ? {
          ...base,
          status: "expected_rejection",
          cleanup: "not_required",
        }
      : {
          ...base,
          status: "indeterminate",
          failure,
          cleanup: "not_required",
        };
  }
}

async function runCommentControl(input: {
  config: LiveFixtureConfig;
  contract: GrantTraceContract;
  positiveToken: ValidatedInstallationToken;
  tokenTransport?: InstallationTokenTransport;
  commentTransport?: LiveCommentTransport;
  now?: Date;
}): Promise<NegativeControlResult> {
  const base = {
    id: "issue-comment-create" as const,
    mode: "mutating" as const,
    removedPermission: "issues" as const,
  };
  const permissions = planPermissionRemoval(
    input,
    "POST",
    COMMENT_ROUTE,
    "issues",
  );
  if (permissions === null) {
    return {
      ...base,
      status: "not_applicable",
      cleanup: "not_required",
    };
  }

  const token = await mintNegativeToken(input, permissions);
  if ("failure" in token) {
    return {
      ...base,
      status: "indeterminate",
      failure: token.failure,
      cleanup: "not_required",
    };
  }

  const transport = input.commentTransport ?? new OctokitCommentTransport();
  const fixture = input.config.fixtureCoordinates();
  let unexpectedComment: CommentReference | null = null;
  try {
    unexpectedComment = await transport.createComment({
      token: token.value.token,
      fixture,
    });
  } catch (error) {
    const failure = classifyGitHubFailure(error, {
      tokenExpiresAt: token.value.expiresAt,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
    return failure === "authorization_failure"
      ? {
          ...base,
          status: "expected_rejection",
          cleanup: "not_required",
        }
      : {
          ...base,
          status: "indeterminate",
          failure,
          cleanup: "not_required",
        };
  }

  try {
    await transport.deleteComment({
      token: input.positiveToken.token,
      fixture,
      comment: unexpectedComment,
    });
  } catch {
    return {
      ...base,
      status: "unexpected_pass",
      cleanup: "failed",
    };
  }
  return {
    ...base,
    status: "unexpected_pass",
    cleanup: "pass",
  };
}

async function mintNegativeToken(
  input: {
    config: LiveFixtureConfig;
    tokenTransport?: InstallationTokenTransport;
    now?: Date;
  },
  permissions: PermissionAssignment,
): Promise<
  | { value: ValidatedInstallationToken }
  | { failure: ProofFailure }
> {
  try {
    return {
      value: await mintRestrictedInstallationToken(
        input.config,
        permissions,
        {
          ...(input.tokenTransport === undefined
            ? {}
            : { transport: input.tokenTransport }),
          ...(input.now === undefined ? {} : { now: input.now }),
        },
      ),
    };
  } catch (error) {
    return {
      failure: readProofFailure(error) ?? classifyGitHubFailure(error),
    };
  }
}

function readProofFailure(error: unknown): ProofFailure | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error)
  ) {
    return null;
  }
  const parsed = ProofFailureSchema.safeParse(
    (error as { code?: unknown }).code,
  );
  return parsed.success ? parsed.data : null;
}

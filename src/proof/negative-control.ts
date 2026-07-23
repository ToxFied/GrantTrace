import { assignmentSatisfiesDNF } from "../permissions/canonical.js";
import type { GrantTraceContract } from "../contract/schema.js";
import type { PermissionAssignment } from "../permissions/types.js";
import {
  classifyGitHubFailure,
  ProofFailureSchema,
  type ProofFailure,
} from "./failure.js";
import type { LiveFixtureConfig } from "./live-config.js";
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

const COMMENT_ROUTE =
  "/repos/{owner}/{repo}/issues/{issue_number}/comments";

export type NegativeControlExecution = {
  result:
    | { status: "not_applicable" }
    | { status: "expected_rejection" }
    | { status: "unexpected_pass" }
    | {
        status: "indeterminate";
        failure: ProofFailure;
      };
  cleanup: "pass" | "cleanup_failure";
};

export async function runPermissionNegativeControl(input: {
  config: LiveFixtureConfig;
  contract: GrantTraceContract;
  positiveToken: ValidatedInstallationToken;
  tokenTransport?: InstallationTokenTransport;
  commentTransport?: LiveCommentTransport;
  now?: Date;
}): Promise<NegativeControlExecution> {
  const route = input.contract.routes.find(
    (candidate) =>
      candidate.method === "POST" &&
      candidate.template === COMMENT_ROUTE,
  );
  if (
    route === undefined ||
    input.contract.selectedPermissions["issues"] !== "write"
  ) {
    return { result: { status: "not_applicable" }, cleanup: "pass" };
  }

  const permissions: PermissionAssignment = {
    ...input.contract.selectedPermissions,
  };
  delete permissions["issues"];
  if (assignmentSatisfiesDNF(permissions, route.alternatives)) {
    return { result: { status: "not_applicable" }, cleanup: "pass" };
  }
  if (Object.keys(permissions).length === 0) {
    permissions["contents"] = "read";
  }

  let negativeToken: ValidatedInstallationToken;
  try {
    negativeToken = await mintRestrictedInstallationToken(
      input.config,
      permissions,
      {
        ...(input.tokenTransport === undefined
          ? {}
          : { transport: input.tokenTransport }),
        ...(input.now === undefined ? {} : { now: input.now }),
      },
    );
  } catch (error) {
    return {
      result: {
        status: "indeterminate",
        failure:
          readProofFailure(error) ?? classifyGitHubFailure(error),
      },
      cleanup: "pass",
    };
  }

  const transport =
    input.commentTransport ?? new OctokitCommentTransport();
  const fixture = input.config.fixtureCoordinates();
  let unexpectedComment: CommentReference | null = null;
  let rejection: ProofFailure | null = null;
  try {
    unexpectedComment = await transport.createComment({
      token: negativeToken.token,
      fixture,
    });
  } catch (error) {
    rejection = classifyGitHubFailure(error, {
      tokenExpiresAt: negativeToken.expiresAt,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
  } finally {
    if (unexpectedComment !== null) {
      try {
        await transport.deleteComment({
          token: input.positiveToken.token,
          fixture,
          comment: unexpectedComment,
        });
      } catch {
        return {
          result: { status: "unexpected_pass" },
          cleanup: "cleanup_failure",
        };
      }
    }
  }

  if (unexpectedComment !== null) {
    return {
      result: { status: "unexpected_pass" },
      cleanup: "pass",
    };
  }
  if (rejection === "authorization_failure") {
    return {
      result: { status: "expected_rejection" },
      cleanup: "pass",
    };
  }
  return {
    result: {
      status: "indeterminate",
      failure: rejection ?? "test_flake_or_indeterminate",
    },
    cleanup: "pass",
  };
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

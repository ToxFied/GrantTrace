import type { PermissionAssignment } from "../permissions/types.js";
import {
  classifyGitHubFailure,
  ProofFailureSchema,
  type ProofFailure,
} from "./failure.js";
import type { LiveFixtureConfig } from "./live-config.js";
import {
  mintBroadInstallationToken,
  mintRestrictedInstallationToken,
  type InstallationTokenTransport,
} from "./token-broker.js";
import type { ValidatedInstallationToken } from "./token-response.js";
import {
  OctokitCommentTransport,
  type CommentReference,
  type LiveCommentTransport,
} from "./comment-transport.js";

const BROAD_FIXTURE_PERMISSIONS: PermissionAssignment = {
  actions: "read",
  contents: "write",
  issues: "write",
};
const POSITIVE_PERMISSIONS: PermissionAssignment = {
  issues: "write",
};
const NEGATIVE_PERMISSIONS: PermissionAssignment = {
  contents: "read",
};

export type LiveFeasibilityResult = {
  broadEffectivePermissions: PermissionAssignment;
  restrictedEffectivePermissions: PermissionAssignment;
  negativeEffectivePermissions: PermissionAssignment;
  repositoryScopeVerified: true;
  positiveComment: "pass";
  positiveCleanup: "pass";
  negativeControl: "expected_rejection";
  negativeCleanup: "not_needed" | "pass";
};

export class LiveFeasibilityError extends Error {
  public readonly phase:
    | "broad_token"
    | "restricted_token"
    | "positive_comment"
    | "positive_cleanup"
    | "negative_token"
    | "negative_control"
    | "negative_cleanup";
  public readonly failure: ProofFailure | "unexpected_pass";

  public constructor(
    phase: LiveFeasibilityError["phase"],
    failure: LiveFeasibilityError["failure"],
  ) {
    super(`The live feasibility spike failed during ${phase} (${failure}).`);
    this.name = "LiveFeasibilityError";
    this.phase = phase;
    this.failure = failure;
  }

  public toJSON(): {
    phase: LiveFeasibilityError["phase"];
    failure: LiveFeasibilityError["failure"];
  } {
    return { phase: this.phase, failure: this.failure };
  }
}

export async function runLiveFeasibilitySpike(
  config: LiveFixtureConfig,
  options: {
    tokenTransport?: InstallationTokenTransport;
    commentTransport?: LiveCommentTransport;
    now?: Date;
  } = {},
): Promise<LiveFeasibilityResult> {
  const tokenOptions = {
    ...(options.tokenTransport === undefined
      ? {}
      : { transport: options.tokenTransport }),
    ...(options.now === undefined ? {} : { now: options.now }),
  };
  const commentTransport =
    options.commentTransport ?? new OctokitCommentTransport();
  const fixture = config.fixtureCoordinates();

  const broad = await tokenPhase("broad_token", () =>
    mintBroadInstallationToken(
      config,
      BROAD_FIXTURE_PERMISSIONS,
      tokenOptions,
    ),
  );
  const restricted = await tokenPhase("restricted_token", () =>
    mintRestrictedInstallationToken(
      config,
      POSITIVE_PERMISSIONS,
      tokenOptions,
    ),
  );

  let positiveComment: CommentReference | null = null;
  try {
    positiveComment = await commentTransport.createComment({
      token: restricted.token,
      fixture,
    });
  } catch (error) {
    throw new LiveFeasibilityError(
      "positive_comment",
      classifyGitHubFailure(error, tokenClock(restricted, options.now)),
    );
  } finally {
    if (positiveComment !== null) {
      try {
        await commentTransport.deleteComment({
          token: restricted.token,
          fixture,
          comment: positiveComment,
        });
      } catch {
        throw new LiveFeasibilityError(
          "positive_cleanup",
          "cleanup_failure",
        );
      }
    }
  }

  const negative = await tokenPhase("negative_token", () =>
    mintRestrictedInstallationToken(
      config,
      NEGATIVE_PERMISSIONS,
      tokenOptions,
    ),
  );
  let unexpectedComment: CommentReference | null = null;
  let rejection: ProofFailure | null = null;
  let negativeCleanup: LiveFeasibilityResult["negativeCleanup"] =
    "not_needed";
  try {
    unexpectedComment = await commentTransport.createComment({
      token: negative.token,
      fixture,
    });
  } catch (error) {
    rejection = classifyGitHubFailure(
      error,
      tokenClock(negative, options.now),
    );
  } finally {
    if (unexpectedComment !== null) {
      try {
        await commentTransport.deleteComment({
          token: restricted.token,
          fixture,
          comment: unexpectedComment,
        });
        negativeCleanup = "pass";
      } catch {
        throw new LiveFeasibilityError(
          "negative_cleanup",
          "cleanup_failure",
        );
      }
    }
  }

  if (unexpectedComment !== null) {
    throw new LiveFeasibilityError(
      "negative_control",
      "unexpected_pass",
    );
  }
  if (rejection !== "authorization_failure") {
    throw new LiveFeasibilityError(
      "negative_control",
      rejection ?? "test_flake_or_indeterminate",
    );
  }

  return {
    broadEffectivePermissions: broad.effectivePermissions,
    restrictedEffectivePermissions: restricted.effectivePermissions,
    negativeEffectivePermissions: negative.effectivePermissions,
    repositoryScopeVerified: true,
    positiveComment: "pass",
    positiveCleanup: "pass",
    negativeControl: "expected_rejection",
    negativeCleanup,
  };
}

async function tokenPhase<T>(
  phase: Extract<
    LiveFeasibilityError["phase"],
    "broad_token" | "restricted_token" | "negative_token"
  >,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new LiveFeasibilityError(
      phase,
      readProofFailure(error) ?? classifyGitHubFailure(error),
    );
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

function tokenClock(
  token: ValidatedInstallationToken,
  now: Date | undefined,
): {
  tokenExpiresAt: Date;
  now?: Date;
} {
  return {
    tokenExpiresAt: token.expiresAt,
    ...(now === undefined ? {} : { now }),
  };
}

import { generateKeyPairSync } from "node:crypto";

import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  LiveFeasibilityError,
  runLiveFeasibilitySpike,
} from "../../src/proof/live-feasibility.js";
import type {
  CommentReference,
  LiveCommentTransport,
} from "../../src/proof/comment-transport.js";
import { LiveFixtureConfig } from "../../src/proof/live-config.js";
import type {
  InstallationTokenRequest,
  InstallationTokenTransport,
} from "../../src/proof/token-broker.js";
import { SensitiveValue } from "../../src/security/sensitive-value.js";

const now = new Date("2026-07-23T12:00:00.000Z");

describe("live feasibility orchestration", () => {
  let config: LiveFixtureConfig;

  beforeAll(() => {
    const pair = generateKeyPairSync("rsa", {
      modulusLength: 2_048,
      privateKeyEncoding: {
        type: "pkcs8",
        format: "pem",
      },
      publicKeyEncoding: {
        type: "spki",
        format: "pem",
      },
    });
    config = LiveFixtureConfig.load({
      GRANTTRACE_APP_ID: "12345",
      GRANTTRACE_INSTALLATION_ID: "98765",
      GRANTTRACE_APP_PRIVATE_KEY: pair.privateKey,
      GRANTTRACE_LIVE_OWNER: "fixture-owner",
      GRANTTRACE_LIVE_REPOSITORY:
        "private-granttrace-fixture",
      GRANTTRACE_LIVE_ISSUE_NUMBER: "73",
      GRANTTRACE_LIVE_CONFIRM_DISPOSABLE: "1",
    });
  });

  it("proves the positive operation, cleanup, and authorization rejection", async () => {
    const requests: InstallationTokenRequest[] = [];
    const tokenTransport = tokenFixture(requests);
    const created: string[] = [];
    const deleted: string[] = [];
    const commentTransport: LiveCommentTransport = {
      async createComment({ token }) {
        const value = token.reveal();
        created.push(value);
        if (value === "ghs_NEGATIVE_TOKEN_CANARY") {
          throw { status: 403 };
        }
        return reference("88001");
      },
      async deleteComment({ token, comment }) {
        expect(token.reveal()).toBe("ghs_RESTRICTED_TOKEN_CANARY");
        deleted.push(comment.id.reveal());
      },
    };

    const result = await runLiveFeasibilitySpike(config, {
      tokenTransport,
      commentTransport,
      now,
    });

    expect(requests.map((request) => request.permissions)).toEqual([
      null,
      { issues: "write" },
      { contents: "read" },
    ]);
    expect(created).toEqual([
      "ghs_RESTRICTED_TOKEN_CANARY",
      "ghs_NEGATIVE_TOKEN_CANARY",
    ]);
    expect(deleted).toEqual(["88001"]);
    expect(result).toEqual({
      broadEffectivePermissions: {
        actions: "read",
        contents: "write",
        issues: "write",
        metadata: "read",
      },
      restrictedEffectivePermissions: {
        issues: "write",
        metadata: "read",
      },
      negativeEffectivePermissions: {
        contents: "read",
        metadata: "read",
      },
      repositoryScopeVerified: true,
      positiveComment: "pass",
      positiveCleanup: "pass",
      negativeControl: "expected_rejection",
      negativeCleanup: "not_needed",
    });
    expect(JSON.stringify(result)).not.toContain("TOKEN_CANARY");
  });

  it("always deletes an unexpected negative-control comment before failing", async () => {
    const deleted: string[] = [];
    const commentTransport: LiveCommentTransport = {
      async createComment({ token }) {
        return token.reveal() === "ghs_NEGATIVE_TOKEN_CANARY"
          ? reference("99002")
          : reference("99001");
      },
      async deleteComment({ comment }) {
        deleted.push(comment.id.reveal());
      },
    };

    await expect(
      runLiveFeasibilitySpike(config, {
        tokenTransport: tokenFixture([]),
        commentTransport,
        now,
      }),
    ).rejects.toMatchObject({
      phase: "negative_control",
      failure: "unexpected_pass",
    });
    expect(deleted).toEqual(["99001", "99002"]);
  });

  it("distinguishes rate limiting from the expected authorization rejection", async () => {
    const commentTransport: LiveCommentTransport = {
      async createComment({ token }) {
        if (token.reveal() === "ghs_NEGATIVE_TOKEN_CANARY") {
          throw {
            status: 403,
            response: {
              headers: { "x-ratelimit-remaining": "0" },
            },
          };
        }
        return reference("77001");
      },
      async deleteComment() {},
    };

    await expect(
      runLiveFeasibilitySpike(config, {
        tokenTransport: tokenFixture([]),
        commentTransport,
        now,
      }),
    ).rejects.toMatchObject({
      phase: "negative_control",
      failure: "rate_limited",
    });
  });

  it("reports positive cleanup failure independently", async () => {
    const commentTransport: LiveCommentTransport = {
      async createComment() {
        return reference("66001");
      },
      async deleteComment() {
        throw new Error("ghs_CLEANUP_ERROR_CANARY");
      },
    };

    let error: unknown;
    try {
      await runLiveFeasibilitySpike(config, {
        tokenTransport: tokenFixture([]),
        commentTransport,
        now,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(LiveFeasibilityError);
    expect(error).toMatchObject({
      phase: "positive_cleanup",
      failure: "cleanup_failure",
    });
    expect(JSON.stringify(error)).not.toContain("CLEANUP_ERROR_CANARY");
  });

  it("never invokes cleanup when positive comment creation fails", async () => {
    const cleanup = vi.fn(async () => undefined);
    const commentTransport: LiveCommentTransport = {
      async createComment() {
        throw { status: 503 };
      },
      deleteComment: cleanup,
    };

    await expect(
      runLiveFeasibilitySpike(config, {
        tokenTransport: tokenFixture([]),
        commentTransport,
        now,
      }),
    ).rejects.toMatchObject({
      phase: "positive_comment",
      failure: "github_unavailable",
    });
    expect(cleanup).not.toHaveBeenCalled();
  });
});

function tokenFixture(
  requests: InstallationTokenRequest[],
): InstallationTokenTransport {
  return {
    async createInstallationToken(request) {
      requests.push(request);
      const fullName =
        "fixture-owner/private-granttrace-fixture";
      if (request.permissions === null) {
        return response("ghs_BROAD_TOKEN_CANARY", {
          actions: "read",
          contents: "write",
          issues: "write",
          metadata: "read",
        }, fullName);
      }
      if (request.permissions["issues"] === "write") {
        return response("ghs_RESTRICTED_TOKEN_CANARY", {
          issues: "write",
          metadata: "read",
        }, fullName);
      }
      return response("ghs_NEGATIVE_TOKEN_CANARY", {
        contents: "read",
        metadata: "read",
      }, fullName);
    },
  };
}

function response(
  token: string,
  permissions: Record<string, string>,
  fullName: string,
) {
  return {
    token,
    expires_at: "2026-07-23T13:00:00.000Z",
    permissions,
    repositories: [{ full_name: fullName }],
  };
}

function reference(id: string): CommentReference {
  return { id: new SensitiveValue(id) };
}

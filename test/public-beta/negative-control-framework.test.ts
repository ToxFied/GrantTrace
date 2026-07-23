import { generateKeyPairSync } from "node:crypto";

import { beforeAll, describe, expect, it, vi } from "vitest";

import { buildContract } from "../../src/contract/build.js";
import type { Observation } from "../../src/contract/observation.js";
import { githubPermissionCatalog } from "../../src/evidence/catalog.js";
import type { LiveCommentTransport } from "../../src/proof/comment-transport.js";
import { LiveFixtureConfig } from "../../src/proof/live-config.js";
import {
  runPermissionNegativeControls,
  type LiveReadControlTransport,
} from "../../src/proof/negative-control.js";
import type {
  InstallationTokenRequest,
  InstallationTokenTransport,
} from "../../src/proof/token-broker.js";
import { validateInstallationTokenResponse } from "../../src/proof/token-response.js";
import { SensitiveValue } from "../../src/security/sensitive-value.js";

const now = new Date("2026-07-23T12:00:00.000Z");
const readRoute =
  "/repos/{owner}/{repo}/issues/{issue_number}/comments";

describe("explicit negative-control framework", () => {
  let config: LiveFixtureConfig;

  beforeAll(() => {
    const privateKey = generateKeyPairSync("rsa", {
      modulusLength: 2_048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    }).privateKey;
    config = LiveFixtureConfig.load({
      GRANTTRACE_APP_ID: "12345",
      GRANTTRACE_INSTALLATION_ID: "67890",
      GRANTTRACE_APP_PRIVATE_KEY: privateKey,
      GRANTTRACE_LIVE_OWNER: "fixture-owner",
      GRANTTRACE_LIVE_REPOSITORY: "private-granttrace-fixture",
      GRANTTRACE_LIVE_ISSUE_NUMBER: "73",
      GRANTTRACE_LIVE_CONFIRM_DISPOSABLE: "1",
    });
  });

  it("runs one read-only and one mutating control with no cleanup after rejection", async () => {
    const requests: InstallationTokenRequest[] = [];
    const readTransport: LiveReadControlTransport = {
      async listIssueComments() {
        throw { status: 403 };
      },
    };
    const deleteComment = vi.fn(async () => undefined);
    const commentTransport: LiveCommentTransport = {
      async createComment() {
        throw { status: 403 };
      },
      deleteComment,
    };

    const result = await runPermissionNegativeControls({
      config,
      contract: commentContract(),
      positiveToken: positiveToken(),
      tokenTransport: negativeTokenTransport(requests),
      readTransport,
      commentTransport,
      now,
    });

    expect(requests.map((request) => request.permissions)).toEqual([{}, {}]);
    expect(result).toEqual({
      results: [
        {
          id: "issue-comments-read",
          mode: "read_only",
          removedPermission: "issues",
          status: "expected_rejection",
          cleanup: "not_required",
        },
        {
          id: "issue-comment-create",
          mode: "mutating",
          removedPermission: "issues",
          status: "expected_rejection",
          cleanup: "not_required",
        },
      ],
      cleanup: "pass",
    });
    expect(deleteComment).not.toHaveBeenCalled();
  });

  it("never treats unexpected read success as passing evidence", async () => {
    const result = await runPermissionNegativeControls({
      config,
      contract: readOnlyContract(),
      positiveToken: positiveToken("read"),
      tokenTransport: negativeTokenTransport([]),
      readTransport: {
        async listIssueComments() {},
      },
      now,
    });

    expect(result.results[0]).toEqual({
      id: "issue-comments-read",
      mode: "read_only",
      removedPermission: "issues",
      status: "unexpected_pass",
      cleanup: "not_required",
    });
    expect(result.results[1]?.status).toBe("not_applicable");
  });

  it("reports cleanup failure independently after an unexpected mutation succeeds", async () => {
    const deleteComment = vi.fn(async () => {
      throw new Error("CLEANUP_ERROR_CANARY");
    });
    const result = await runPermissionNegativeControls({
      config,
      contract: commentContract(),
      positiveToken: positiveToken(),
      tokenTransport: negativeTokenTransport([]),
      readTransport: {
        async listIssueComments() {
          throw { status: 403 };
        },
      },
      commentTransport: {
        async createComment() {
          return { id: new SensitiveValue("123") };
        },
        deleteComment,
      },
      now,
    });

    expect(result.results[1]).toEqual({
      id: "issue-comment-create",
      mode: "mutating",
      removedPermission: "issues",
      status: "unexpected_pass",
      cleanup: "failed",
    });
    expect(result.cleanup).toBe("cleanup_failure");
    expect(deleteComment).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("CLEANUP_ERROR_CANARY");
  });

  it("reports unsupported controls as not applicable without minting", async () => {
    const createInstallationToken = vi.fn(async () => {
      throw new Error("Token minting must not run.");
    });
    const contract = buildContract(
      [
        observation(
          "GET",
          "/repos/{owner}/{repo}/contents/{path}",
          "contents",
          "read",
        ),
      ],
      githubPermissionCatalog,
    );

    const result = await runPermissionNegativeControls({
      config,
      contract,
      positiveToken: validateInstallationTokenResponse(
        tokenResponse({ contents: "read", metadata: "read" }),
        {
          requestedPermissions: { contents: "read" },
          mandatoryPermissions: { metadata: "read" },
          owner: "fixture-owner",
          repository: "private-granttrace-fixture",
        },
        now,
      ),
      tokenTransport: { createInstallationToken },
      now,
    });

    expect(result.results.every((item) => item.status === "not_applicable")).toBe(
      true,
    );
    expect(createInstallationToken).not.toHaveBeenCalled();
  });
});

function commentContract() {
  return buildContract(
    [
      observation("GET", readRoute, "issues", "read"),
      observation("POST", readRoute, "issues", "write"),
    ],
    githubPermissionCatalog,
  );
}

function readOnlyContract() {
  return buildContract(
    [observation("GET", readRoute, "issues", "read")],
    githubPermissionCatalog,
  );
}

function observation(
  method: "GET" | "POST",
  routeTemplate: string,
  permission: string,
  level: "read" | "write",
): Observation {
  return {
    schemaVersion: 1,
    scenario: "negative-control",
    method,
    routeTemplate,
    status: method === "POST" ? 201 : 200,
    requirements:
      routeTemplate === readRoute
        ? [
            [{ permission: "issues", level }],
            [{ permission: "pull_requests", level }],
          ]
        : [[{ permission, level }]],
    evidenceSource: "runtime_header",
    finding: null,
  };
}

function positiveToken(level: "read" | "write" = "write") {
  return validateInstallationTokenResponse(
    tokenResponse({ issues: level, metadata: "read" }),
    {
      requestedPermissions: { issues: level },
      mandatoryPermissions: { metadata: "read" },
      owner: "fixture-owner",
      repository: "private-granttrace-fixture",
    },
    now,
  );
}

function negativeTokenTransport(
  requests: InstallationTokenRequest[],
): InstallationTokenTransport {
  return {
    async createInstallationToken(request) {
      requests.push(request);
      return tokenResponse({ metadata: "read" });
    },
  };
}

function tokenResponse(permissions: Record<string, string>) {
  return {
    token: "NEGATIVE_CONTROL_TOKEN_CANARY",
    expires_at: "2026-07-23T13:00:00.000Z",
    permissions,
    repositories: [
      { full_name: "fixture-owner/private-granttrace-fixture" },
    ],
  };
}

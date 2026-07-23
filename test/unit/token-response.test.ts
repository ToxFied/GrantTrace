import { inspect } from "node:util";

import { describe, expect, it } from "vitest";

import {
  TokenResponseError,
  validateInstallationTokenResponse,
} from "../../src/proof/token-response.js";

const now = new Date("2026-07-23T12:00:00.000Z");
const expected = {
  requestedPermissions: { issues: "write" } as const,
  mandatoryPermissions: { metadata: "read" } as const,
  owner: "fixture-owner",
  repository: "private-granttrace-fixture",
};

describe("raw installation-token response validation", () => {
  it("accepts exact permissions, one expected repository, and an opaque token", () => {
    const result = validateInstallationTokenResponse(
      validResponse("opaque-token-with-no-assumed-prefix"),
      expected,
      now,
    );

    expect(result.requestedPermissions).toEqual({ issues: "write" });
    expect(result.mandatoryPermissions).toEqual({ metadata: "read" });
    expect(result.effectivePermissions).toEqual({
      issues: "write",
      metadata: "read",
    });
    expect(result.repositoryScopeVerified).toBe(true);
    expect(result.expiresAt.toISOString()).toBe(
      "2026-07-23T13:00:00.000Z",
    );
    expect(result.token.reveal()).toBe(
      "opaque-token-with-no-assumed-prefix",
    );
  });

  it("makes accidental token serialization and inspection safe", () => {
    const canary = "ghs_TOKEN_RESPONSE_CANARY";
    const result = validateInstallationTokenResponse(
      validResponse(canary),
      expected,
      now,
    );

    expect(JSON.stringify(result)).not.toContain(canary);
    expect(inspect(result.token)).toBe("[REDACTED]");
  });

  it("refuses missing effective-permission evidence", () => {
    const response = validResponse("token");
    delete response.permissions;

    expectErrorCode(response, "missing_effective_permissions");
  });

  it("refuses broader or different effective permissions", () => {
    expectErrorCode(
      {
        ...validResponse("token"),
        permissions: {
          issues: "write",
          metadata: "read",
          contents: "read",
        },
      },
      "effective_permission_mismatch",
    );
  });

  it("requires the explicit mandatory baseline in the effective response", () => {
    expectErrorCode(
      {
        ...validResponse("token"),
        permissions: { issues: "write" },
      },
      "effective_permission_mismatch",
    );
  });

  it("fails closed on unsupported effective access levels", () => {
    expectErrorCode(
      {
        ...validResponse("token"),
        permissions: { issues: "admin", metadata: "read" },
      },
      "invalid_token_response",
    );
  });

  it("refuses missing, broad, or different repository scope", () => {
    const missing = validResponse("token");
    delete missing.repositories;
    expectErrorCode(missing, "unverified_repository_scope");

    expectErrorCode(
      {
        ...validResponse("token"),
        repositories: [
          { full_name: "fixture-owner/private-granttrace-fixture" },
          { full_name: "fixture-owner/another-granttrace-fixture" },
        ],
      },
      "unverified_repository_scope",
    );

    expectErrorCode(
      {
        ...validResponse("token"),
        repositories: [
          { full_name: "other-owner/private-granttrace-fixture" },
        ],
      },
      "unverified_repository_scope",
    );
  });

  it("requires a fresh approximately one-hour token lifetime", () => {
    expectErrorCode(
      {
        ...validResponse("token"),
        expires_at: "2026-07-23T12:05:00.000Z",
      },
      "invalid_token_response",
    );
    expectErrorCode(
      {
        ...validResponse("token"),
        expires_at: "2026-07-23T14:00:00.000Z",
      },
      "invalid_token_response",
    );
  });
});

function validResponse(token: string): {
  token: string;
  expires_at: string;
  permissions?: Record<string, string>;
  repositories?: Array<{ full_name: string }>;
} {
  return {
    token,
    expires_at: "2026-07-23T13:00:00.000Z",
    permissions: { issues: "write", metadata: "read" },
    repositories: [
      { full_name: "fixture-owner/private-granttrace-fixture" },
    ],
  };
}

function expectErrorCode(
  response: unknown,
  code: TokenResponseError["code"],
): void {
  try {
    validateInstallationTokenResponse(response, expected, now);
    throw new Error("Expected token response validation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(TokenResponseError);
    expect((error as TokenResponseError).code).toBe(code);
  }
}

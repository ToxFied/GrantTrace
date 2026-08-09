import { inspect } from "node:util";

import { describe, expect, it } from "vitest";
import {
  classifyGitHubFailure,
} from "../../src/proof/failure.js";
import { createProofChildEnvironment } from "../../src/security/proof-environment.js";
import { SensitiveValue } from "../../src/security/sensitive-value.js";

describe("proof failure classification", () => {
  it.each([
    [{ status: 401 }, "authentication_failure"],
    [{ status: 403 }, "authorization_failure"],
    [
      {
        status: 403,
        response: {
          headers: { "x-ratelimit-remaining": "0" },
        },
      },
      "rate_limited",
    ],
    [
      {
        status: 403,
        response: { headers: { "retry-after": "60" } },
      },
      "rate_limited",
    ],
    [{ status: 429 }, "rate_limited"],
    [{ status: 404 }, "resource_not_found_or_hidden"],
    [{ status: 503 }, "github_unavailable"],
    [{ code: "ECONNRESET" }, "github_unavailable"],
    [{ status: 418 }, "test_flake_or_indeterminate"],
  ] as const)("classifies allowlisted response facts", (error, expected) => {
    expect(classifyGitHubFailure(error)).toBe(expected);
  });

  it("classifies expiry separately without retaining the error", () => {
    const error = {
      status: 401,
      request: {
        headers: {
          authorization: "Bearer ghs_ERROR_OBJECT_CANARY",
        },
      },
    };
    const result = classifyGitHubFailure(error, {
      tokenExpiresAt: new Date("2026-07-23T11:59:00.000Z"),
      now: new Date("2026-07-23T12:00:00.000Z"),
    });

    expect(result).toBe("token_expired");
    expect(JSON.stringify(result)).not.toContain(
      "ghs_ERROR_OBJECT_CANARY",
    );
  });

  it("never equates an ordinary 403 with proof of a missing permission", () => {
    expect(classifyGitHubFailure({ status: 403 })).toBe(
      "authorization_failure",
    );
  });
});

describe("proof child secret isolation", () => {
  it("rejects empty secrets and redacts every implicit representation", () => {
    expect(() => new SensitiveValue("")).toThrow(
      "A sensitive value cannot be empty.",
    );

    const secret = new SensitiveValue("ghs_SECRET_CANARY");
    expect(secret.reveal()).toBe("ghs_SECRET_CANARY");
    expect(secret.toString()).toBe("[REDACTED]");
    expect(JSON.stringify(secret)).toBe('"[REDACTED]"');
    expect(inspect(secret)).toBe("[REDACTED]");
  });

  it("starts from an allowlist and adds only the restricted token", () => {
    const restrictedToken = "ghs_RESTRICTED_CHILD_TOKEN";
    const environment = createProofChildEnvironment({
      baseEnvironment: {
        PATH: "/safe/bin",
        LANG: "en_US.UTF-8",
        HOME: "/secret/home",
        NODE_OPTIONS: "--require=/credential-stealer.js",
        GITHUB_TOKEN: "ghs_BROAD_TOKEN_CANARY",
        GH_TOKEN: "ghp_PAT_CANARY",
        GRANTTRACE_APP_ID: "12345",
        GRANTTRACE_INSTALLATION_ID: "98765",
        GRANTTRACE_APP_PRIVATE_KEY:
          "-----BEGIN PRIVATE KEY-----PRIVATE_KEY_CANARY",
        GRANTTRACE_LIVE_CONFIRM_DISPOSABLE: "1",
        UNRELATED_SECRET: "COOKIE_CANARY",
      },
      token: new SensitiveValue(restrictedToken),
      fixture: {
        owner: "fixture-owner",
        repository: "private-granttrace-fixture",
        issueNumber: "73",
      },
      scenario: "triage-integration",
      sessionDirectory: "/tmp/granttrace-session",
    });

    expect(environment).toEqual({
      PATH: "/safe/bin",
      LANG: "en_US.UTF-8",
      GITHUB_TOKEN: restrictedToken,
      GRANTTRACE_PROOF_MODE: "1",
      GRANTTRACE_RECORDING: "1",
      GRANTTRACE_SCENARIO: "triage-integration",
      GRANTTRACE_SESSION_DIR: "/tmp/granttrace-session",
      GRANTTRACE_LIVE_OWNER: "fixture-owner",
      GRANTTRACE_LIVE_REPOSITORY:
        "private-granttrace-fixture",
      GRANTTRACE_LIVE_ISSUE_NUMBER: "73",
    });
    const serialized = JSON.stringify(environment);
    for (const canary of [
      "ghs_BROAD_TOKEN_CANARY",
      "ghp_PAT_CANARY",
      "PRIVATE_KEY_CANARY",
      "COOKIE_CANARY",
      "credential-stealer",
    ]) {
      expect(serialized).not.toContain(canary);
    }
  });
});

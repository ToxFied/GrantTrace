import { generateKeyPairSync } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { buildContract } from "../../src/contract/build.js";
import type { Observation } from "../../src/contract/observation.js";
import { fixtureCatalog } from "../../src/evidence/catalog.js";
import type { LiveCommentTransport } from "../../src/proof/comment-transport.js";
import { LiveFixtureConfig } from "../../src/proof/live-config.js";
import { executeProof } from "../../src/proof/orchestrator.js";
import { serializeProofReport } from "../../src/proof/report.js";
import type {
  InstallationTokenRequest,
  InstallationTokenTransport,
} from "../../src/proof/token-broker.js";

const now = new Date("2026-07-23T12:00:00.000Z");
const commentObservation: Observation = {
  schemaVersion: 1,
  scenario: "disposable-comment",
  method: "POST",
  routeTemplate:
    "/repos/{owner}/{repo}/issues/{issue_number}/comments",
  status: 201,
  requirements: [
    [{ permission: "issues", level: "write" }],
    [{ permission: "pull_requests", level: "write" }],
  ],
  evidenceSource: "runtime_header",
  finding: null,
};
const contract = buildContract([commentObservation], fixtureCatalog);

describe("proof orchestration", () => {
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

  it("runs the restricted child, reproduces the contract, and proves rejection", async () => {
    const requests: InstallationTokenRequest[] = [];
    const result = await executeProof({
      config,
      contract,
      scenario: "disposable-comment",
      cwd: "/tmp/proof-orchestrator",
      command: "test-command-canary",
      args: ["--literal", ";not-a-shell"],
      baseEnvironment: {
        PATH: "/safe/bin",
        GITHUB_TOKEN: "ghs_PARENT_TOKEN_CANARY",
      },
      dependencies: {
        tokenTransport: tokenFixture(requests),
        commentTransport: rejectingCommentTransport(),
        runChild: async (input) => {
          expect(input.command).toBe("test-command-canary");
          expect(input.args).toEqual(["--literal", ";not-a-shell"]);
          expect(input.token.reveal()).toBe(
            "ghs_RESTRICTED_TOKEN_CANARY",
          );
          return passingChild();
        },
        now,
        sourceCommit: null,
      },
    });

    expect(result.success).toBe(true);
    expect(requests.map((request) => request.permissions)).toEqual([
      { issues: "write" },
      {},
    ]);
    expect(result.report).toMatchObject({
      selectedPermissions: { issues: "write" },
      mandatoryPermissions: { metadata: "read" },
      effectivePermissions: {
        issues: "write",
        metadata: "read",
      },
      repositoryScopeVerified: true,
      contractMatched: true,
      proofStrength: "necessity_tested",
      positiveProof: { status: "pass" },
      negativeControls: [
        {
          id: "issue-comments-read",
          status: "not_applicable",
        },
        {
          id: "issue-comment-create",
          status: "expected_rejection",
        },
      ],
      cleanup: { status: "pass" },
    });
    const retained = JSON.stringify(result);
    for (const canary of [
      "PARENT_TOKEN_CANARY",
      "RESTRICTED_TOKEN_CANARY",
      "NEGATIVE_TOKEN_CANARY",
      "fixture-owner",
      "private-granttrace-fixture",
      "test-command-canary",
    ]) {
      expect(retained).not.toContain(canary);
    }
  });

  it("uses an explicitly selected frontier branch for live proof", async () => {
    const selectedContract = {
      ...contract,
      selectedPermissions: { pull_requests: "write" as const },
    };
    const requests: InstallationTokenRequest[] = [];
    const result = await executeProof({
      config,
      contract: selectedContract,
      scenario: "disposable-comment",
      cwd: "/tmp/proof-orchestrator",
      command: "test-command-canary",
      args: [],
      baseEnvironment: {},
      dependencies: {
        tokenTransport: {
          async createInstallationToken(request) {
            requests.push(request);
            return {
              token: "ghs_RESTRICTED_TOKEN_CANARY",
              expires_at: "2026-07-23T13:00:00.000Z",
              permissions: {
                metadata: "read",
                pull_requests: "write",
              },
              repositories: [
                {
                  full_name: "fixture-owner/private-granttrace-fixture",
                },
              ],
            };
          },
        },
        runChild: async () => passingChild(),
        now,
      },
    });

    expect(result.success).toBe(true);
    expect(requests.map((request) => request.permissions)).toEqual([
      { pull_requests: "write" },
    ]);
    expect(result.report.selectedPermissions).toEqual({
      pull_requests: "write",
    });
  });

  it("writes a safe configuration failure state before token minting", async () => {
    const result = await executeProof({
      config: null,
      contract,
      scenario: "disposable-comment",
      cwd: "/tmp/proof-orchestrator",
      command: "unused",
      args: [],
      baseEnvironment: {},
    });

    expect(result.success).toBe(false);
    expect(result.report.positiveProof).toEqual({
      status: "failed",
      failure: "configuration_failure",
    });
    expect(result.report.effectivePermissions).toBeNull();
    expect(result.report.proofStrength).toBe("not_established");
  });

  it("reports an unknown scenario as a contract mismatch before minting", async () => {
    let tokenCalled = false;
    const result = await executeProof({
      config,
      contract,
      scenario: "not-recorded",
      cwd: "/tmp/proof-orchestrator",
      command: "unused",
      args: [],
      baseEnvironment: {},
      dependencies: {
        tokenTransport: {
          async createInstallationToken() {
            tokenCalled = true;
            throw new Error("must not mint");
          },
        },
      },
    });

    expect(result.success).toBe(false);
    expect(result.report.positiveProof).toEqual({
      status: "failed",
      failure: "contract_mismatch",
    });
    expect(tokenCalled).toBe(false);
  });

  it.each([
    ["spawn_failure", "test_failure"],
    ["test_failure", "test_failure"],
    ["interrupted", "test_failure"],
    ["instrumentation_failure", "instrumentation_failure"],
    ["timeout", "test_flake_or_indeterminate"],
    ["analysis_failure", "test_flake_or_indeterminate"],
  ] as const)(
    "maps %s without mistaking it for authorization evidence",
    async (outcome, failure) => {
      const result = await executeProof({
        config,
        contract,
        scenario: "disposable-comment",
        cwd: "/tmp/proof-orchestrator",
        command: "unused",
        args: [],
        baseEnvironment: {},
        dependencies: {
          tokenTransport: tokenFixture([]),
          runChild: async () => ({
            outcome,
            exitCode: outcome === "test_failure" ? 9 : null,
            signal:
              outcome === "timeout"
                ? "SIGTERM"
                : outcome === "interrupted"
                  ? "SIGINT"
                  : null,
            observations: [],
            sessionCleanup: "pass",
          }),
          now,
        },
      });

      expect(result.success).toBe(false);
      expect(result.report.positiveProof).toEqual({
        status: "failed",
        failure,
      });
      expect(result.report.proofStrength).toBe("not_established");
      expect(
        result.report.negativeControls.every(
          (control) => control.status === "not_run",
        ),
      ).toBe(true);
    },
  );

  it("rejects a catalog-divergent lock before token minting or child launch", async () => {
    const divergent = structuredClone(contract);
    divergent.routes[0]!.alternatives = [
      [{ permission: "contents", level: "read" }],
    ];
    divergent.selectedPermissions = { contents: "read" };
    divergent.permissionFrontier = [{ contents: "read" }];
    let tokenCalled = false;
    let childCalled = false;

    const result = await executeProof({
      config,
      contract: divergent,
      scenario: "disposable-comment",
      cwd: "/tmp/proof-orchestrator",
      command: "unused",
      args: [],
      baseEnvironment: {},
      dependencies: {
        tokenTransport: {
          async createInstallationToken() {
            tokenCalled = true;
            throw new Error("must not mint");
          },
        },
        runChild: async () => {
          childCalled = true;
          return passingChild();
        },
      },
    });

    expect(result.success).toBe(false);
    expect(result.report.positiveProof).toEqual({
      status: "failed",
      failure: "contract_mismatch",
    });
    expect(tokenCalled).toBe(false);
    expect(childCalled).toBe(false);
  });

  it("blocks a passing child whose observations do not reproduce the contract", async () => {
    const different: Observation = {
      schemaVersion: 1,
      scenario: "disposable-comment",
      method: "GET",
      routeTemplate: "/repos/{owner}/{repo}/contents/{path}",
      status: 200,
      requirements: [[{ permission: "contents", level: "read" }]],
      evidenceSource: "runtime_header",
      finding: null,
    };
    const result = await executeProof({
      config,
      contract,
      scenario: "disposable-comment",
      cwd: "/tmp/proof-orchestrator",
      command: "unused",
      args: [],
      baseEnvironment: {},
      dependencies: {
        tokenTransport: tokenFixture([]),
        runChild: async () => ({
          ...passingChild(),
          observations: [different],
        }),
        now,
      },
    });

    expect(result.success).toBe(false);
    expect(result.report.contractMatched).toBe(false);
    expect(result.report.positiveProof).toEqual({
      status: "failed",
      failure: "contract_mismatch",
    });
  });

  it("reports child session cleanup independently from a passing operation", async () => {
    const result = await executeProof({
      config,
      contract,
      scenario: "disposable-comment",
      cwd: "/tmp/proof-orchestrator",
      command: "unused",
      args: [],
      baseEnvironment: {},
      dependencies: {
        tokenTransport: tokenFixture([]),
        runChild: async () => ({
          ...passingChild(),
          sessionCleanup: "cleanup_failure",
        }),
        now,
      },
    });

    expect(result.success).toBe(false);
    expect(result.report.positiveProof).toEqual({ status: "pass" });
    expect(result.report.cleanup).toEqual({
      status: "failed",
      failure: "cleanup_failure",
    });
    expect(result.report.proofStrength).toBe("not_established");
    expect(() => serializeProofReport(result.report)).not.toThrow();
  });

  it("keeps rate limiting distinct in the negative control", async () => {
    const commentTransport: LiveCommentTransport = {
      async createComment() {
        throw {
          status: 403,
          response: {
            headers: { "x-ratelimit-remaining": "0" },
          },
        };
      },
      async deleteComment() {},
    };
    const result = await executeProof({
      config,
      contract,
      scenario: "disposable-comment",
      cwd: "/tmp/proof-orchestrator",
      command: "unused",
      args: [],
      baseEnvironment: {},
      dependencies: {
        tokenTransport: tokenFixture([]),
        commentTransport,
        runChild: async () => passingChild(),
        now,
      },
    });

    expect(result.success).toBe(false);
    expect(result.report.positiveProof).toEqual({ status: "pass" });
    expect(result.report.negativeControls[1]).toMatchObject({
      status: "indeterminate",
      failure: "rate_limited",
    });
    expect(result.report.proofStrength).toBe("not_established");
  });
});

function tokenFixture(
  requests: InstallationTokenRequest[],
): InstallationTokenTransport {
  return {
    async createInstallationToken(request) {
      requests.push(request);
      const negative = request.permissions?.["issues"] !== "write";
      return {
        token: negative
          ? "ghs_NEGATIVE_TOKEN_CANARY"
          : "ghs_RESTRICTED_TOKEN_CANARY",
        expires_at: "2026-07-23T13:00:00.000Z",
        permissions: negative
          ? { metadata: "read" }
          : { issues: "write", metadata: "read" },
        repositories: [
          {
            full_name:
              "fixture-owner/private-granttrace-fixture",
          },
        ],
      };
    },
  };
}

function rejectingCommentTransport(): LiveCommentTransport {
  return {
    async createComment({ token }) {
      expect(token.reveal()).toBe("ghs_NEGATIVE_TOKEN_CANARY");
      throw { status: 403 };
    },
    async deleteComment() {
      throw new Error("Cleanup should not run after a rejection.");
    },
  };
}

function passingChild() {
  return {
    outcome: "pass" as const,
    exitCode: 0,
    signal: null,
    observations: [commentObservation],
    sessionCleanup: "pass" as const,
  };
}

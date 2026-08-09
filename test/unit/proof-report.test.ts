import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deriveProofStrength,
  ProofReportError,
  serializeProofReport,
  writeProofReport,
} from "../../src/proof/report.js";

describe("allowlisted ephemeral proof report", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "granttrace-report-"));
    await chmod(directory, 0o700);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("serializes only safe semantic and run-status fields", () => {
    const serialized = serializeProofReport(validReport());

    expect(serialized.endsWith("\n")).toBe(true);
    expect(serialized).toContain('"scenario": "triage-integration"');
    expect(serialized).toContain('"sourceCommit": "abcdef1234567"');
    expect(serialized.indexOf('"contents"')).toBeLessThan(
      serialized.indexOf('"issues"'),
    );
    expect(serialized).toContain('"mandatoryPermissions"');
    expect(serialized).toContain('"contractMatched": true');
    expect(serialized).toContain(
      '"proofStrength": "restricted_scope_reproduced"',
    );
    expect(serialized).toContain('"schemaVersion": 3');
    for (const forbidden of [
      "token",
      "owner",
      "repository",
      "issue",
      "url",
      "command",
    ]) {
      expect(serialized.toLowerCase()).not.toContain(`"${forbidden}"`);
    }
  });

  it("rejects extra rich fields instead of attempting redaction", () => {
    const report = {
      ...validReport(),
      token: "ghs_REPORT_TOKEN_CANARY",
      rawUrl:
        "https://user:password@example.test/private?secret=QUERY_CANARY",
    };

    expect(() => serializeProofReport(report)).toThrow(
      ProofReportError,
    );
  });

  it("writes the report and its directory with restrictive permissions", async () => {
    const path = join(directory, "nested", "report.json");
    await writeProofReport(path, validReport());

    expect((await stat(join(directory, "nested"))).mode & 0o777).toBe(
      0o700,
    );
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, "utf8")).toBe(
      serializeProofReport(validReport()),
    );
  });

  it("does not write an invalid report artifact", async () => {
    const path = join(directory, "report.json");
    await expect(
      writeProofReport(path, {
        ...validReport(),
        scenario: "owner/repository?token=QUERY_CANARY",
      }),
    ).rejects.toBeInstanceOf(ProofReportError);
    await expect(readFile(path, "utf8")).rejects.toBeDefined();
  });

  it("refuses a passing claim without token and observation evidence", () => {
    expect(() =>
      serializeProofReport({
        ...validReport(),
        effectivePermissions: null,
        repositoryScopeVerified: false,
        contractMatched: false,
        child: {
          exitCode: 0,
          signal: null,
          observedOperations: 0,
        },
      }),
    ).toThrow(ProofReportError);
  });

  it("refuses effective permissions beyond selected plus mandatory access", () => {
    expect(() =>
      serializeProofReport({
        ...validReport(),
        effectivePermissions: {
          contents: "read",
          issues: "write",
          metadata: "read",
          actions: "read",
        },
      }),
    ).toThrow(ProofReportError);
  });

  it("rejects manual keeps that duplicate selected or mandatory access", () => {
    expect(() =>
      serializeProofReport({
        ...validReport(),
        manualKeeps: {
          issues: {
            level: "read",
            reason: "Retained for a separately reviewed integration.",
          },
        },
      }),
    ).toThrow(ProofReportError);

    expect(() =>
      serializeProofReport({
        ...validReport(),
        manualKeeps: {
          metadata: {
            level: "read",
            reason: "Retained for a separately reviewed integration.",
          },
        },
        requestedPermissions: {
          contents: "read",
          issues: "write",
          metadata: "read",
        },
      }),
    ).toThrow(ProofReportError);
  });

  it("requires the exact mandatory baseline", () => {
    for (const mandatoryPermissions of [
      {},
      { metadata: "read", actions: "read" },
    ]) {
      expect(() =>
        serializeProofReport({
          ...validReport(),
          mandatoryPermissions,
        }),
      ).toThrow(ProofReportError);
    }
  });

  it("does not accept terminal negative controls before positive proof", () => {
    for (const positiveProof of [
      { status: "not_run" },
      {
        status: "failed",
        failure: "test_failure",
      },
    ]) {
      expect(() =>
        serializeProofReport({
          ...validReport(),
          positiveProof,
          cleanup: { status: "not_run" },
        }),
      ).toThrow(ProofReportError);
    }
  });

  it("requires every built-in negative control exactly once", () => {
    const report = validReport() as {
      negativeControls: unknown[];
    };
    expect(() =>
      serializeProofReport({
        ...report,
        negativeControls: report.negativeControls.slice(0, 1),
      }),
    ).toThrow(ProofReportError);
  });

  it.each([
    {
      name: "does not establish a claim for an incomplete run",
      selectedPermissions: { issues: "write" },
      positiveProof: { status: "pass" },
      negativeControls: [
        { removedPermission: "issues", status: "not_run" },
      ],
      cleanup: { status: "pass" },
      expected: "not_established",
    },
    {
      name: "reports restricted-scope reproduction without an applicable control",
      selectedPermissions: { contents: "read" },
      positiveProof: { status: "pass" },
      negativeControls: [
        { removedPermission: "issues", status: "not_applicable" },
      ],
      cleanup: { status: "pass" },
      expected: "restricted_scope_reproduced",
    },
    {
      name: "reports partially tested permission-name necessity when only some names are removed",
      selectedPermissions: { contents: "read", issues: "write" },
      positiveProof: { status: "pass" },
      negativeControls: [
        { removedPermission: "issues", status: "expected_rejection" },
      ],
      cleanup: { status: "pass" },
      expected: "necessity_partially_tested",
    },
    {
      name: "reports tested permission-name necessity when every name is removed",
      selectedPermissions: { issues: "write" },
      positiveProof: { status: "pass" },
      negativeControls: [
        { removedPermission: "issues", status: "expected_rejection" },
      ],
      cleanup: { status: "pass" },
      expected: "necessity_tested",
    },
  ])("$name", ({ expected, ...report }) => {
    expect(deriveProofStrength(report)).toBe(expected);
  });

  it("rejects an overclaimed or underclaimed proof strength", () => {
    for (const proofStrength of [
      "necessity_partially_tested",
      "necessity_tested",
      "not_established",
    ]) {
      expect(() =>
        serializeProofReport({ ...validReport(), proofStrength }),
      ).toThrow(ProofReportError);
    }
  });

  it("requires proofStrength in schema-v3 reports and rejects schema v2", () => {
    const { proofStrength: _proofStrength, ...missingStrength } = validReport();
    expect(() => serializeProofReport(missingStrength)).toThrow(
      ProofReportError,
    );
    expect(() =>
      serializeProofReport({ ...validReport(), schemaVersion: 2 }),
    ).toThrow(ProofReportError);
  });
});

function validReport(): Record<string, unknown> {
  return {
    schemaVersion: 3,
    toolVersion: "0.1.0-beta.1",
    apiVersion: "2026-03-10",
    sourceCommit: "abcdef1234567",
    scenario: "triage-integration",
    catalog: {
      source: "granttrace-fixture",
      version: "2026-03-10.fixture.1",
      checksum: `sha256:${"a".repeat(64)}`,
    },
    contractHash: `sha256:${"b".repeat(64)}`,
    selectedPermissions: {
      issues: "write",
      contents: "read",
    },
    manualKeeps: {},
    requestedPermissions: {
      issues: "write",
      contents: "read",
    },
    mandatoryPermissions: {
      metadata: "read",
    },
    effectivePermissions: {
      issues: "write",
      contents: "read",
      metadata: "read",
    },
    repositoryScopeVerified: true,
    contractMatched: true,
    proofStrength: "restricted_scope_reproduced",
    child: {
      exitCode: 0,
      signal: null,
      observedOperations: 4,
    },
    positiveProof: { status: "pass" },
    negativeControls: [
      {
        id: "issue-comments-read",
        mode: "read_only",
        removedPermission: "issues",
        status: "not_applicable",
        cleanup: "not_required",
      },
      {
        id: "issue-comment-create",
        mode: "mutating",
        removedPermission: "issues",
        status: "not_applicable",
        cleanup: "not_required",
      },
    ],
    cleanup: { status: "pass" },
  };
}

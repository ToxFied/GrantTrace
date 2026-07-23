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
});

function validReport(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    toolVersion: "0.0.0-dev",
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
    child: {
      exitCode: 0,
      signal: null,
      observedOperations: 4,
    },
    positiveProof: { status: "pass" },
    negativeControl: { status: "not_applicable" },
    cleanup: { status: "pass" },
  };
}

import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/main.js";
import type { CliContext } from "../../src/cli/context.js";
import { buildContract } from "../../src/contract/build.js";
import type { Observation } from "../../src/contract/observation.js";
import { writeContractAtomic } from "../../src/contract/serialize.js";
import { githubPermissionCatalog } from "../../src/evidence/catalog.js";
import { serializeProofReport } from "../../src/proof/report.js";
import { TOOL_VERSION } from "../../src/version.js";

const issueRoute = "/repos/{owner}/{repo}/issues";

describe("public-beta CLI surface", () => {
  it("offers help and version output without ANSI styling under NO_COLOR", async () => {
    const help = captureContext("/", {
      NO_COLOR: "1",
      FORCE_COLOR: "3",
    });
    expect(await runCli(["--help"], help.context)).toBe(0);
    expect(help.stdout()).toContain(`GrantTrace ${TOOL_VERSION}`);
    expect(help.stdout()).toContain("granttrace init");
    expect(help.stdout()).toContain("granttrace doctor");
    expect(help.stdout()).toContain("granttrace keep add|remove|list");
    expect(help.stdout()).toContain("granttrace scenario");
    expect(help.stdout()).toContain("Untested behavior is outside the claim");
    expect(help.stdout()).not.toMatch(/\u001b\[[0-9;]*m/u);

    const version = captureContext("/", { NO_COLOR: "1" });
    expect(await runCli(["--version"], version.context)).toBe(0);
    expect(version.stdout()).toBe(`${TOOL_VERSION}\n`);
    expect(version.stderr()).toBe("");
  });

  it("returns a stable usage exit for an unknown command", async () => {
    const output = captureContext("/", { NO_COLOR: "1" });

    expect(await runCli(["unknown-command"], output.context)).toBe(2);
    expect(output.stderr()).toContain("Unknown command.");
    expect(output.stderr()).not.toContain("unknown-command");
    expect(output.stderr()).toContain(
      "Run granttrace <command> --help for command-specific usage",
    );
    expect(output.stderr()).not.toMatch(/\u001b\[[0-9;]*m/u);
  });
});

describe("manual keeps", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "granttrace-manual-keep-"));
    await chmod(directory, 0o700);
    expect(
      await runCli(["init"], captureContext(directory, {}).context),
    ).toBe(0);
    await writeContractAtomic(
      join(directory, "granttrace.lock.json"),
      buildContract([issueObservation()], githubPermissionCatalog),
    );
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("requires a reason and persists retained access separately", async () => {
    const invalid = captureContext(directory, {});
    expect(
      await runCli(
        ["keep", "add", "actions:read", "--reason", ""],
        invalid.context,
      ),
    ).toBe(2);
    expect(invalid.stderr()).toContain("requires a committed");

    const output = captureContext(directory, {});
    expect(
      await runCli(
        [
          "keep",
          "add",
          "actions:read",
          "--reason",
          "Required by an integration outside recorded scenarios.",
        ],
        output.context,
      ),
    ).toBe(0);
    expect(output.stdout()).toContain("not call it observed or proven necessary");

    const stored = JSON.parse(
      await readFile(join(directory, "granttrace.lock.json"), "utf8"),
    ) as {
      selectedPermissions: Record<string, string>;
      manualKeeps: Record<string, { level: string; reason: string }>;
    };
    expect(stored.selectedPermissions).toEqual({ issues: "read" });
    expect(stored.manualKeeps).toEqual({
      actions: {
        level: "read",
        reason: "Required by an integration outside recorded scenarios.",
      },
    });
  });

  it("does not allow a keep to duplicate observed or mandatory access", async () => {
    const observed = captureContext(directory, {});
    expect(
      await runCli(
        [
          "keep",
          "add",
          "issues:read",
          "--reason",
          "Duplicate access should be rejected.",
        ],
        observed.context,
      ),
    ).toBe(2);
    expect(observed.stderr()).toContain("already select that access level");

    const mandatory = captureContext(directory, {});
    expect(
      await runCli(
        [
          "keep",
          "add",
          "metadata:read",
          "--reason",
          "Mandatory access should be rejected.",
        ],
        mandatory.context,
      ),
    ).toBe(2);
    expect(mandatory.stderr()).toContain("mandatory baseline");
  });

  it("requires requested and effective proof access to include manual keeps exactly", () => {
    const valid = proofReport();
    const serialized = serializeProofReport(valid);
    expect(serialized).toContain('"manualKeeps"');
    expect(serialized).toContain(
      "Required by an integration outside recorded scenarios.",
    );

    expect(() =>
      serializeProofReport({
        ...valid,
        requestedPermissions: { issues: "read" },
      }),
    ).toThrow();
    expect(() =>
      serializeProofReport({
        ...valid,
        effectivePermissions: {
          issues: "read",
          metadata: "read",
        },
      }),
    ).toThrow();
  });
});

function issueObservation(): Observation {
  return {
    schemaVersion: 1,
    scenario: "issues-read",
    method: "GET",
    routeTemplate: issueRoute,
    status: 200,
    requirements: [[{ permission: "issues", level: "read" }]],
    evidenceSource: "runtime_header",
    finding: null,
  };
}

function proofReport(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    toolVersion: TOOL_VERSION,
    apiVersion: "2026-03-10",
    sourceCommit: null,
    scenario: "issues-read",
    catalog: {
      source: "github-docs",
      version: "2026-03-10.20260723.1",
      checksum: `sha256:${"a".repeat(64)}`,
    },
    contractHash: `sha256:${"b".repeat(64)}`,
    selectedPermissions: { issues: "read" },
    manualKeeps: {
      actions: {
        level: "read",
        reason: "Required by an integration outside recorded scenarios.",
      },
    },
    requestedPermissions: { actions: "read", issues: "read" },
    mandatoryPermissions: { metadata: "read" },
    effectivePermissions: {
      actions: "read",
      issues: "read",
      metadata: "read",
    },
    repositoryScopeVerified: true,
    contractMatched: true,
    proofStrength: "restricted_scope_reproduced",
    child: {
      exitCode: 0,
      signal: null,
      observedOperations: 1,
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

function captureContext(
  cwd: string,
  environment: NodeJS.ProcessEnv,
): {
  context: CliContext;
  stdout(): string;
  stderr(): string;
} {
  let stdout = "";
  let stderr = "";
  return {
    context: {
      cwd,
      environment,
      stdout: {
        write(value) {
          stdout += String(value);
          return true;
        },
      },
      stderr: {
        write(value) {
          stderr += String(value);
          return true;
        },
      },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

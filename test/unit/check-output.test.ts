import {
  access,
  chmod,
  link,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCheck } from "../../src/cli/check.js";
import type { CliContext } from "../../src/cli/context.js";
import { runInit } from "../../src/cli/init.js";
import { writeObservations } from "../../src/contract/observation-file.js";
import type { Observation } from "../../src/contract/observation.js";
import {
  readContract,
  writeContractAtomic,
} from "../../src/contract/serialize.js";

describe("contract-check structured output", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "granttrace-check-output-"));
    await chmod(directory, 0o700);
    expect(await runInit([], captureContext(directory).context)).toBe(0);
    await writeObservations(
      join(directory, ".granttrace", "observations", "private-identity.ndjson"),
      [issueObservation()],
    );
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("emits a deterministic versioned JSON report without scenario identities", async () => {
    const output = captureContext(directory);

    expect(await runCheck(["--format", "json"], output.context)).toBe(6);
    expect(output.stderr()).toBe("");
    expect(JSON.parse(output.stdout())).toEqual({
      schemaVersion: 1,
      status: "review_required",
      exitCode: 6,
      reason: null,
      summary: {
        scenarios: 1,
        routes: 1,
        observedPermissions: 1,
        manualKeeps: 0,
        findings: 0,
      },
      observedPermissions: [{ permission: "issues", level: "read" }],
      manualKeeps: [],
      mandatoryPermissions: [{ permission: "metadata", level: "read" }],
      changes: {
        permissionAdditions: [
          { permission: "issues", from: null, to: "read" },
        ],
        permissionEscalations: [],
        permissionRemovals: [],
        permissionReductions: [],
        scenarioAdditions: 1,
        scenarioRemovals: 0,
        routeAdditions: [
          {
            method: "GET",
            template: "/repos/{owner}/{repo}/issues",
          },
        ],
        routeRemovals: [],
        attributionAdditions: 0,
        attributionRemovals: 0,
        scenarioEvidenceChanges: 0,
        routeRequirementChanges: [],
        manualKeepAdditions: [],
        manualKeepRemovals: [],
        manualKeepChanges: [],
        toolVersionChanged: false,
        apiVersionChanged: false,
        catalogChanged: false,
        contractEvidenceChanged: false,
      },
      findings: [],
      migrations: [],
    });
    expect(output.stdout()).not.toContain("private-identity");
  });

  it("emits PR-ready Markdown to stdout while preserving the review exit", async () => {
    const output = captureContext(directory);

    expect(await runCheck(["--format", "markdown"], output.context)).toBe(6);
    expect(output.stderr()).toBe("");
    expect(output.stdout()).toContain("## GrantTrace contract check");
    expect(output.stdout()).toContain("**Status:** Review required");
    expect(output.stdout()).toContain("| Added | issues | — | read |");
    expect(output.stdout()).toContain(
      "| Added | GET | /repos/{owner}/{repo}/issues |",
    );
    expect(output.stdout()).toContain("### Mandatory GitHub baseline");
    expect(output.stdout()).not.toContain("private-identity");
  });

  it("preserves a valid nondefault frontier selection without exposing manual reasons", async () => {
    await writeObservations(
      join(directory, ".granttrace", "observations", "private-identity.ndjson"),
      [commentObservation()],
    );
    expect(await runCheck(["--accept"], captureContext(directory).context)).toBe(
      0,
    );
    const contract = await readContract(
      join(directory, "granttrace.lock.json"),
    );
    const nondefault = contract.permissionFrontier.find(
      (candidate) => candidate["pull_requests"] === "write",
    );
    expect(nondefault).toEqual({ pull_requests: "write" });
    await writeContractAtomic(join(directory, "granttrace.lock.json"), {
      ...contract,
      selectedPermissions: nondefault!,
      manualKeeps: {
        actions: {
          level: "read",
          reason: "private-manual-keep-reason",
        },
      },
    });
    const acceptedBytes = await readFile(
      join(directory, "granttrace.lock.json"),
      "utf8",
    );
    const output = captureContext(directory);

    expect(await runCheck(["--format", "json"], output.context)).toBe(0);
    expect(JSON.parse(output.stdout())).toMatchObject({
      status: "passed",
      observedPermissions: [
        { permission: "pull_requests", level: "write" },
      ],
      manualKeeps: [{ permission: "actions", level: "read" }],
    });
    expect(output.stdout()).not.toContain("private-manual-keep-reason");
    expect(
      await readFile(join(directory, "granttrace.lock.json"), "utf8"),
    ).toBe(acceptedBytes);
  });

  it("redacts non-catalog route templates from a valid prior contract", async () => {
    expect(await runCheck(["--accept"], captureContext(directory).context)).toBe(
      0,
    );
    const lockPath = join(directory, "granttrace.lock.json");
    const contract = await readContract(lockPath);
    await writeContractAtomic(lockPath, {
      ...contract,
      routes: contract.routes.map((route) => ({
        ...route,
        template: "/repos/private-owner/{repo}/issues",
      })),
    });
    const json = captureContext(directory);

    expect(await runCheck(["--format", "json"], json.context)).toBe(6);
    expect(JSON.parse(json.stdout())).toMatchObject({
      changes: {
        routeRemovals: [{ method: "GET", template: null }],
      },
    });
    expect(json.stdout()).not.toContain("private-owner");

    const markdown = captureContext(directory);
    expect(await runCheck(["--format", "markdown"], markdown.context)).toBe(6);
    expect(markdown.stdout()).toContain("| Removed | GET | — |");
    expect(markdown.stdout()).not.toContain("private-owner");
  });

  it("appends Markdown only by explicit opt-in when RUNNER_TEMP is unrelated", async () => {
    const summaryPath = join(directory, "step-summary.md");
    await writeFile(summaryPath, "existing summary\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    const withoutOptIn = captureContext(directory, {
      CI: "true",
      GITHUB_ACTIONS: "true",
      GITHUB_STEP_SUMMARY: summaryPath,
      RUNNER_TEMP: directory,
    });
    expect(await runCheck([], withoutOptIn.context)).toBe(6);
    expect(await readFile(summaryPath, "utf8")).toBe("existing summary\n");

    const withOptIn = captureContext(directory, {
      CI: "true",
      GITHUB_ACTIONS: "true",
      GITHUB_STEP_SUMMARY: summaryPath,
      RUNNER_TEMP: join(directory, "unrelated-runner-temp"),
    });
    expect(
      await runCheck(["--github-step-summary"], withOptIn.context),
    ).toBe(6);
    expect(withOptIn.stderr()).toContain("GrantTrace contract review required");
    const summary = await readFile(summaryPath, "utf8");
    expect(summary).toContain("existing summary");
    expect(summary).toContain("## GrantTrace contract check");
    expect(summary).not.toContain("private-identity");
  });

  it.skipIf(process.platform === "win32")(
    "refuses to follow a GitHub summary symlink",
    async () => {
      const target = join(directory, "summary-target.md");
      const linked = join(directory, "summary-link.md");
      await writeFile(target, "do not modify\n", "utf8");
      await symlink(target, linked);
      const output = captureContext(directory, {
        GITHUB_ACTIONS: "true",
        GITHUB_STEP_SUMMARY: linked,
        RUNNER_TEMP: directory,
      });

      expect(
        await runCheck(["--github-step-summary"], output.context),
      ).toBe(5);
      expect(output.stderr()).toContain("unavailable or unsafe");
      expect(await readFile(target, "utf8")).toBe("do not modify\n");
    },
  );

  it.skipIf(process.platform === "win32")(
    "refuses to append to a hard-linked GitHub summary",
    async () => {
      const target = join(directory, "summary-target.md");
      const linked = join(directory, "summary-hard-link.md");
      await writeFile(target, "do not modify\n", "utf8");
      await link(target, linked);
      const output = captureContext(directory, {
        GITHUB_ACTIONS: "true",
        GITHUB_STEP_SUMMARY: linked,
        RUNNER_TEMP: join(directory, "unrelated-runner-temp"),
      });

      expect(
        await runCheck(["--github-step-summary"], output.context),
      ).toBe(5);
      expect(output.stderr()).toContain("unavailable or unsafe");
      expect(await readFile(target, "utf8")).toBe("do not modify\n");
    },
  );

  it.each([
    { CI: "true" },
    { CI: "false", GITHUB_ACTIONS: "true" },
  ])("refuses acceptance in CI before writing the contract", async (environment) => {
    const output = captureContext(directory, environment);

    expect(
      await runCheck(["--accept", "--format", "json"], output.context),
    ).toBe(2);
    expect(JSON.parse(output.stdout())).toMatchObject({
      schemaVersion: 1,
      status: "acceptance_refused",
      exitCode: 2,
      reason: "ci_accept_forbidden",
    });
    await expect(
      access(join(directory, "granttrace.lock.json")),
    ).rejects.toBeDefined();
  });

  it("uses an enumerated structured error instead of unsafe artifact details", async () => {
    await writeFile(
      join(directory, "granttrace.lock.json"),
      '{"credential":"ghs_STRUCTURED_OUTPUT_SECRET_CANARY"}\n',
      "utf8",
    );
    const output = captureContext(directory);

    expect(await runCheck(["--format", "json"], output.context)).toBe(5);
    expect(JSON.parse(output.stdout())).toMatchObject({
      status: "analysis_failed",
      exitCode: 5,
      reason: "invalid_artifact",
    });
    expect(output.stdout()).not.toContain("SECRET_CANARY");
    expect(output.stderr()).toBe("");
  });
});

function issueObservation(): Observation {
  return {
    schemaVersion: 1,
    scenario: "private-identity",
    method: "GET",
    routeTemplate: "/repos/{owner}/{repo}/issues",
    status: 200,
    requirements: [[{ permission: "issues", level: "read" }]],
    evidenceSource: "runtime_header",
    finding: null,
  };
}

function commentObservation(): Observation {
  return {
    schemaVersion: 1,
    scenario: "private-identity",
    method: "POST",
    routeTemplate: "/repos/{owner}/{repo}/issues/{issue_number}/comments",
    status: 201,
    requirements: [
      [{ permission: "issues", level: "write" }],
      [{ permission: "pull_requests", level: "write" }],
    ],
    evidenceSource: "runtime_header",
    finding: null,
  };
}

function captureContext(
  cwd: string,
  environment: NodeJS.ProcessEnv = {},
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

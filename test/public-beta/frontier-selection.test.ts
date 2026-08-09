import {
  chmod,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/main.js";
import type { CliContext } from "../../src/cli/context.js";
import { buildContract } from "../../src/contract/build.js";
import type { Observation } from "../../src/contract/observation.js";
import { writeObservations } from "../../src/contract/observation-file.js";
import {
  readContract,
  writeContractAtomic,
} from "../../src/contract/serialize.js";
import { githubPermissionCatalog } from "../../src/evidence/catalog.js";

const commentRoute =
  "/repos/{owner}/{repo}/issues/{issue_number}/comments";
const issueRoute = "/repos/{owner}/{repo}/issues";

describe("selectable permission frontier", () => {
  let directory: string;
  let lockPath: string;
  let observationPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "granttrace-frontier-"));
    await chmod(directory, 0o700);
    const initialized = captureContext(directory);
    expect(await runCli(["init"], initialized.context)).toBe(0);
    lockPath = join(directory, "granttrace.lock.json");
    observationPath = join(
      directory,
      ".granttrace",
      "observations",
      "comments.ndjson",
    );
    await writeObservations(observationPath, [commentObservation()]);
    await writeContractAtomic(
      lockPath,
      buildContract([commentObservation()], githubPermissionCatalog),
    );
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("persists an explicit complete candidate and preserves it on checks", async () => {
    const before = await readContract(lockPath);
    const listed = captureContext(directory);

    expect(await runCli(["frontier", "list"], listed.context)).toBe(0);
    expect(listed.stdout()).toContain("1 (selected)");
    expect(listed.stdout()).toContain("issues: write");
    expect(listed.stdout()).toContain("pull_requests: write");

    const selected = captureContext(directory);
    expect(
      await runCli(["frontier", "select", "2"], selected.context),
    ).toBe(0);
    expect(selected.stdout()).toContain("selection updated");
    const stored = await readContract(lockPath);
    expect(stored).toEqual({
      ...before,
      selectedPermissions: { pull_requests: "write" },
    });

    const selectedBytes = await readFile(lockPath, "utf8");
    const checked = captureContext(directory);
    expect(await runCli(["check"], checked.context)).toBe(0);
    expect(checked.stdout()).toContain("GrantTrace check passed");
    expect(await readFile(lockPath, "utf8")).toBe(selectedBytes);
  });

  it("requires review when later evidence invalidates the selected candidate", async () => {
    expect(
      await runCli(
        ["frontier", "select", "2"],
        captureContext(directory).context,
      ),
    ).toBe(0);
    const selectedBytes = await readFile(lockPath, "utf8");
    await writeObservations(observationPath, [issueObservation()]);

    const reviewed = captureContext(directory);
    expect(await runCli(["check"], reviewed.context)).toBe(6);
    expect(reviewed.stderr()).toContain("New permission");
    expect(reviewed.stderr()).toContain("issues: read");
    expect(reviewed.stderr()).toContain("No longer observed");
    expect(reviewed.stderr()).toContain("pull_requests: write");
    expect(await readFile(lockPath, "utf8")).toBe(selectedBytes);

    expect(
      await runCli(["check", "--accept"], captureContext(directory).context),
    ).toBe(0);
    expect((await readContract(lockPath)).selectedPermissions).toEqual({
      issues: "read",
    });
  });

  it("rejects unknown candidates without changing the contract", async () => {
    const before = await readFile(lockPath, "utf8");
    const output = captureContext(directory);

    expect(
      await runCli(["frontier", "select", "3"], output.context),
    ).toBe(2);
    expect(output.stderr()).toContain("choose a candidate from 1 to 2");
    expect(await readFile(lockPath, "utf8")).toBe(before);
  });

  it("does not silently replace a conflicting manual keep", async () => {
    const contract = await readContract(lockPath);
    await writeContractAtomic(lockPath, {
      ...contract,
      manualKeeps: {
        pull_requests: {
          level: "read",
          reason: "Required outside the recorded scenarios.",
        },
      },
    });
    const before = await readFile(lockPath, "utf8");
    const output = captureContext(directory);

    expect(
      await runCli(["frontier", "select", "2"], output.context),
    ).toBe(2);
    expect(output.stderr()).toContain("duplicates access");
    expect(output.stderr()).toContain("pull_requests");
    expect(await readFile(lockPath, "utf8")).toBe(before);
  });
});

function commentObservation(): Observation {
  return {
    schemaVersion: 1,
    scenario: "comments",
    method: "POST",
    routeTemplate: commentRoute,
    status: 201,
    requirements: [
      [{ permission: "issues", level: "write" }],
      [{ permission: "pull_requests", level: "write" }],
    ],
    evidenceSource: "runtime_header",
    finding: null,
  };
}

function issueObservation(): Observation {
  return {
    schemaVersion: 1,
    scenario: "comments",
    method: "GET",
    routeTemplate: issueRoute,
    status: 200,
    requirements: [[{ permission: "issues", level: "read" }]],
    evidenceSource: "runtime_header",
    finding: null,
  };
}

function captureContext(cwd: string): {
  context: CliContext;
  stdout(): string;
  stderr(): string;
} {
  let stdout = "";
  let stderr = "";
  return {
    context: {
      cwd,
      environment: {},
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

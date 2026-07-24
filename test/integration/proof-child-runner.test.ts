import { access, chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runProofChild } from "../../src/proof/child-runner.js";
import { SensitiveValue } from "../../src/security/sensitive-value.js";

const projectRoot = dirname(
  dirname(dirname(fileURLToPath(new URL(import.meta.url)))),
);
const childDirectory = join(
  projectRoot,
  "test",
  "fixtures",
  "children",
);
const tsxImport = import.meta.resolve("tsx");
const fixture = {
  owner: "fixture-owner",
  repository: "private-granttrace-fixture",
  issueNumber: "73",
};

describe("restricted proof child runner", () => {
  let workingDirectory: string;

  beforeEach(async () => {
    workingDirectory = await mkdtemp(
      join(tmpdir(), "granttrace-proof-child-"),
    );
    await chmod(workingDirectory, 0o700);
  });

  afterEach(async () => {
    await rm(workingDirectory, { recursive: true, force: true });
  });

  it("runs an instrumented scenario and returns safe observations", async () => {
    const result = await runFixture("instrumented.ts");

    expect(result.outcome).toBe("pass");
    expect(result.exitCode).toBe(0);
    expect(result.observations).toHaveLength(4);
    expect(result.sessionCleanup).toBe("pass");
    const retained = JSON.stringify(result);
    for (const canary of [
      "ghs_RESTRICTED_PROOF_CHILD_CANARY",
      "ghs_BROAD_PARENT_TOKEN_CANARY",
      "PRIVATE_KEY_PARENT_CANARY",
      "fixture-owner",
      "private-granttrace-fixture",
      "401001",
      "child-owner-canary",
      "child-repo-canary",
      "child-body-canary",
    ]) {
      expect(retained).not.toContain(canary);
    }
  });

  it("automatically captures an ordinary Octokit scenario", async () => {
    const result = await runFixture("automatic.ts");

    expect(result.outcome).toBe("pass");
    expect(result.exitCode).toBe(0);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({
      scenario: "triage-integration",
      method: "POST",
      routeTemplate:
        "/repos/{owner}/{repo}/issues/{issue_number}/comments",
    });
    expect(result.sessionCleanup).toBe("pass");
  });

  it("distinguishes child-test failure while retaining safe evidence", async () => {
    const result = await runFixture("failing-instrumented.ts");

    expect(result.outcome).toBe("test_failure");
    expect(result.exitCode).toBe(9);
    expect(result.observations).toHaveLength(4);
    expect(result.sessionCleanup).toBe("pass");
  });

  it("fails proof coverage when the plugin is absent or sees no traffic", async () => {
    const absent = await runFixture("no-plugin.ts");
    expect(absent.outcome).toBe("instrumentation_failure");

    const noTraffic = await runFixture(
      "plugin-without-requests.ts",
    );
    expect(noTraffic.outcome).toBe("instrumentation_failure");
  });

  it("reports an executable spawn failure without retaining the command", async () => {
    const commandCanary = join(
      workingDirectory,
      "command-token-ghs_SPAWN_CANARY",
    );
    const result = await runProofChild({
      cwd: workingDirectory,
      command: commandCanary,
      args: [],
      baseEnvironment: process.env,
      token: new SensitiveValue(
        "ghs_RESTRICTED_PROOF_CHILD_CANARY",
      ),
      fixture,
      scenario: "triage-integration",
    });

    expect(result.outcome).toBe("spawn_failure");
    expect(JSON.stringify(result)).not.toContain("ghs_SPAWN_CANARY");
  });

  it("terminates a hung child and reports an indeterminate timeout", async () => {
    const result = await runProofChild({
      cwd: workingDirectory,
      command: process.execPath,
      args: ["-e", "setInterval(() => undefined, 1_000)"],
      baseEnvironment: process.env,
      token: new SensitiveValue(
        "ghs_RESTRICTED_PROOF_CHILD_CANARY",
      ),
      fixture,
      scenario: "triage-integration",
      timeoutMs: 1_000,
    });

    expect(result.outcome).toBe("timeout");
    expect(result.signal).toBe("SIGTERM");
    expect(result.sessionCleanup).toBe("pass");
  });

  it.skipIf(process.platform === "win32")(
    "kills a stubborn proof descendant before cleaning the session",
    async () => {
      const descendantPidPath = join(
        workingDirectory,
        "proof-descendant.pid",
      );
      const result = await runProofChild({
        cwd: workingDirectory,
        command: process.execPath,
        args: [
          "--import",
          tsxImport,
          join(childDirectory, "signal-handling.ts"),
          descendantPidPath,
        ],
        baseEnvironment: process.env,
        token: new SensitiveValue(
          "ghs_RESTRICTED_PROOF_CHILD_CANARY",
        ),
        fixture,
        scenario: "triage-integration",
        timeoutMs: 1_000,
      });

      expect(result.outcome).toBe("timeout");
      expect(result.sessionCleanup).toBe("pass");
      await expectProcessGone(
        Number(await readFile(descendantPidPath, "utf8")),
      );
    },
  );

  it("passes arguments literally and never invokes a shell", async () => {
    const sentinel = join(workingDirectory, "shell-injection-canary");
    const result = await runProofChild({
      cwd: workingDirectory,
      command: process.execPath,
      args: [
        "--import",
        tsxImport,
        join(childDirectory, "instrumented.ts"),
        `;touch ${sentinel}`,
      ],
      baseEnvironment: process.env,
      token: new SensitiveValue(
        "ghs_RESTRICTED_PROOF_CHILD_CANARY",
      ),
      fixture,
      scenario: "triage-integration",
    });

    expect(result.outcome).toBe("pass");
    await expect(access(sentinel)).rejects.toBeDefined();
  });

  function runFixture(name: string) {
    return runProofChild({
      cwd: workingDirectory,
      command: process.execPath,
      args: [
        "--import",
        tsxImport,
        join(childDirectory, name),
      ],
      baseEnvironment: {
        ...process.env,
        GITHUB_TOKEN: "ghs_BROAD_PARENT_TOKEN_CANARY",
        GRANTTRACE_APP_PRIVATE_KEY:
          "-----BEGIN PRIVATE KEY-----PRIVATE_KEY_PARENT_CANARY",
      },
      token: new SensitiveValue(
        "ghs_RESTRICTED_PROOF_CHILD_CANARY",
      ),
      fixture,
      scenario: "triage-integration",
    });
  }
});

async function expectProcessGone(pid: number): Promise<void> {
  expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, 10);
    });
  }
  throw new Error("Restricted proof descendant remained alive.");
}

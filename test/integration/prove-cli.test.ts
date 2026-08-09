import { generateKeyPairSync } from "node:crypto";
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

import { runCli } from "../../src/cli/main.js";
import { buildContract } from "../../src/contract/build.js";
import type { Observation } from "../../src/contract/observation.js";
import { writeContractAtomic } from "../../src/contract/serialize.js";
import { fixtureCatalog } from "../../src/evidence/catalog.js";
import type { CliContext } from "../../src/cli/context.js";
import type { LiveCommentTransport } from "../../src/proof/comment-transport.js";
import type { InstallationTokenTransport } from "../../src/proof/token-broker.js";

const now = new Date("2026-07-23T12:00:00.000Z");
const observation: Observation = {
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
const contentsObservation: Observation = {
  schemaVersion: 1,
  scenario: "disposable-comment",
  method: "GET",
  routeTemplate: "/repos/{owner}/{repo}/contents/{path}",
  status: 200,
  requirements: [[{ permission: "contents", level: "read" }]],
  evidenceSource: "runtime_header",
  finding: null,
};

describe("prove CLI workflow", () => {
  let workingDirectory: string;
  let privateKey: string;

  beforeEach(async () => {
    workingDirectory = await mkdtemp(join(tmpdir(), "granttrace-prove-cli-"));
    await chmod(workingDirectory, 0o700);
    expect(
      await runCli(["init"], {
        cwd: workingDirectory,
        environment: {},
        stdout: { write: () => true },
        stderr: { write: () => true },
      }),
    ).toBe(0);
    privateKey = generateKeyPairSync("rsa", {
      modulusLength: 2_048,
      privateKeyEncoding: {
        type: "pkcs8",
        format: "pem",
      },
      publicKeyEncoding: {
        type: "spki",
        format: "pem",
      },
    }).privateKey;
    await writeContractAtomic(
      join(workingDirectory, "granttrace.lock.json"),
      buildContract([observation], fixtureCatalog),
    );
  });

  afterEach(async () => {
    await rm(workingDirectory, { recursive: true, force: true });
  });

  it("writes a strict report after the complete proof workflow", async () => {
    let childArguments: string[] = [];
    const result = await invoke(
      [
        "prove",
        "--scenario",
        "disposable-comment",
        "--",
        "literal-command-canary",
        ";touch",
        "sentinel-canary",
      ],
      fixtureEnvironment(),
      {
        runChild: async (input) => {
          childArguments = [input.command, ...input.args];
          expect(input.token.reveal()).toBe(
            "ghs_RESTRICTED_TOKEN_CANARY",
          );
          return {
            outcome: "pass",
            exitCode: 0,
            signal: null,
            observations: [observation],
            sessionCleanup: "pass",
          };
        },
        tokenTransport: tokenTransport(),
        commentTransport: rejectionTransport(),
        now,
        sourceCommit: null,
      },
    );

    expect(result.code).toBe(0);
    expect(childArguments).toEqual([
      "literal-command-canary",
      ";touch",
      "sentinel-canary",
    ]);
    expect(result.stdout).toContain("GrantTrace prove passed");
    expect(result.stdout).toContain(
      "Strength    Necessity tested (permission-name removal)",
    );
    expect(result.stdout).toContain("Rejected as expected");
    const reportPath = join(
      workingDirectory,
      ".granttrace",
      "reports",
      "disposable-comment.json",
    );
    expect((await stat(reportPath)).mode & 0o777).toBe(0o600);
    const report = await readFile(reportPath, "utf8");
    expect(report).toContain('"contractMatched": true');
    expect(report).toContain('"proofStrength": "necessity_tested"');
    expect(report).toContain('"metadata": "read"');
    const retained = `${result.stdout}\n${result.stderr}\n${report}`;
    for (const forbidden of [
      privateKey,
      "fixture-owner",
      "private-granttrace-fixture",
      "98765",
      "ghs_RESTRICTED_TOKEN_CANARY",
      "ghs_NEGATIVE_TOKEN_CANARY",
      "literal-command-canary",
      "sentinel-canary",
    ]) {
      expect(retained).not.toContain(forbidden);
    }
  });

  it("labels a completed proof with no applicable control as restricted-scope reproduction", async () => {
    await writeContractAtomic(
      join(workingDirectory, "granttrace.lock.json"),
      buildContract([contentsObservation], fixtureCatalog),
    );
    const result = await invoke(
      ["prove", "disposable-comment", "--", "unused-command"],
      fixtureEnvironment(),
      {
        runChild: async () => ({
          outcome: "pass",
          exitCode: 0,
          signal: null,
          observations: [contentsObservation],
          sessionCleanup: "pass",
        }),
        tokenTransport: echoingTokenTransport(),
        now,
        sourceCommit: null,
      },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      "Strength    Restricted scope reproduced",
    );
  });

  it("labels permission-name necessity as partial when controls cover only some selected permissions", async () => {
    await writeContractAtomic(
      join(workingDirectory, "granttrace.lock.json"),
      buildContract([observation, contentsObservation], fixtureCatalog),
    );
    const result = await invoke(
      ["prove", "disposable-comment", "--", "unused-command"],
      fixtureEnvironment(),
      {
        runChild: async () => ({
          outcome: "pass",
          exitCode: 0,
          signal: null,
          observations: [observation, contentsObservation],
          sessionCleanup: "pass",
        }),
        tokenTransport: echoingTokenTransport(),
        commentTransport: rejectionTransport(),
        now,
        sourceCommit: null,
      },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      "Strength    Necessity partially tested (permission-name removal)",
    );
  });

  it("writes a safe failed report for malformed live configuration", async () => {
    const result = await invoke(
      [
        "prove",
        "--scenario",
        "disposable-comment",
        "--",
        "unused-command",
      ],
      {},
      {
        runChild: async () => {
          throw new Error("Child must not run.");
        },
        sourceCommit: null,
      },
    );

    expect(result.code).toBe(5);
    expect(result.stderr).toContain("Configuration Failure");
    expect(result.stderr).toContain("Strength    Not established");
    const report = await readFile(
      join(
        workingDirectory,
        ".granttrace",
        "reports",
        "disposable-comment.json",
      ),
      "utf8",
    );
    expect(report).toContain('"failure": "configuration_failure"');
    expect(report).not.toContain("unused-command");
  });

  it("blocks an overlapping proof before it can overwrite the report", async () => {
    let signalStarted!: () => void;
    let releaseChild!: () => void;
    const started = new Promise<void>((resolveStarted) => {
      signalStarted = resolveStarted;
    });
    const release = new Promise<void>((resolveRelease) => {
      releaseChild = resolveRelease;
    });
    const dependencies = {
      runChild: async () => {
        signalStarted();
        await release;
        return {
          outcome: "pass" as const,
          exitCode: 0,
          signal: null,
          observations: [observation],
          sessionCleanup: "pass" as const,
        };
      },
      tokenTransport: tokenTransport(),
      commentTransport: rejectionTransport(),
      now,
      sourceCommit: null,
    };
    const first = invoke(
      [
        "prove",
        "--scenario",
        "disposable-comment",
        "--",
        "first-command",
      ],
      fixtureEnvironment(),
      dependencies,
    );
    await started;

    const overlapping = await invoke(
      [
        "prove",
        "--scenario",
        "disposable-comment",
        "--",
        "second-command",
      ],
      fixtureEnvironment(),
      dependencies,
    );
    expect(overlapping.code).toBe(5);
    expect(overlapping.stderr).toContain("Private ignored local state");

    releaseChild();
    expect((await first).code).toBe(0);
  });

  it("rejects an unknown scenario before resolving private-key providers", async () => {
    let providerCalled = false;
    const result = await invoke(
      [
        "prove",
        "--scenario",
        "unknown-scenario",
        "--",
        "unused-command",
      ],
      fixtureEnvironment(),
      { sourceCommit: null },
      () => {
        providerCalled = true;
        throw new Error("Private-key providers must not be touched.");
      },
    );

    expect(result.code).toBe(6);
    expect(result.stderr).toContain("current pinned catalog");
    expect(providerCalled).toBe(false);
    await expect(
      readFile(
        join(
          workingDirectory,
          ".granttrace",
          "reports",
          "unknown-scenario.json",
        ),
        "utf8",
      ),
    ).rejects.toBeDefined();
  });

  async function invoke(
    args: string[],
    environment: NodeJS.ProcessEnv,
    proofDependencies: NonNullable<CliContext["proofDependencies"]>,
    loadLiveFixtureConfig?: NonNullable<
      CliContext["loadLiveFixtureConfig"]
    >,
  ) {
    let stdout = "";
    let stderr = "";
    const context: CliContext = {
      cwd: workingDirectory,
      environment,
      stdout: {
        write(value: string | Uint8Array) {
          stdout += String(value);
          return true;
        },
      },
      stderr: {
        write(value: string | Uint8Array) {
          stderr += String(value);
          return true;
        },
      },
      proofDependencies,
      ...(loadLiveFixtureConfig === undefined
        ? {}
        : { loadLiveFixtureConfig }),
    };
    const code = await runCli(args, context);
    return { code, stdout, stderr };
  }

  function fixtureEnvironment(): NodeJS.ProcessEnv {
    return {
      PATH: "/safe/bin",
      GRANTTRACE_APP_ID: "12345",
      GRANTTRACE_INSTALLATION_ID: "98765",
      GRANTTRACE_APP_PRIVATE_KEY: privateKey,
      GRANTTRACE_LIVE_OWNER: "fixture-owner",
      GRANTTRACE_LIVE_REPOSITORY:
        "private-granttrace-fixture",
      GRANTTRACE_LIVE_ISSUE_NUMBER: "73",
      GRANTTRACE_LIVE_CONFIRM_DISPOSABLE: "1",
    };
  }
});

function tokenTransport(): InstallationTokenTransport {
  return {
    async createInstallationToken(request) {
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

function echoingTokenTransport(): InstallationTokenTransport {
  return {
    async createInstallationToken(request) {
      return {
        token: "ghs_SCOPED_TOKEN_CANARY",
        expires_at: "2026-07-23T13:00:00.000Z",
        permissions: {
          ...request.permissions,
          metadata: "read",
        },
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

function rejectionTransport(): LiveCommentTransport {
  return {
    async createComment() {
      throw { status: 403 };
    },
    async deleteComment() {
      throw new Error("Cleanup should not run after rejection.");
    },
  };
}

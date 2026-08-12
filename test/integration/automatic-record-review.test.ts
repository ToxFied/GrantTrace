import {
  chmod,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type { CliContext } from "../../src/cli/context.js";
import { runCli } from "../../src/cli/main.js";

const projectRoot = dirname(
  dirname(dirname(fileURLToPath(new URL(import.meta.url)))),
);
const explicitAdapterScenario = join(
  projectRoot,
  "test",
  "fixtures",
  "children",
  "explicit-adapter.ts",
);
const tsxImport = import.meta.resolve("tsx");

describe("record and review with the explicit Octokit adapter", () => {
  let workingDirectory: string | null = null;

  afterEach(async () => {
    if (workingDirectory !== null) {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  });

  it("captures Octokit traffic and accepts after one explicit prompt", async () => {
    workingDirectory = await mkdtemp(
      join(tmpdir(), "granttrace-automatic-review-"),
    );
    await chmod(workingDirectory, 0o700);
    let stdout = "";
    let stderr = "";
    let question = "";
    const context: CliContext = {
      cwd: workingDirectory,
      environment: localTestEnvironment(),
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
      async confirm(value) {
        question = value;
        return true;
      },
    };

    const code = await runCli(
      [
        "record",
        "issue-triage",
        "--",
        process.execPath,
        "--import",
        tsxImport,
        explicitAdapterScenario,
      ],
      context,
    );

    expect(code).toBe(0);
    expect(stdout).toContain("GrantTrace initialized");
    expect(stdout).toContain("GrantTrace recording started");
    expect(stdout).toContain("GrantTrace record complete");
    expect(stdout).toContain("GrantTrace contract accepted");
    expect(stderr).toContain("GrantTrace contract review required");
    expect(stderr).toContain("Changes  1 permission · 1 scenario · 1 route");
    expect(stderr).toContain("issues: write");
    expect(stderr).toContain("Decision");
    expect(question).toBe("Accept this permission contract? [y/N] ");

    const contract = await readFile(
      join(workingDirectory, "granttrace.lock.json"),
      "utf8",
    );
    expect(contract).toContain('"issue-triage"');
    for (const canary of [
      "ghs_AUTOMATIC_CHILD_CANARY",
      "automatic-owner-canary",
      "automatic-repo-canary",
      "automatic-body-canary",
      "402001",
    ]) {
      expect(`${stdout}\n${stderr}\n${contract}`).not.toContain(canary);
    }
  });

  it("saves evidence but never accepts without an interactive confirmation", async () => {
    workingDirectory = await mkdtemp(
      join(tmpdir(), "granttrace-noninteractive-review-"),
    );
    await chmod(workingDirectory, 0o700);
    let stderr = "";
    const context: CliContext = {
      cwd: workingDirectory,
      environment: localTestEnvironment(),
      stdout: { write: () => true },
      stderr: {
        write(value) {
          stderr += String(value);
          return true;
        },
      },
    };

    const code = await runCli(
      [
        "record",
        "issue-triage",
        "--",
        process.execPath,
        "--import",
        tsxImport,
        explicitAdapterScenario,
      ],
      context,
    );

    expect(code).toBe(6);
    expect(stderr).toContain("GrantTrace contract review required");
    expect(stderr).toContain("This terminal is noninteractive");
    await expect(
      readFile(join(workingDirectory, "granttrace.lock.json"), "utf8"),
    ).rejects.toBeDefined();
    expect(
      await readFile(
        join(
          workingDirectory,
          ".granttrace",
          "observations",
          "issue-triage.ndjson",
        ),
        "utf8",
      ),
    ).toContain('"scenario":"issue-triage"');
  });
});

function localTestEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment["CI"];
  delete environment["GITHUB_ACTIONS"];
  delete environment["GITHUB_STEP_SUMMARY"];
  delete environment["RUNNER_TEMP"];
  return environment;
}

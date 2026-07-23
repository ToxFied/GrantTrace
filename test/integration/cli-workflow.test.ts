import { spawn } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const projectRoot = dirname(
  dirname(dirname(fileURLToPath(new URL(import.meta.url)))),
);
const cliPath = join(projectRoot, "src", "cli", "main.ts");
const tsxImport = import.meta.resolve("tsx");
const childDirectory = join(projectRoot, "test", "fixtures", "children");

describe("record/check CLI workflow", () => {
  let workingDirectory: string;

  beforeEach(async () => {
    workingDirectory = await mkdtemp(join(tmpdir(), "granttrace-cli-"));
    await chmod(workingDirectory, 0o700);
  });

  afterEach(async () => {
    await rm(workingDirectory, { recursive: true, force: true });
  });

  it("records an instrumented child and accepts an unchanged contract", async () => {
    const record = await runCli([
      "record",
      "--scenario",
      "triage-integration",
      "--",
      process.execPath,
      "--import",
      tsxImport,
      join(childDirectory, "instrumented.ts"),
    ]);
    expect(record.code).toBe(0);
    expect(record.stdout).toContain("Observed  4 GitHub REST operations");
    const stateDirectory = join(workingDirectory, ".granttrace");
    const observationPath = join(
      stateDirectory,
      "observations",
      "triage-integration.ndjson",
    );
    expect((await stat(stateDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(observationPath)).mode & 0o777).toBe(0o600);

    const firstCheck = await runCli(["check"]);
    expect(firstCheck.code).toBe(6);
    expect(firstCheck.stderr).toContain("New permission");
    expect(firstCheck.stderr).toContain("issues: write");

    const accept = await runCli(["check", "--accept"]);
    expect(accept.code).toBe(0);
    const firstContract = await readFile(
      join(workingDirectory, "granttrace.lock.json"),
      "utf8",
    );
    const retained = [
      await readTree(stateDirectory),
      firstContract,
      record.stdout,
      record.stderr,
      firstCheck.stdout,
      firstCheck.stderr,
      accept.stdout,
      accept.stderr,
    ].join("\n");
    for (const canary of [
      "ghs_CHILD_PROCESS_CANARY",
      "child-owner-canary",
      "child-repo-canary",
      "child-body-canary",
      "401001",
      "401002",
      "401003",
      "401004",
    ]) {
      expect(retained).not.toContain(canary);
    }

    const unchanged = await runCli(["check"]);
    expect(unchanged.code).toBe(0);
    expect(unchanged.stdout).toContain("GrantTrace check passed");
    expect(
      await readFile(join(workingDirectory, "granttrace.lock.json"), "utf8"),
    ).toBe(firstContract);
  });

  it("fails clearly when the child never loads the plugin", async () => {
    const result = await runCli([
      "record",
      "--scenario",
      "triage-integration",
      "--",
      process.execPath,
      "--import",
      tsxImport,
      join(childDirectory, "no-plugin.ts"),
    ]);

    expect(result.code).toBe(3);
    expect(result.stderr).toContain("No instrumented GitHub REST operation");
  });

  it("distinguishes a loaded plugin with no observations", async () => {
    const result = await runCli([
      "record",
      "--scenario",
      "triage-integration",
      "--",
      process.execPath,
      "--import",
      tsxImport,
      join(childDirectory, "plugin-without-requests.ts"),
    ]);

    expect(result.code).toBe(3);
    expect(result.stderr).toContain("No instrumented GitHub REST operation");
  });

  it("distinguishes child-test failure from analysis failure", async () => {
    const result = await runCli([
      "record",
      "--scenario",
      "triage-integration",
      "--",
      process.execPath,
      "--import",
      tsxImport,
      join(childDirectory, "failing-instrumented.ts"),
    ]);

    expect(result.code).toBe(4);
    expect(result.stderr).toContain("test process failed");
    expect(result.stderr).toContain("No contract decision was made");
  });

  it("passes child arguments literally without invoking a shell", async () => {
    const sentinel = join(workingDirectory, "shell-injection-canary");
    const result = await runCli([
      "record",
      "--scenario",
      "triage-integration",
      "--",
      process.execPath,
      "--import",
      tsxImport,
      join(childDirectory, "instrumented.ts"),
      `;touch ${sentinel}`,
    ]);

    expect(result.code).toBe(0);
    await expect(access(sentinel)).rejects.toBeDefined();
  });

  it("fails with a reviewable diff when a new permission is observed", async () => {
    expect((await recordFixture("instrumented.ts")).code).toBe(0);
    expect((await runCli(["check", "--accept"])).code).toBe(0);

    expect((await recordFixture("contents.ts")).code).toBe(0);
    const changed = await runCli(["check"]);
    expect(changed.code).toBe(6);
    expect(changed.stderr).toContain("New permission");
    expect(changed.stderr).toContain("contents: read");
    expect(changed.stderr).toContain(
      "GET /repos/{owner}/{repo}/contents/{path}",
    );
  });

  it("blocks runtime/catalog contradictions instead of preferring a source", async () => {
    expect((await recordFixture("contradictory.ts")).code).toBe(0);
    const check = await runCli(["check"]);
    expect(check.code).toBe(7);
    expect(check.stderr).toContain("evidence_contradiction");
  });

  it("reports missing observation state as an instrumentation error", async () => {
    const check = await runCli(["check"]);
    expect(check.code).toBe(3);
    expect(check.stderr).toContain("No observations were found");
  });

  it("warns without failing when a permission is only no longer observed", async () => {
    expect((await recordFixture("instrumented.ts")).code).toBe(0);
    expect(
      (await recordFixture("contents.ts", "contents-integration")).code,
    ).toBe(0);
    expect((await runCli(["check", "--accept"])).code).toBe(0);

    await rm(
      join(
        workingDirectory,
        ".granttrace",
        "observations",
        "contents-integration.ndjson",
      ),
    );
    const check = await runCli(["check"]);
    expect(check.code).toBe(0);
    expect(check.stdout).toContain("passed with warnings");
    expect(check.stdout).toContain("contents: read");
    expect(check.stdout).toContain("not evidence");
  });

  it("rejects an excessive aggregate observation file set", async () => {
    const observationDirectory = join(
      workingDirectory,
      ".granttrace",
      "observations",
    );
    await mkdir(observationDirectory, { recursive: true });
    await Promise.all(
      Array.from({ length: 129 }, (_, index) =>
        writeFile(
          join(observationDirectory, `scenario-${String(index)}.ndjson`),
          "",
          "utf8",
        ),
      ),
    );

    const check = await runCli(["check"]);
    expect(check.code).toBe(5);
    expect(check.stderr).toContain("could not be validated safely");
  });

  it("classifies an executable spawn failure as a child-process failure", async () => {
    const result = await runCli([
      "record",
      "--scenario",
      "triage-integration",
      "--",
      join(workingDirectory, "command-that-does-not-exist"),
    ]);
    expect(result.code).toBe(4);
    expect(result.stderr).toContain("could not be started");
  });

  it("preserves and displays validated manual keeps separately", async () => {
    expect((await recordFixture("instrumented.ts")).code).toBe(0);
    expect((await runCli(["check", "--accept"])).code).toBe(0);
    const lockPath = join(workingDirectory, "granttrace.lock.json");
    const contract = JSON.parse(await readFile(lockPath, "utf8")) as {
      manualKeeps: Record<string, unknown>;
    };
    contract.manualKeeps = {
      actions: {
        level: "read",
        reason: "The webhook smoke test is not part of this scenario.",
      },
    };
    await writeFile(lockPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");

    const check = await runCli(["check"]);
    expect(check.code).toBe(0);
    expect(check.stdout).toContain("Manual keeps");
    expect(check.stdout).toContain("actions: read");
    expect(check.stdout).toContain("webhook smoke test");

    expect((await runCli(["check", "--accept"])).code).toBe(0);
    expect(await readFile(lockPath, "utf8")).toContain("webhook smoke test");
  });

  function recordFixture(
    name: string,
    scenario = "triage-integration",
  ) {
    return runCli([
      "record",
      "--scenario",
      scenario,
      "--",
      process.execPath,
      "--import",
      tsxImport,
      join(childDirectory, name),
    ]);
  }

  async function runCli(args: string[]): Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }> {
    return new Promise((resolveResult, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", tsxImport, cliPath, ...args],
        {
          cwd: workingDirectory,
          env: process.env,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.once("error", reject);
      child.once("close", (code) => {
        resolveResult({ code, stdout, stderr });
      });
    });
  }

  async function readTree(directory: string): Promise<string> {
    const entries = await readdir(directory, { withFileTypes: true });
    const contents: string[] = [];
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        contents.push(await readTree(path));
      } else if (entry.isFile()) {
        contents.push(await readFile(path, "utf8"));
      }
    }
    return contents.join("\n");
  }
});

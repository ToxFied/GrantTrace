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
const cliPath = join(projectRoot, "src", "cli", "bin.ts");
const tsxImport = import.meta.resolve("tsx");
const childDirectory = join(projectRoot, "test", "fixtures", "children");

describe("record/check CLI workflow", () => {
  let workingDirectory: string;

  beforeEach(async () => {
    workingDirectory = await mkdtemp(join(tmpdir(), "granttrace-cli-"));
    await chmod(workingDirectory, 0o700);
    expect((await runCli(["init"])).code).toBe(0);
  });

  afterEach(async () => {
    await rm(workingDirectory, { recursive: true, force: true });
  });

  it("initializes private ignored state on the first recording", async () => {
    await rm(join(workingDirectory, ".granttrace"), {
      recursive: true,
      force: true,
    });
    await rm(join(workingDirectory, ".gitignore"), { force: true });

    const record = await runCli([
      "record",
      "--no-review",
      "--scenario",
      "first-recording",
      "--",
      process.execPath,
      "--import",
      tsxImport,
      join(childDirectory, "instrumented.ts"),
    ]);

    expect(record.code).toBe(0);
    expect(record.stdout).toContain("GrantTrace initialized");
    expect(await readFile(join(workingDirectory, ".gitignore"), "utf8")).toBe(
      ".granttrace/\n",
    );
    expect((await stat(join(workingDirectory, ".granttrace"))).mode & 0o777).toBe(
      0o700,
    );
  });

  it("records an instrumented child and accepts an unchanged contract", async () => {
    const record = await runCli([
      "record",
      "--no-review",
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
    await expect(
      access(join(stateDirectory, "active-operation")),
    ).rejects.toBeDefined();
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
      "--no-review",
      "--scenario",
      "triage-integration",
      "--",
      process.execPath,
      "--import",
      tsxImport,
      join(childDirectory, "no-plugin.ts"),
    ]);

    expect(result.code).toBe(3);
    expect(result.stderr).toContain("No supported GitHub REST operation");
  });

  it("distinguishes a loaded plugin with no observations", async () => {
    const result = await runCli([
      "record",
      "--no-review",
      "--scenario",
      "triage-integration",
      "--",
      process.execPath,
      "--import",
      tsxImport,
      join(childDirectory, "plugin-without-requests.ts"),
    ]);

    expect(result.code).toBe(3);
    expect(result.stderr).toContain("No supported GitHub REST operation");
  });

  it("distinguishes child-test failure from analysis failure", async () => {
    const result = await runCli([
      "record",
      "--no-review",
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
      "--no-review",
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
    expect(check.stderr).toContain("Evidence conflict");
  });

  it("reports missing observation state as an instrumentation error", async () => {
    const check = await runCli(["check"]);
    expect(check.code).toBe(3);
    expect(check.stderr).toContain("No observations were found");
  });

  it("blocks contract acceptance while another local operation is active", async () => {
    expect((await recordFixture("instrumented.ts")).code).toBe(0);
    const operationLock = join(
      workingDirectory,
      ".granttrace",
      "active-operation",
    );
    await mkdir(operationLock, { mode: 0o700 });

    const check = await runCli(["check", "--accept"]);

    expect(check.code).toBe(5);
    expect(check.stderr).toContain("Another GrantTrace operation is active");
    await expect(
      access(join(workingDirectory, "granttrace.lock.json")),
    ).rejects.toBeDefined();
    await expect(access(operationLock)).resolves.toBeUndefined();
  });

  it("blocks when a permission is no longer observed until reviewed", async () => {
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
    expect(check.code).toBe(6);
    expect(check.stderr).toContain("No longer observed");
    expect(check.stderr).toContain("contents: read");
    expect(check.stderr).toContain("granttrace check --accept");
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
    expect(check.stderr).toContain(
      "observations or accepted contract are invalid",
    );
  });

  it("classifies an executable spawn failure as a child-process failure", async () => {
    const result = await runCli([
      "record",
      "--no-review",
      "--scenario",
      "triage-integration",
      "--",
      join(workingDirectory, "command-that-does-not-exist"),
    ]);
    expect(result.code).toBe(4);
    expect(result.stderr).toContain("could not be started");
  });

  it("terminates a hung recording at the configured timeout", async () => {
    const descendantPidPath = join(
      workingDirectory,
      "timeout-descendant.pid",
    );
    const result = await runCli([
      "record",
      "--no-review",
      "--scenario",
      "triage-integration",
      "--timeout",
      "1s",
      "--",
      process.execPath,
      "--import",
      tsxImport,
      join(childDirectory, "signal-handling.ts"),
      descendantPidPath,
    ]);

    expect(result.code).toBe(4);
    expect(result.stderr).toContain("GrantTrace record timed out");
    await expectProcessGone(Number(await readFile(descendantPidPath, "utf8")));
    const sessions = await readdir(
      join(workingDirectory, ".granttrace", "sessions"),
    );
    expect(sessions).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "discards evidence when the parent is interrupted even if the child exits zero",
    async () => {
      const descendantPidPath = join(
        workingDirectory,
        "interrupt-descendant.pid",
      );
      const running = spawn(
        process.execPath,
        [
          "--import",
          tsxImport,
          cliPath,
          "record",
          "--no-review",
          "--scenario",
          "interrupted-scenario",
          "--",
          process.execPath,
          "--import",
          tsxImport,
          join(childDirectory, "signal-handling.ts"),
          descendantPidPath,
        ],
        {
          cwd: workingDirectory,
          env: process.env,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "";
      let stderr = "";
      running.stdout.setEncoding("utf8");
      running.stderr.setEncoding("utf8");
      running.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      running.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      await waitForSessionMarker(workingDirectory);
      await waitForPath(descendantPidPath);
      const overlapping = await runCli([
        "record",
        "--no-review",
        "--scenario",
        "interrupted-scenario",
        "--",
        process.execPath,
        "-e",
        "process.exit(0)",
      ]);
      expect(overlapping.code).toBe(5);
      expect(overlapping.stderr).toContain("Private ignored local state");
      running.kill("SIGINT");
      const code = await new Promise<number | null>((resolveResult, reject) => {
        running.once("error", reject);
        running.once("close", resolveResult);
      });

      expect(code).toBe(130);
      expect(stderr).toContain("GrantTrace record interrupted");
      expect(stdout).not.toContain("record complete");
      await expectProcessGone(
        Number(await readFile(descendantPidPath, "utf8")),
      );
      await expect(
        access(
          join(
            workingDirectory,
            ".granttrace",
            "observations",
            "interrupted-scenario.ndjson",
          ),
        ),
      ).rejects.toBeDefined();
      expect(
        await readdir(join(workingDirectory, ".granttrace", "sessions")),
      ).toEqual([]);
    },
  );

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
      "--no-review",
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

async function waitForSessionMarker(directory: string): Promise<void> {
  const sessions = join(directory, ".granttrace", "sessions");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const entries = await readdir(sessions).catch(() => []);
    for (const entry of entries) {
      try {
        await access(join(sessions, entry, "plugin-loaded"));
        return;
      } catch {
        // The child is still starting.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for the signal-handling child.");
}

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
  throw new Error("Managed descendant remained alive.");
}

async function waitForPath(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolveDelay) => {
        setTimeout(resolveDelay, 10);
      });
    }
  }
  throw new Error("Timed out waiting for the managed descendant.");
}

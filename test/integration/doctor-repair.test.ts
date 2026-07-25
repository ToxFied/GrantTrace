import { spawn } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CliContext } from "../../src/cli/context.js";
import { runCli } from "../../src/cli/main.js";
import {
  acquireLocalOperationLock,
  LocalOperationLockError,
} from "../../src/security/local-state.js";

describe("doctor stale operation lock repair", () => {
  let workingDirectory: string;

  beforeEach(async () => {
    workingDirectory = await mkdtemp(join(tmpdir(), "granttrace-doctor-"));
    await chmod(workingDirectory, 0o700);
    expect(await invoke(["init"])).toMatchObject({ code: 0 });
  });

  afterEach(async () => {
    await rm(workingDirectory, { recursive: true, force: true });
  });

  it("records the lock owner and never repairs a live operation", async () => {
    const lock = await acquireLocalOperationLock(workingDirectory);
    const owner = JSON.parse(
      await readFile(join(lockPath(), "owner.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(owner).toMatchObject({
      schemaVersion: 1,
      pid: process.pid,
    });
    expect(owner["createdAt"]).toEqual(expect.any(String));
    await expect(
      acquireLocalOperationLock(workingDirectory),
    ).rejects.toBeInstanceOf(LocalOperationLockError);

    const doctor = await invoke(["doctor", "--repair"]);
    expect(doctor.code).toBe(5);
    expect(doctor.stderr).toContain("owner is still running");
    await expect(access(lockPath())).resolves.toBeUndefined();

    await lock.release();
    await expect(access(lockPath())).rejects.toBeDefined();
  });

  it("removes a private lock only after its recorded process is gone", async () => {
    const pid = await exitedChildPid();
    await createOwnerLock({
      schemaVersion: 1,
      pid,
      createdAt: new Date().toISOString(),
    });

    const doctor = await invoke(["doctor", "--repair"]);
    expect(doctor.code).toBe(0);
    expect(doctor.stdout).toContain(
      "Removed a private operation lock whose owner process is gone",
    );
    await expect(access(lockPath())).rejects.toBeDefined();
  });

  it("refuses a malformed owner record", async () => {
    await mkdir(lockPath(), { mode: 0o700 });
    await writeFile(
      join(lockPath(), "owner.json"),
      '{"schemaVersion":1,"pid":"not-a-pid"}\n',
      { mode: 0o600 },
    );

    const doctor = await invoke(["doctor", "--repair"]);
    expect(doctor.code).toBe(5);
    expect(doctor.stderr).toContain("owner record is malformed");
    await expect(access(lockPath())).resolves.toBeUndefined();
  });

  it("refuses a recent empty lock from the crash-before-owner window", async () => {
    await mkdir(lockPath(), { mode: 0o700 });

    const doctor = await invoke(["doctor", "--repair"]);
    expect(doctor.code).toBe(5);
    expect(doctor.stderr).toContain("too recent to prove stale");
    await expect(access(lockPath())).resolves.toBeUndefined();
  });

  it("refuses locks containing unknown artifacts", async () => {
    await mkdir(lockPath(), { mode: 0o700 });
    await writeFile(join(lockPath(), "unexpected"), "unsafe\n", {
      mode: 0o600,
    });

    const doctor = await invoke(["doctor", "--repair"]);
    expect(doctor.code).toBe(5);
    expect(doctor.stderr).toContain("unsafe or changed");
    await expect(access(lockPath())).resolves.toBeUndefined();
  });

  function lockPath(): string {
    return join(workingDirectory, ".granttrace", "active-operation");
  }

  async function createOwnerLock(owner: {
    schemaVersion: 1;
    pid: number;
    createdAt: string;
  }): Promise<void> {
    await mkdir(lockPath(), { mode: 0o700 });
    await writeFile(
      join(lockPath(), "owner.json"),
      `${JSON.stringify(owner)}\n`,
      { mode: 0o600 },
    );
  }

  async function invoke(args: string[]): Promise<{
    code: number;
    stdout: string;
    stderr: string;
  }> {
    let stdout = "";
    let stderr = "";
    const context: CliContext = {
      cwd: workingDirectory,
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
    };
    const code = await runCli(args, context);
    return { code, stdout, stderr };
  }
});

async function exitedChildPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], {
    stdio: "ignore",
    windowsHide: true,
  });
  const pid = child.pid;
  if (pid === undefined) {
    throw new Error("Test child did not start.");
  }
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", () => resolve());
  });
  return pid;
}

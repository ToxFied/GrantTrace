import { spawn } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rmdir,
} from "node:fs/promises";
import { join } from "node:path";

export type LocalStateInspection = {
  ready: boolean;
  observationFiles: number;
  issue:
    | "missing"
    | "unsafe_artifact"
    | "unsafe_observations"
    | "unsafe_root"
    | null;
  staleSessions: number;
};

export type LocalOperationLock = {
  release(): Promise<void>;
};

export class LocalOperationLockError extends Error {
  public constructor() {
    super("Another GrantTrace operation is active or left a stale lock.");
    this.name = "LocalOperationLockError";
  }
}

export async function initializeLocalState(cwd: string): Promise<void> {
  const root = join(cwd, ".granttrace");
  await createOrRepairPrivateDirectory(root);
  await createOrRepairPrivateDirectory(join(root, "observations"));

  const entries = await readdir(join(root, "observations"), {
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (!entry.name.endsWith(".ndjson")) {
      continue;
    }
    const path = join(root, "observations", entry.name);
    const details = await lstat(path);
    if (!details.isFile() || details.isSymbolicLink() || !ownedByCurrentUser(details)) {
      throw new Error("Unsafe local observation artifact.");
    }
    await chmod(path, 0o600);
  }
}

export async function ensurePrivateStateSubdirectory(
  cwd: string,
  name: "proof-sessions" | "reports" | "sessions",
): Promise<string> {
  const root = join(cwd, ".granttrace");
  await assertPrivateDirectory(root);
  const path = join(root, name);
  await createOrRepairPrivateDirectory(path);
  return path;
}

export async function acquireLocalOperationLock(
  cwd: string,
): Promise<LocalOperationLock> {
  const root = join(cwd, ".granttrace");
  await assertPrivateDirectory(root);
  const path = join(root, "active-operation");
  try {
    await mkdir(path, { mode: 0o700 });
    await assertPrivateDirectory(path);
  } catch {
    throw new LocalOperationLockError();
  }

  let released = false;
  return {
    async release() {
      if (released) {
        return;
      }
      await rmdir(path);
      released = true;
    },
  };
}

export async function inspectLocalState(
  cwd: string,
): Promise<LocalStateInspection> {
  const root = join(cwd, ".granttrace");
  try {
    await assertPrivateDirectory(root);
  } catch (error) {
    return {
      ready: false,
      observationFiles: 0,
      issue: isMissing(error) ? "missing" : "unsafe_root",
      staleSessions: 0,
    };
  }

  const observations = join(root, "observations");
  try {
    await assertPrivateDirectory(observations);
  } catch {
    return {
      ready: false,
      observationFiles: 0,
      issue: "unsafe_observations",
      staleSessions: 0,
    };
  }

  let observationFiles = 0;
  try {
    const entries = await readdir(observations, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.name.endsWith(".ndjson")) {
        continue;
      }
      const details = await lstat(join(observations, entry.name));
      if (
        !entry.isFile() ||
        !details.isFile() ||
        details.isSymbolicLink() ||
        !ownedByCurrentUser(details) ||
        !hasPrivateMode(details, 0o600)
      ) {
        return {
          ready: false,
          observationFiles: 0,
          issue: "unsafe_artifact",
          staleSessions: 0,
        };
      }
      observationFiles += 1;
    }
  } catch {
    return {
      ready: false,
      observationFiles: 0,
      issue: "unsafe_artifact",
      staleSessions: 0,
    };
  }

  let staleSessions = 0;
  const activeOperation = join(root, "active-operation");
  try {
    await assertPrivateDirectory(activeOperation);
    staleSessions += 1;
  } catch (error) {
    if (!isMissing(error)) {
      return {
        ready: false,
        observationFiles,
        issue: "unsafe_artifact",
        staleSessions,
      };
    }
  }
  for (const name of ["sessions", "proof-sessions", "reports"] as const) {
    const path = join(root, name);
    try {
      await assertPrivateDirectory(path);
      if (name !== "reports") {
        staleSessions += (await readdir(path)).length;
      } else {
        const reports = await readdir(path, { withFileTypes: true });
        for (const report of reports) {
          if (!report.name.endsWith(".json")) {
            continue;
          }
          const details = await lstat(join(path, report.name));
          if (
            !report.isFile() ||
            !details.isFile() ||
            details.isSymbolicLink() ||
            !ownedByCurrentUser(details) ||
            !hasPrivateMode(details, 0o600)
          ) {
            throw new Error("Unsafe local report artifact.");
          }
        }
      }
    } catch (error) {
      if (!isMissing(error)) {
        return {
          ready: false,
          observationFiles,
          issue: "unsafe_artifact",
          staleSessions,
        };
      }
    }
  }

  return {
    ready: true,
    observationFiles,
    issue: null,
    staleSessions,
  };
}

export async function stateIgnorePresent(cwd: string): Promise<boolean> {
  try {
    const ignorePath = join(cwd, ".gitignore");
    const details = await lstat(ignorePath);
    if (
      !details.isFile() ||
      details.isSymbolicLink() ||
      !ownedByCurrentUser(details)
    ) {
      return false;
    }
    const content = await readFile(ignorePath, "utf8");
    const explicitRule = content
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .some((line) => line === ".granttrace/" || line === "/.granttrace/");
    if (!explicitRule) {
      return false;
    }

    const insideWorkTree =
      (await gitExitCode(cwd, [
        "rev-parse",
        "--is-inside-work-tree",
      ])) === 0;
    if (!insideWorkTree) {
      return true;
    }
    return (
      (await gitExitCode(cwd, [
        "check-ignore",
        "--quiet",
        "--no-index",
        "--",
        ".granttrace/observations/granttrace-ignore-probe.ndjson",
      ])) === 0
    );
  } catch {
    return false;
  }
}

function gitExitCode(cwd: string, args: string[]): Promise<number | null> {
  return new Promise((resolveResult) => {
    const child = spawn("git", args, {
      cwd,
      env: process.env,
      shell: false,
      stdio: "ignore",
    });
    let settled = false;
    const settle = (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolveResult(code);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      settle(null);
    }, 5_000);
    timeout.unref();
    child.once("error", () => settle(null));
    child.once("close", (code) => settle(code));
  });
}

async function createOrRepairPrivateDirectory(path: string): Promise<void> {
  try {
    const details = await lstat(path);
    if (
      !details.isDirectory() ||
      details.isSymbolicLink() ||
      !ownedByCurrentUser(details)
    ) {
      throw new Error("Unsafe local state directory.");
    }
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
    await mkdir(path, { mode: 0o700 });
  }
  await chmod(path, 0o700);
  await assertPrivateDirectory(path);
}

async function assertPrivateDirectory(path: string): Promise<void> {
  const details = await lstat(path);
  if (
    !details.isDirectory() ||
    details.isSymbolicLink() ||
    !ownedByCurrentUser(details) ||
    !hasPrivateMode(details, 0o700)
  ) {
    throw new Error("Unsafe local state directory.");
  }
}

function ownedByCurrentUser(details: { uid: number }): boolean {
  const uid = process.getuid?.();
  return uid === undefined || details.uid === uid;
}

function hasPrivateMode(details: { mode: number }, expected: number): boolean {
  return process.platform === "win32" || (details.mode & 0o777) === expected;
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

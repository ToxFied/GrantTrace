import { spawn } from "node:child_process";
import {
  chmod,
  constants,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

const OPERATION_OWNER_FILE = "owner.json";
const MAX_OPERATION_OWNER_BYTES = 512;
const EMPTY_LOCK_STALE_AFTER_MS = 60 * 60 * 1_000;

type OperationOwner = {
  schemaVersion: 1;
  pid: number;
  createdAt: string;
};

export type OperationLockRepairResult =
  | { status: "absent" }
  | { status: "removed"; reason: "dead_pid" | "expired_empty_lock" }
  | {
      status: "not_removed";
      reason:
        | "empty_lock_too_young"
        | "live_pid"
        | "malformed_owner"
        | "unsafe_lock"
        | "unverifiable_pid";
    };

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
    if (
      !details.isFile() ||
      details.isSymbolicLink() ||
      details.nlink !== 1 ||
      !ownedByCurrentUser(details)
    ) {
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
  const owner: OperationOwner = {
    schemaVersion: 1,
    pid: process.pid,
    createdAt: new Date().toISOString(),
  };
  let created = false;
  try {
    await mkdir(path, { mode: 0o700 });
    created = true;
    await assertPrivateDirectory(path);
    await writeFile(
      join(path, OPERATION_OWNER_FILE),
      `${JSON.stringify(owner)}\n`,
      {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      },
    );
    await assertOperationOwnerFile(join(path, OPERATION_OWNER_FILE));
  } catch {
    if (created) {
      await unlink(join(path, OPERATION_OWNER_FILE)).catch(() => undefined);
      await rmdir(path).catch(() => undefined);
    }
    throw new LocalOperationLockError();
  }

  let released = false;
  return {
    async release() {
      if (released) {
        return;
      }
      await removeOperationLock(path, owner);
      released = true;
    },
  };
}

export async function repairStaleOperationLock(
  cwd: string,
): Promise<OperationLockRepairResult> {
  const root = join(cwd, ".granttrace");
  try {
    await assertPrivateDirectory(root);
  } catch (error) {
    return isMissing(error)
      ? { status: "absent" }
      : { status: "not_removed", reason: "unsafe_lock" };
  }

  const path = join(root, "active-operation");
  let directoryDetails;
  try {
    directoryDetails = await lstat(path);
  } catch (error) {
    return isMissing(error)
      ? { status: "absent" }
      : { status: "not_removed", reason: "unsafe_lock" };
  }
  if (!isPrivateDirectoryDetails(directoryDetails)) {
    return { status: "not_removed", reason: "unsafe_lock" };
  }

  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return { status: "not_removed", reason: "unsafe_lock" };
  }
  if (entries.length === 0) {
    const newestTimestamp = Math.max(
      directoryDetails.birthtimeMs,
      directoryDetails.ctimeMs,
      directoryDetails.mtimeMs,
    );
    if (
      !Number.isFinite(newestTimestamp) ||
      Date.now() - newestTimestamp < EMPTY_LOCK_STALE_AFTER_MS
    ) {
      return { status: "not_removed", reason: "empty_lock_too_young" };
    }
    try {
      await removeOperationLock(path, null);
      return { status: "removed", reason: "expired_empty_lock" };
    } catch {
      return { status: "not_removed", reason: "unsafe_lock" };
    }
  }

  if (
    entries.length !== 1 ||
    entries[0]?.name !== OPERATION_OWNER_FILE ||
    !entries[0].isFile()
  ) {
    return { status: "not_removed", reason: "unsafe_lock" };
  }

  let owner: OperationOwner;
  try {
    owner = await readOperationOwner(join(path, OPERATION_OWNER_FILE));
  } catch (error) {
    return {
      status: "not_removed",
      reason:
        error instanceof MalformedOperationOwnerError
          ? "malformed_owner"
          : "unsafe_lock",
    };
  }

  const pidState = processState(owner.pid);
  if (pidState !== "dead") {
    return {
      status: "not_removed",
      reason: pidState === "live" ? "live_pid" : "unverifiable_pid",
    };
  }
  try {
    await removeOperationLock(path, owner);
    return { status: "removed", reason: "dead_pid" };
  } catch {
    return { status: "not_removed", reason: "unsafe_lock" };
  }
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
        details.nlink !== 1 ||
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
    await assertOperationLockContents(activeOperation);
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
            details.nlink !== 1 ||
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
  if (!isPrivateDirectoryDetails(details)) {
    throw new Error("Unsafe local state directory.");
  }
}

async function assertOperationLockContents(path: string): Promise<void> {
  const entries = await readdir(path, { withFileTypes: true });
  if (entries.length === 0) {
    return;
  }
  if (
    entries.length !== 1 ||
    entries[0]?.name !== OPERATION_OWNER_FILE ||
    !entries[0].isFile()
  ) {
    throw new Error("Unsafe operation lock.");
  }
  await readOperationOwner(join(path, OPERATION_OWNER_FILE));
}

async function readOperationOwner(path: string): Promise<OperationOwner> {
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const details = await handle.stat();
    if (!isPrivateRegularFileDetails(details)) {
      throw new Error("Unsafe operation owner file.");
    }
    if (details.size < 1 || details.size > MAX_OPERATION_OWNER_BYTES) {
      throw new MalformedOperationOwnerError();
    }
    const content = await handle.readFile({ encoding: "utf8" });
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      throw new MalformedOperationOwnerError();
    }
    if (!isOperationOwner(value)) {
      throw new MalformedOperationOwnerError();
    }
    return value;
  } finally {
    await handle.close();
  }
}

async function assertOperationOwnerFile(path: string): Promise<void> {
  await readOperationOwner(path);
}

async function removeOperationLock(
  path: string,
  expectedOwner: OperationOwner | null,
): Promise<void> {
  await assertPrivateDirectory(path);
  const entries = await readdir(path, { withFileTypes: true });
  if (expectedOwner === null) {
    if (entries.length !== 0) {
      throw new Error("Operation lock changed during removal.");
    }
  } else {
    if (
      entries.length !== 1 ||
      entries[0]?.name !== OPERATION_OWNER_FILE ||
      !entries[0].isFile()
    ) {
      throw new Error("Operation lock changed during removal.");
    }
    const currentOwner = await readOperationOwner(
      join(path, OPERATION_OWNER_FILE),
    );
    if (!sameOperationOwner(currentOwner, expectedOwner)) {
      throw new Error("Operation lock owner changed during removal.");
    }
    await unlink(join(path, OPERATION_OWNER_FILE));
  }
  await rmdir(path);
}

function isOperationOwner(value: unknown): value is OperationOwner {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.keys(value).sort().join("\u0000") !==
      ["createdAt", "pid", "schemaVersion"].join("\u0000")
  ) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const createdAt = record["createdAt"];
  return (
    record["schemaVersion"] === 1 &&
    typeof record["pid"] === "number" &&
    Number.isSafeInteger(record["pid"]) &&
    record["pid"] >= 1 &&
    typeof createdAt === "string" &&
    createdAt.length === 24 &&
    Number.isFinite(Date.parse(createdAt)) &&
    new Date(createdAt).toISOString() === createdAt
  );
}

function sameOperationOwner(
  left: OperationOwner,
  right: OperationOwner,
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.pid === right.pid &&
    left.createdAt === right.createdAt
  );
}

function processState(pid: number): "dead" | "live" | "unverifiable" {
  try {
    process.kill(pid, 0);
    return "live";
  } catch (error) {
    return isErrorCode(error, "ESRCH") ? "dead" : "unverifiable";
  }
}

function isPrivateDirectoryDetails(details: {
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  mode: number;
  uid: number;
}): boolean {
  return (
    details.isDirectory() &&
    !details.isSymbolicLink() &&
    ownedByCurrentUser(details) &&
    hasPrivateMode(details, 0o700)
  );
}

function isPrivateRegularFileDetails(details: {
  isFile(): boolean;
  mode: number;
  nlink: number;
  uid: number;
}): boolean {
  return (
    details.isFile() &&
    details.nlink === 1 &&
    ownedByCurrentUser(details) &&
    hasPrivateMode(details, 0o600)
  );
}

class MalformedOperationOwnerError extends Error {}

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

function isErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

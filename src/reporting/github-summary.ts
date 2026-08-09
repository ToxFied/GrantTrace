import { constants, type Stats } from "node:fs";
import {
  lstat,
  open,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, sep } from "node:path";

const MAX_EXISTING_SUMMARY_BYTES = 1024 * 1024;
const MAX_APPEND_BYTES = 64 * 1024;

export class GithubStepSummaryError extends Error {
  public constructor() {
    super("The GitHub step summary file is unavailable or unsafe.");
    this.name = "GithubStepSummaryError";
  }
}

export async function appendGithubStepSummary(
  environment: NodeJS.ProcessEnv,
  markdown: string,
): Promise<void> {
  const path = environment["GITHUB_STEP_SUMMARY"];
  const runnerTemp = environment["RUNNER_TEMP"];
  if (
    environment["GITHUB_ACTIONS"] !== "true" ||
    path === undefined ||
    runnerTemp === undefined ||
    path.length === 0 ||
    runnerTemp.length === 0 ||
    path.includes("\0") ||
    runnerTemp.includes("\0") ||
    !isAbsolute(path) ||
    !isAbsolute(runnerTemp)
  ) {
    throw new GithubStepSummaryError();
  }

  try {
    const [resolvedRunnerTemp, resolvedParent] = await Promise.all([
      realpath(runnerTemp),
      realpath(dirname(path)),
    ]);
    const relativeParent = relative(resolvedRunnerTemp, resolvedParent);
    if (
      relativeParent === ".." ||
      relativeParent.startsWith(`..${sep}`) ||
      isAbsolute(relativeParent)
    ) {
      throw new GithubStepSummaryError();
    }
  } catch {
    throw new GithubStepSummaryError();
  }

  const content = `\n${markdown.trimEnd()}\n`;
  const contentBytes = Buffer.byteLength(content, "utf8");
  if (contentBytes > MAX_APPEND_BYTES) {
    throw new GithubStepSummaryError();
  }

  let before: Stats;
  try {
    before = await lstat(path);
  } catch {
    throw new GithubStepSummaryError();
  }
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    !ownedByCurrentUser(before) ||
    before.size > MAX_EXISTING_SUMMARY_BYTES - contentBytes
  ) {
    throw new GithubStepSummaryError();
  }

  let handle: FileHandle | undefined;
  try {
    handle = await open(
      path,
      constants.O_WRONLY |
        constants.O_APPEND |
        constants.O_NONBLOCK |
        (constants.O_NOFOLLOW ?? 0),
    );
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.nlink !== 1 ||
      !ownedByCurrentUser(opened) ||
      opened.size > MAX_EXISTING_SUMMARY_BYTES - contentBytes
    ) {
      throw new GithubStepSummaryError();
    }
    await handle.writeFile(content, { encoding: "utf8" });
  } catch {
    throw new GithubStepSummaryError();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function ownedByCurrentUser(details: { uid: number }): boolean {
  const uid = process.getuid?.();
  return uid === undefined || details.uid === uid;
}

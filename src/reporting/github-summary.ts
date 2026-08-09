import { constants, type Stats } from "node:fs";
import {
  lstat,
  open,
  type FileHandle,
} from "node:fs/promises";
import { isAbsolute } from "node:path";

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
  if (
    environment["GITHUB_ACTIONS"] !== "true" ||
    path === undefined ||
    path.length === 0 ||
    path.includes("\0") ||
    !isAbsolute(path)
  ) {
    throw new GithubStepSummaryError();
  }

  const safeMarkdown = markdown.trimEnd();
  if (
    safeMarkdown.length === 0 ||
    /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(safeMarkdown)
  ) {
    throw new GithubStepSummaryError();
  }
  const content = `\n${safeMarkdown}\n`;
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

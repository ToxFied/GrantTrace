import {
  readFile,
  lstat,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import type { CliContext } from "./context.js";
import { writeLine } from "./context.js";
import { ExitCode, type ExitCodeValue } from "./exit-codes.js";
import { initializeLocalState } from "../security/local-state.js";

export async function runInit(
  args: string[],
  context: CliContext,
): Promise<ExitCodeValue> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    writeLine(
      context.stdout,
      [
        "Initialize GrantTrace in the current project",
        "",
        "Usage",
        "  granttrace init",
        "",
        "Creates private local state and ensures .granttrace/ is ignored.",
        "It never creates credentials or changes GitHub settings.",
        "",
      ].join("\n"),
    );
    return ExitCode.success;
  }
  if (args.length > 0) {
    writeLine(context.stderr, "Usage: granttrace init");
    return ExitCode.usage;
  }

  try {
    const { ignoreChanged } = await initializeProjectState(context.cwd);

    writeLine(
      context.stdout,
      [
        "GrantTrace is ready for local recording",
        "",
        `Local state  .granttrace/ (private, ignored${
          ignoreChanged ? " just added to .gitignore" : ""
        })`,
        "",
        "Next",
        "  Run one named scenario:",
        "  granttrace record <name> -- <test-command>",
        "",
        "GrantTrace automatically observes standard Node fetch and Octokit.",
        "Custom transports can use the granttrace/octokit adapter.",
        "",
      ].join("\n"),
    );
    return ExitCode.success;
  } catch {
    writeLine(
      context.stderr,
      [
        "GrantTrace init failed",
        "",
        "GrantTrace could not create local state or update .gitignore.",
        "",
        "Next",
        "  Check that the current project directory is writable, then retry.",
        "",
      ].join("\n"),
    );
    return ExitCode.analysisFailure;
  }
}

export async function initializeProjectState(
  cwd: string,
): Promise<{ ignoreChanged: boolean }> {
  await initializeLocalState(cwd);
  return { ignoreChanged: await ensureStateIsIgnored(cwd) };
}

export async function ensureStateIsIgnored(cwd: string): Promise<boolean> {
  const ignorePath = join(cwd, ".gitignore");
  let existing = "";
  try {
    const details = await lstat(ignorePath);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new Error("Unsafe .gitignore entry.");
    }
    existing = await readFile(ignorePath, "utf8");
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
  }
  if (
    existing
      .split(/\r?\n/u)
      .map((line) => line.trim())
    .some((line) => line === ".granttrace/" || line === "/.granttrace/")
  ) {
    return false;
  }

  const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  const next = `${existing}${prefix}.granttrace/\n`;
  const temporaryPath = `${ignorePath}.granttrace-tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, next, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644,
    });
    await rename(temporaryPath, ignorePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return true;
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

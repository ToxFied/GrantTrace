import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import type { CliContext } from "./context.js";
import { writeLine } from "./context.js";
import { ExitCode, type ExitCodeValue } from "./exit-codes.js";

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
    const stateDirectory = join(context.cwd, ".granttrace");
    const observationsDirectory = join(stateDirectory, "observations");
    await mkdir(observationsDirectory, { recursive: true, mode: 0o700 });
    await chmod(stateDirectory, 0o700);
    await chmod(observationsDirectory, 0o700);
    const ignoreChanged = await ensureStateIsIgnored(context.cwd);

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
        "  1. Instrument the Octokit instance used by one test scenario.",
        "  2. Record it:",
        "     granttrace record --scenario <name> -- <test-command>",
        "  3. Review the proposed contract:",
        "     granttrace check",
        "  4. Accept it after review:",
        "     granttrace check --accept",
        "",
        "Guide",
        "  See README.md#quickstart for the Octokit snippet.",
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
        "Local state or .gitignore could not be updated safely.",
        "",
        "Next",
        "  Check that the current project directory is writable, then retry.",
        "",
      ].join("\n"),
    );
    return ExitCode.analysisFailure;
  }
}

async function ensureStateIsIgnored(cwd: string): Promise<boolean> {
  const ignorePath = join(cwd, ".gitignore");
  let existing = "";
  try {
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
      .includes(".granttrace/")
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

import { execFile } from "node:child_process";
import {
  chmod,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { readSourceCommit } from "../../src/cli/prove.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("proof source provenance", () => {
  it("reports HEAD only when tracked and untracked source state is clean", async () => {
    const directory = await mkdtemp(join(tmpdir(), "granttrace-source-"));
    temporaryDirectories.push(directory);
    await chmod(directory, 0o700);
    await git(directory, ["init"]);
    await git(directory, ["config", "user.email", "granttrace@example.test"]);
    await git(directory, ["config", "user.name", "GrantTrace Test"]);
    await writeFile(join(directory, "source.ts"), "export {};\n");
    await git(directory, ["add", "source.ts"]);
    await git(directory, ["commit", "-m", "fixture"]);

    const head = (await git(directory, ["rev-parse", "HEAD"])).trim();
    expect(await readSourceCommit(directory)).toBe(head);

    await writeFile(join(directory, "source.ts"), "export const dirty = true;\n");
    expect(await readSourceCommit(directory)).toBeNull();

    await git(directory, ["restore", "source.ts"]);
    await writeFile(join(directory, "untracked.ts"), "export {};\n");
    expect(await readSourceCommit(directory)).toBeNull();
  });
});

async function git(directory: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd: directory,
    encoding: "utf8",
  });
  return result.stdout;
}

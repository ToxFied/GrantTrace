import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CliContext } from "../../src/cli/context.js";
import { runCli } from "../../src/cli/main.js";
import { buildContract } from "../../src/contract/build.js";
import type { Observation } from "../../src/contract/observation.js";
import { writeObservations } from "../../src/contract/observation-file.js";
import { writeContractAtomic } from "../../src/contract/serialize.js";
import { githubPermissionCatalog } from "../../src/evidence/catalog.js";

describe("scenario inspection", () => {
  let directory: string;
  let observationPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "granttrace-inspect-"));
    await chmod(directory, 0o700);
    observationPath = join(
      directory,
      ".granttrace",
      "observations",
      "issues-read.ndjson",
    );
    expect(await runCli(["init"], captureContext(directory).context)).toBe(0);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("inspects only the requested recording in CI without changing local state", async () => {
    const observations = [issueObservation(), issueObservation()];
    await writeObservations(observationPath, observations);
    // Other recordings need not be parseable to inspect this one.
    await writeFile(
      join(directory, ".granttrace", "observations", "other.ndjson"),
      "invalid",
      { mode: 0o600 },
    );
    const lockPath = join(directory, "granttrace.lock.json");
    await writeContractAtomic(lockPath, {
      ...buildContract(observations, githubPermissionCatalog),
      manualKeeps: {
        actions: {
          level: "read",
          reason: "Required outside recorded scenarios.",
        },
      },
    });
    const before = await readFile(lockPath, "utf8");
    const recording = await readFile(observationPath, "utf8");
    const stateEntries = await readdir(join(directory, ".granttrace"));
    const output = captureContext(directory);

    expect(
      await runCli(["scenario", "inspect", "issues-read"], output.context),
    ).toBe(0);
    expect(output.stderr()).toBe("");
    expect(output.stdout()).toContain("Scenario: issues-read");
    expect(output.stdout()).toContain("Observed: 2 GitHub REST operations");
    expect(output.stdout()).toContain("issues: read");
    expect(output.stdout()).not.toContain("actions: read");
    expect(
      output.stdout().match(/GET \/repos\/\{owner\}\/\{repo\}\/issues/gu),
    ).toHaveLength(1);
    expect(output.stdout()).toContain("Runtime response header");
    expect(output.stdout()).toContain(
      "accepted policy and manual keeps are not included",
    );
    expect(await readFile(lockPath, "utf8")).toBe(before);
    expect(await readFile(observationPath, "utf8")).toBe(recording);
    expect(await readdir(join(directory, ".granttrace"))).toEqual(stateEntries);
  });

  it.each(["unresolved", "contradictory"])(
    "blocks %s evidence without reporting success",
    async (kind) => {
      const observation: Observation =
        kind === "unresolved"
          ? {
              ...issueObservation(),
              routeTemplate: null,
              requirements: null,
              evidenceSource: "none",
              finding: "unresolved_route",
            }
          : {
              ...issueObservation(),
              requirements: [[{ permission: "contents", level: "write" }]],
            };
      await writeObservations(observationPath, [observation]);
      const output = captureContext(directory);

      expect(
        await runCli(["scenario", "inspect", "issues-read"], output.context),
      ).toBe(7);
      expect(output.stdout()).toBe("");
      expect(output.stderr()).toContain("Analysis blocked");
      expect(output.stderr()).toContain(
        kind === "unresolved" ? "Unrecognized REST route" : "Evidence conflict",
      );
      expect(output.stderr()).not.toContain("Selected permission contract");
    },
  );

  it.each(["missing", "empty", "malformed", "mismatched", "mixed"])(
    "rejects a %s recording",
    async (kind) => {
      if (kind === "empty" || kind === "malformed") {
        await writeFile(
          observationPath,
          kind === "empty" ? "" : "secret-error-canary",
          { mode: 0o600 },
        );
      } else if (kind === "mismatched" || kind === "mixed") {
        await writeObservations(observationPath, [
          ...(kind === "mixed" ? [issueObservation()] : []),
          { ...issueObservation(), scenario: "other" },
        ]);
      }
      const output = captureContext(directory);

      expect(
        await runCli(["scenario", "inspect", "issues-read"], output.context),
      ).toBe(5);
      expect(output.stdout()).toBe("");
      expect(output.stderr()).toContain("missing, invalid, or unsafe");
      expect(output.stderr()).not.toContain("secret-error-canary");
      expect(output.stderr()).not.toContain(directory);
    },
  );

  it("does not create missing local state", async () => {
    await rm(join(directory, ".granttrace"), { recursive: true });
    const before = await readdir(directory);
    const output = captureContext(directory);

    expect(
      await runCli(["scenario", "inspect", "issues-read"], output.context),
    ).toBe(5);
    expect(await readdir(directory)).toEqual(before);
  });

  it.skipIf(process.platform === "win32")(
    "rejects a symlinked recording without reading its target",
    async () => {
      const target = join(directory, "private-target");
      await writeFile(target, "private-target-canary", { mode: 0o600 });
      await symlink(target, observationPath);
      const output = captureContext(directory);

      expect(
        await runCli(["scenario", "inspect", "issues-read"], output.context),
      ).toBe(5);
      expect(output.stdout()).toBe("");
      expect(output.stderr()).not.toContain("private-target-canary");
      expect(await readFile(target, "utf8")).toBe("private-target-canary");
    },
  );

  it.each([
    { args: [] },
    { args: ["../private"] },
    { args: ["issues-read", "extra"] },
  ])("rejects invalid inspect arguments %j", async ({ args }) => {
    const output = captureContext(directory);

    expect(await runCli(["scenario", "inspect", ...args], output.context)).toBe(
      2,
    );
    expect(output.stdout()).toBe("");
    expect(output.stderr()).toContain(
      "granttrace scenario inspect <safe-name>",
    );
    expect(output.stderr()).not.toContain("../private");
  });

  it("lists valid recordings in name order and points to inspection", async () => {
    await writeObservations(observationPath, [issueObservation()]);
    await writeObservations(
      join(directory, ".granttrace", "observations", "issues-read-extra.ndjson"),
      [{ ...issueObservation(), scenario: "issues-read-extra" }],
    );
    await writeObservations(
      join(directory, ".granttrace", "observations", "alpha.ndjson"),
      [{ ...issueObservation(), scenario: "alpha" }],
    );
    const output = captureContext(directory);

    expect(await runCli(["scenario", "list"], output.context)).toBe(0);
    expect(output.stdout()).toContain("  alpha\n  issues-read\n  issues-read-extra");
    expect(output.stdout()).toContain("granttrace scenario inspect <name>");
  });

  it.each(["mismatched", "unsafe-name"])(
    "does not list a %s recording as valid",
    async (kind) => {
      await writeObservations(
        kind === "mismatched"
          ? observationPath
          : join(directory, ".granttrace", "observations", "INVALID.ndjson"),
        [{ ...issueObservation(), scenario: "other" }],
      );
      const output = captureContext(directory);

      expect(await runCli(["scenario", "list"], output.context)).toBe(5);
      expect(output.stdout()).toBe("");
      expect(output.stderr()).toContain("invalid or unreadable");
    },
  );
});

function issueObservation(): Observation {
  return {
    schemaVersion: 1,
    scenario: "issues-read",
    method: "GET",
    routeTemplate: "/repos/{owner}/{repo}/issues",
    status: 200,
    requirements: [[{ permission: "issues", level: "read" }]],
    evidenceSource: "runtime_header",
    finding: null,
  };
}

function captureContext(cwd: string) {
  let stdout = "";
  let stderr = "";
  const context: CliContext = {
    cwd,
    environment: { CI: "1", NO_COLOR: "1" },
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
  return { context, stdout: () => stdout, stderr: () => stderr };
}

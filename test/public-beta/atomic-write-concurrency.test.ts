import {
  chmod,
  mkdtemp,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildContract } from "../../src/contract/build.js";
import type { Observation } from "../../src/contract/observation.js";
import {
  readContract,
  serializeContract,
  writeContractAtomic,
} from "../../src/contract/serialize.js";
import { githubPermissionCatalog } from "../../src/evidence/catalog.js";

describe("atomic contract writes", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "granttrace-atomic-"));
    await chmod(directory, 0o700);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("remains valid and leaves no temporary residue under concurrency", async () => {
    const path = join(directory, "granttrace.lock.json");
    const contract = buildContract([issueObservation()], githubPermissionCatalog);

    await Promise.all(
      Array.from({ length: 16 }, () => writeContractAtomic(path, contract)),
    );

    expect(serializeContract(await readContract(path))).toBe(
      serializeContract(contract),
    );
    expect(await readdir(directory)).toEqual(["granttrace.lock.json"]);
  });
});

function issueObservation(): Observation {
  return {
    schemaVersion: 1,
    scenario: "atomic-write",
    method: "GET",
    routeTemplate: "/repos/{owner}/{repo}/issues",
    status: 200,
    requirements: [[{ permission: "issues", level: "read" }]],
    evidenceSource: "runtime_header",
    finding: null,
  };
}

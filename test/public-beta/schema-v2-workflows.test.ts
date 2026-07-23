import {
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

import { runCheck } from "../../src/cli/check.js";
import type { CliContext } from "../../src/cli/context.js";
import { buildContract } from "../../src/contract/build.js";
import type { Observation } from "../../src/contract/observation.js";
import { writeObservations } from "../../src/contract/observation-file.js";
import { contractForScenario } from "../../src/contract/scenario.js";
import {
  ContractFileError,
  readContractWithMetadata,
  serializeContract,
} from "../../src/contract/serialize.js";
import { githubPermissionCatalog } from "../../src/evidence/catalog.js";

const issueRoute = "/repos/{owner}/{repo}/issues";
const contentsRoute = "/repos/{owner}/{repo}/contents/{path}";

describe("schema-v2 multi-scenario contracts", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "granttrace-schema-v2-"));
    await chmod(directory, 0o700);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("attributes shared and distinct routes deterministically", () => {
    const observations = [
      observed("zeta", "GET", issueRoute, "issues", "read"),
      observed("alpha", "GET", issueRoute, "issues", "read"),
      observed("zeta", "GET", contentsRoute, "contents", "read"),
    ];
    const first = buildContract(observations, githubPermissionCatalog);
    const second = buildContract(
      [...observations].reverse(),
      githubPermissionCatalog,
    );

    expect(serializeContract(first)).toBe(serializeContract(second));
    expect(first.scenarios).toEqual([{ name: "alpha" }, { name: "zeta" }]);
    expect(
      first.routes.find((route) => route.template === issueRoute)?.scenarios,
    ).toEqual(["alpha", "zeta"]);
    expect(
      first.routes.find((route) => route.template === contentsRoute)?.scenarios,
    ).toEqual(["zeta"]);
    expect(first.selectedPermissions).toEqual({
      contents: "read",
      issues: "read",
    });
  });

  it("projects one scenario without retaining another scenario's access", () => {
    const contract = buildContract(
      [
        observed("issues-only", "GET", issueRoute, "issues", "read"),
        observed(
          "contents-only",
          "GET",
          contentsRoute,
          "contents",
          "read",
        ),
      ],
      githubPermissionCatalog,
    );

    const projected = contractForScenario(contract, "issues-only");
    expect(projected.scenarios).toEqual([{ name: "issues-only" }]);
    expect(projected.routes).toHaveLength(1);
    expect(projected.routes[0]?.scenarios).toEqual(["issues-only"]);
    expect(projected.selectedPermissions).toEqual({ issues: "read" });
    expect(projected.unknowns).toEqual([]);
  });

  it("migrates v1 deterministically and reports the migration metadata", async () => {
    const contract = buildContract(
      [
        observed("alpha", "GET", issueRoute, "issues", "read"),
        observed(
          "zeta",
          "GET",
          contentsRoute,
          "contents",
          "read",
        ),
      ],
      githubPermissionCatalog,
    );
    const legacy = {
      ...contract,
      schemaVersion: 1,
      routes: contract.routes.map(({ scenarios: _scenarios, ...route }) => route),
    };
    const path = join(directory, "legacy.json");
    await writeFile(path, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");

    const migrated = await readContractWithMetadata(path);
    expect(migrated.migratedFromV1).toBe(true);
    expect(migrated.contract.schemaVersion).toBe(2);
    expect(
      migrated.contract.routes.every(
        (route) =>
          JSON.stringify(route.scenarios) === JSON.stringify(["alpha", "zeta"]),
      ),
    ).toBe(true);
    expect(serializeContract(migrated.contract)).not.toContain(
      '"schemaVersion": 1',
    );
  });

  it("blocks an otherwise-equal v1 lock until migration is accepted", async () => {
    const observations = [
      observed("issues-read", "GET", issueRoute, "issues", "read"),
    ];
    const contract = buildContract(observations, githubPermissionCatalog);
    const legacy = {
      ...contract,
      schemaVersion: 1,
      routes: contract.routes.map(({ scenarios: _scenarios, ...route }) => route),
    };
    const observationDirectory = join(
      directory,
      ".granttrace",
      "observations",
    );
    await mkdir(observationDirectory, { recursive: true, mode: 0o700 });
    await writeObservations(
      join(observationDirectory, "issues-read.ndjson"),
      observations,
    );
    const lockPath = join(directory, "granttrace.lock.json");
    await writeFile(lockPath, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");
    const output = captureContext(directory);

    const code = await runCheck([], output.context);

    expect(code).toBe(6);
    expect(output.stderr()).toContain("Schema migration required");
    expect(output.stderr()).toContain(
      "v1 -> v2 adds exact route-to-scenario attribution",
    );
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toMatchObject({
      schemaVersion: 1,
    });
  });

  it("rejects undeclared attribution and unattributed scenarios", () => {
    const contract = buildContract(
      [observed("issues-read", "GET", issueRoute, "issues", "read")],
      githubPermissionCatalog,
    );

    expect(() =>
      serializeContract({
        ...contract,
        routes: contract.routes.map((route) => ({
          ...route,
          scenarios: ["undeclared"],
        })),
      }),
    ).toThrow(ContractFileError);

    expect(() =>
      serializeContract({
        ...contract,
        scenarios: [...contract.scenarios, { name: "unattributed" }],
      }),
    ).toThrow(ContractFileError);
  });
});

function observed(
  scenario: string,
  method: Observation["method"],
  routeTemplate: string,
  permission: string,
  level: "read" | "write",
): Observation {
  return {
    schemaVersion: 1,
    scenario,
    method,
    routeTemplate,
    status: 200,
    requirements: [[{ permission, level }]],
    evidenceSource: "runtime_header",
    finding: null,
  };
}

function captureContext(cwd: string): {
  context: CliContext;
  stdout(): string;
  stderr(): string;
} {
  let stdout = "";
  let stderr = "";
  return {
    context: {
      cwd,
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
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

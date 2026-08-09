import {
  access,
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/main.js";
import type { CliContext } from "../../src/cli/context.js";
import { buildContract } from "../../src/contract/build.js";
import {
  appendObservation,
  loadObservations,
  ObservationFileError,
} from "../../src/contract/observation-file.js";
import type { Observation } from "../../src/contract/observation.js";
import {
  ContractFileError,
  readContract,
  serializeContract,
  writeContractAtomic,
} from "../../src/contract/serialize.js";
import { fixtureCatalog } from "../../src/evidence/catalog.js";
import { resolveEvidence } from "../../src/evidence/resolve.js";
import { solvePermissionContract, SolverLimitError } from "../../src/permissions/solver.js";
import { validateAcceptedProofContract } from "../../src/proof/contract-verification.js";
import {
  ProofReportError,
  serializeProofReport,
} from "../../src/proof/report.js";
import {
  inspectLocalState,
  stateIgnorePresent,
} from "../../src/security/local-state.js";
import { createRecorderConfig } from "../../src/octokit/config.js";

const temporaryDirectories: string[] = [];
const issuesRoute = "/repos/{owner}/{repo}/issues";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("public-beta hardening regressions", () => {
  it("reviews and accepts retirement of the final scenario", async () => {
    const directory = await temporaryDirectory();
    const context = captureContext(directory);
    expect(await runCli(["init"], context.context)).toBe(0);
    await writeContractAtomic(
      join(directory, "granttrace.lock.json"),
      buildContract([observation("retired")], fixtureCatalog),
    );

    const review = captureContext(directory);
    expect(await runCli(["check"], review.context)).toBe(6);
    expect(review.stderr()).toContain("Scenario removed");
    expect(review.stderr()).toContain("No longer observed");

    expect(
      await runCli(["check", "--accept"], captureContext(directory).context),
    ).toBe(0);
    const accepted = await readContract(join(directory, "granttrace.lock.json"));
    expect(accepted.scenarios).toEqual([]);
    expect(accepted.routes).toEqual([]);
    expect(
      await runCli(["check"], captureContext(directory).context),
    ).toBe(0);
  });

  it("keeps mixed same-route evidence attributable per scenario", () => {
    const valid = observation("valid-scenario");
    const blocked = {
      ...observation("blocked-scenario"),
      requirements: null,
      evidenceSource: "none" as const,
      finding: "malformed_header" as const,
    };

    const resolved = resolveEvidence([blocked, valid], fixtureCatalog);
    expect(resolved.requirements[0]?.scenarios).toEqual(["valid-scenario"]);
    expect(resolved.unknowns).toEqual([
      {
        scenario: "blocked-scenario",
        method: "GET",
        template: issuesRoute,
        finding: "malformed_header",
      },
    ]);
    expect(() =>
      serializeContract(buildContract([blocked, valid], fixtureCatalog)),
    ).not.toThrow();
  });

  it("rejects concrete, unknown, and catalog-divergent proof routes", () => {
    const valid = buildContract([observation("safe-scenario")], fixtureCatalog);
    const concrete = structuredClone(valid);
    concrete.routes[0]!.template = "/repos/acme/private-repository/issues";
    expect(() => serializeContract(concrete)).toThrow();

    const divergent = structuredClone(valid);
    divergent.routes[0]!.alternatives = [
      [{ permission: "contents", level: "read" }],
    ];
    divergent.selectedPermissions = { contents: "read" };
    divergent.permissionFrontier = [{ contents: "read" }];
    expect(() =>
      validateAcceptedProofContract(divergent, "safe-scenario"),
    ).toThrow();
  });

  it("bounds contract and observation reads before allocation", async () => {
    const directory = await temporaryDirectory();
    const observationPath = join(directory, "large.ndjson");
    await writeFile(observationPath, Buffer.alloc(10 * 1024 * 1024 + 1));
    await expect(loadObservations(observationPath)).rejects.toThrow(
      ObservationFileError,
    );

    const contractPath = join(directory, "large.json");
    await writeFile(contractPath, Buffer.alloc(5 * 1024 * 1024 + 1));
    await expect(readContract(contractPath)).rejects.toThrow(ContractFileError);
  });

  it.skipIf(process.platform === "win32")(
    "rejects symlinked artifacts and state roots",
    async () => {
      const directory = await temporaryDirectory();
      const outside = await temporaryDirectory();
      const target = join(outside, "observation.ndjson");
      await writeFile(target, `${JSON.stringify(observation("safe"))}\n`, {
        mode: 0o600,
      });
      const linked = join(directory, "linked.ndjson");
      await symlink(target, linked);
      await expect(loadObservations(linked)).rejects.toThrow(
        ObservationFileError,
      );

      const project = await temporaryDirectory();
      await chmod(outside, 0o700);
      await symlink(outside, join(project, ".granttrace"));
      const before = (await stat(outside)).mode & 0o777;
      expect(await runCli(["init"], captureContext(project).context)).toBe(5);
      expect((await stat(outside)).mode & 0o777).toBe(before);

      const childMarker = join(project, "child-ran");
      expect(
        await runCli(
          [
            "record",
            "--scenario",
            "unsafe-state",
            "--",
            process.execPath,
            "-e",
            `require("node:fs").writeFileSync(${JSON.stringify(childMarker)}, "ran")`,
          ],
          captureContext(project).context,
        ),
      ).toBe(5);
      await expect(access(childMarker)).rejects.toBeDefined();

      const initialized = await temporaryDirectory();
      expect(
        await runCli(["init"], captureContext(initialized).context),
      ).toBe(0);
      const externalIgnore = join(outside, "external-gitignore");
      await writeFile(externalIgnore, ".granttrace/\n", { mode: 0o600 });
      await rm(join(initialized, ".gitignore"));
      await symlink(externalIgnore, join(initialized, ".gitignore"));
      expect(await stateIgnorePresent(initialized)).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects hard-linked local observations and reports",
    async () => {
      const project = await temporaryDirectory();
      expect(
        await runCli(["init"], captureContext(project).context),
      ).toBe(0);

      const outside = await temporaryDirectory();
      const externalObservation = join(outside, "observation.ndjson");
      const linkedObservation = join(
        project,
        ".granttrace",
        "observations",
        "linked.ndjson",
      );
      await writeFile(externalObservation, "outside\n", { mode: 0o644 });
      await link(externalObservation, linkedObservation);

      expect(
        await runCli(["init"], captureContext(project).context),
      ).toBe(5);
      expect((await stat(externalObservation)).mode & 0o777).toBe(0o644);

      await chmod(externalObservation, 0o600);
      await expect(inspectLocalState(project)).resolves.toMatchObject({
        ready: false,
        issue: "unsafe_artifact",
      });
      await rm(linkedObservation);

      const reports = join(project, ".granttrace", "reports");
      await mkdir(reports, { mode: 0o700 });
      const externalReport = join(outside, "report.json");
      await writeFile(externalReport, "{}\n", { mode: 0o600 });
      await link(externalReport, join(reports, "linked.json"));

      await expect(inspectLocalState(project)).resolves.toMatchObject({
        ready: false,
        issue: "unsafe_artifact",
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects unsafe recorder directories and observation targets",
    async () => {
      const directory = await temporaryDirectory();
      const linkedDirectory = join(await temporaryDirectory(), "session");
      await symlink(directory, linkedDirectory);
      expect(() =>
        createRecorderConfig("safe-scenario", linkedDirectory),
      ).toThrow();
      await chmod(directory, 0o755);
      expect(() =>
        createRecorderConfig("safe-scenario", directory),
      ).toThrow();
      await chmod(directory, 0o700);

      const observationPath = join(directory, "observations.ndjson");
      const outside = join(await temporaryDirectory(), "outside.ndjson");
      await writeFile(outside, "outside\n", { mode: 0o600 });
      await symlink(outside, observationPath);
      await expect(
        appendObservation(observationPath, observation("safe-scenario")),
      ).rejects.toThrow();
      expect(await readFile(outside, "utf8")).toBe("outside\n");

      await rm(observationPath);
      await writeFile(observationPath, "", { mode: 0o644 });
      await expect(
        appendObservation(observationPath, observation("safe-scenario")),
      ).rejects.toThrow(ObservationFileError);
    },
  );

  it("refuses to append beyond the cumulative observation size limit", async () => {
    const directory = await temporaryDirectory();
    const observationPath = join(directory, "observations.ndjson");
    const limit = 10 * 1024 * 1024;
    await writeFile(observationPath, Buffer.alloc(limit), { mode: 0o600 });

    await expect(
      appendObservation(observationPath, observation("safe-scenario")),
    ).rejects.toThrow(ObservationFileError);
    expect((await stat(observationPath)).size).toBe(limit);
  });

  it("serializes concurrent appends before enforcing the cumulative limit", async () => {
    const directory = await temporaryDirectory();
    const observationPath = join(directory, "observations.ndjson");
    const record = observation("safe-scenario");
    const serializedBytes = Buffer.byteLength(
      `${JSON.stringify(record)}\n`,
      "utf8",
    );
    const limit = 10 * 1024 * 1024;
    await writeFile(
      observationPath,
      Buffer.alloc(limit - serializedBytes),
      { mode: 0o600 },
    );

    const results = await Promise.allSettled([
      appendObservation(observationPath, record),
      appendObservation(observationPath, record),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect((await stat(observationPath)).size).toBe(limit);
  });

  it("reports conflicting providers without echoing values", async () => {
    const directory = await temporaryDirectory();
    expect(
      await runCli(["init"], captureContext(directory).context),
    ).toBe(0);
    const output = captureContext(directory, {
      GRANTTRACE_APP_PRIVATE_KEY: "INLINE_SECRET_CANARY",
      GRANTTRACE_APP_PRIVATE_KEY_FILE: "/not/read/because/providers-conflict",
    });
    expect(await runCli(["doctor"], output.context)).toBe(0);
    expect(output.stdout()).toContain("WARN");
    expect(output.stdout()).toContain("Choose exactly one");
    expect(output.stdout()).not.toContain("INLINE_SECRET_CANARY");
  });

  it("does not persist a recording when private session cleanup fails", async () => {
    const directory = await temporaryDirectory();
    expect(
      await runCli(["init"], captureContext(directory).context),
    ).toBe(0);
    const output = captureContext(directory);
    output.context.recordDependencies = {
      removeSession: async () => {
        throw new Error("cleanup canary");
      },
    };
    const childSource = [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'const dir = process.env.GRANTTRACE_SESSION_DIR;',
      'const scenario = process.env.GRANTTRACE_SCENARIO;',
      'fs.writeFileSync(path.join(dir, "plugin-loaded"), "loaded\\n");',
      `fs.writeFileSync(path.join(dir, "observations.ndjson"), JSON.stringify({schemaVersion:1,scenario,method:"GET",routeTemplate:"${issuesRoute}",status:200,requirements:[[{permission:"issues",level:"read"}]],evidenceSource:"runtime_header",finding:null})+"\\n");`,
    ].join("");
    expect(
      await runCli(
        [
          "record",
          "--scenario",
          "cleanup-failure",
          "--",
          process.execPath,
          "-e",
          childSource,
        ],
        output.context,
      ),
    ).toBe(5);
    expect(output.stderr()).toContain("record cleanup failed");
    await expect(
      access(
        join(
          directory,
          ".granttrace",
          "observations",
          "cleanup-failure.ndjson",
        ),
      ),
    ).rejects.toBeDefined();
  });

  it("treats dotenv-shaped empty provider values as absent", async () => {
    const directory = await temporaryDirectory();
    expect(
      await runCli(["init"], captureContext(directory).context),
    ).toBe(0);
    const output = captureContext(directory, {
      GRANTTRACE_APP_PRIVATE_KEY: "",
      GRANTTRACE_APP_PRIVATE_KEY_FILE: "",
      GRANTTRACE_APP_PRIVATE_KEY_KEYCHAIN_SERVICE: "",
      GRANTTRACE_APP_PRIVATE_KEY_KEYCHAIN_ACCOUNT: "",
    });
    expect(await runCli(["doctor"], output.context)).toBe(0);
    expect(output.stdout()).toContain(
      "INFO  Optional live proof is not configured",
    );
  });

  it("rejects deceptive or credential-shaped manual-keep reasons", async () => {
    const directory = await temporaryDirectory();
    await mkdir(join(directory, ".granttrace", "observations"), {
      recursive: true,
      mode: 0o700,
    });
    await chmod(join(directory, ".granttrace"), 0o700);
    await writeContractAtomic(
      join(directory, "granttrace.lock.json"),
      buildContract([observation("safe-scenario")], fixtureCatalog),
    );
    const output = captureContext(directory);
    expect(
      await runCli(
        [
          "keep",
          "add",
          "contents:read",
          "--reason",
          ["Retain ghs_", "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"].join(""),
        ],
        output.context,
      ),
    ).toBe(2);
    expect(output.stderr()).not.toContain("ghs_");
  });

  it("rejects impossible proof-report terminal states", () => {
    const report = validReport();
    expect(() =>
      serializeProofReport({
        ...report,
        negativeControls: [
          {
            id: "issue-comment-create",
            mode: "mutating",
            removedPermission: "issues",
            status: "not_run",
            cleanup: "not_required",
          },
        ],
        cleanup: { status: "not_run" },
      }),
    ).toThrow(ProofReportError);
    expect(() =>
      serializeProofReport({
        ...report,
        negativeControls: [
          {
            id: "issue-comment-create",
            mode: "mutating",
            removedPermission: "issues",
            status: "unexpected_pass",
            cleanup: "not_required",
          },
        ],
      }),
    ).toThrow(ProofReportError);
  });

  it("stops a large nondominated frontier at its explicit bound", () => {
    const alternatives = Array.from({ length: 200 }, (_, index) => [
      { permission: `permission_${index}`, level: "read" as const },
    ]);
    expect(() =>
      solvePermissionContract(
        [
          {
            route: { method: "GET", template: "/bounded" },
            alternatives,
            evidence: ["runtime_header"],
            scenarioEvidence: { bounded: ["runtime_header"] },
            scenarios: ["bounded"],
          },
        ],
        { maxFrontier: 50 },
      ),
    ).toThrow(SolverLimitError);
  });
});

function observation(scenario: string): Observation {
  return {
    schemaVersion: 1,
    scenario,
    method: "GET",
    routeTemplate: issuesRoute,
    status: 200,
    requirements: [[{ permission: "issues", level: "read" }]],
    evidenceSource: "runtime_header",
    finding: null,
  };
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "granttrace-hardening-"));
  temporaryDirectories.push(directory);
  await chmod(directory, 0o700);
  return directory;
}

function captureContext(
  cwd: string,
  environment: NodeJS.ProcessEnv = {},
): {
  context: CliContext;
  stdout(): string;
  stderr(): string;
} {
  let stdout = "";
  let stderr = "";
  return {
    context: {
      cwd,
      environment,
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

function validReport(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    toolVersion: "0.1.0-beta.1",
    apiVersion: "2026-03-10",
    sourceCommit: null,
    scenario: "safe-scenario",
    catalog: {
      source: "github-docs",
      version: "2026-03-10.20260723.1",
      checksum: `sha256:${"a".repeat(64)}`,
    },
    contractHash: `sha256:${"b".repeat(64)}`,
    selectedPermissions: { issues: "read" },
    manualKeeps: {},
    requestedPermissions: { issues: "read" },
    mandatoryPermissions: { metadata: "read" },
    effectivePermissions: { issues: "read", metadata: "read" },
    repositoryScopeVerified: true,
    contractMatched: true,
    proofStrength: "restricted_scope_reproduced",
    child: { exitCode: 0, signal: null, observedOperations: 1 },
    positiveProof: { status: "pass" },
    negativeControls: [
      {
        id: "issue-comments-read",
        mode: "read_only",
        removedPermission: "issues",
        status: "not_applicable",
        cleanup: "not_required",
      },
      {
        id: "issue-comment-create",
        mode: "mutating",
        removedPermission: "issues",
        status: "not_applicable",
        cleanup: "not_required",
      },
    ],
    cleanup: { status: "pass" },
  };
}

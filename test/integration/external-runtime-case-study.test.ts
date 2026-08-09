import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildContract } from "../../src/contract/build.js";
import { loadObservations } from "../../src/contract/observation-file.js";
import { githubPermissionCatalog } from "../../src/evidence/catalog.js";
import { isSyntacticallySafeTemplate } from "../../src/routes/canonical.js";

type EmittedRequest = {
  method: string;
  routeTemplate: string;
  status: number;
};

type RuntimeManifest = {
  schemaVersion: 1;
  fixtureKind: "credential-free-mocked-runtime";
  upstream: {
    name: string;
    repository: string;
    commit: string;
    commitUrl: string;
    license: string;
    packageLockSha256: string;
  };
  scenario: {
    name: string;
    trigger: string;
    upstreamTestSource: string;
    observations: string;
    emittedRequests: string;
    requestCount: number;
    uniqueRouteCount: number;
    catalogCoveredUniqueRouteCount: number;
    catalogGapUniqueRouteCount: number;
  };
  execution: {
    capturedOn: string;
    liveGitHub: boolean;
    credentials: string;
    networkBoundary: string;
    setupMeasurements: Array<{
      command: string;
      cwd?: string;
      elapsedSeconds: number;
    }>;
    runtimeMeasurement: {
      command: string;
      cwd: string;
      elapsedSeconds: number;
      sanitizedChildElapsedSeconds: number;
    };
    endToEndMeasurement: {
      command: string;
      cwd: string;
      elapsedSeconds: number;
      sanitizedChildElapsedSeconds: number;
    };
    upstreamInstallAuditSummary: {
      total: number;
      low: number;
      moderate: number;
      high: number;
      critical: number;
      remediationAttempted: boolean;
    };
  };
  declaredPermissions: Record<string, "read" | "write">;
  resolvableSubset: {
    complete: boolean;
    selectedPermissions: Record<string, "read" | "write">;
    permissionFrontier: Array<Record<string, "read" | "write">>;
    evidence: string;
    unknownMethods: string[];
  };
  routeCoverage: Array<{
    method: string;
    template: string;
    calls: number;
    statuses: number[];
    catalogSupport: "covered" | "gap";
    inferredPermissions: string | null;
  }>;
  evidencedCatalogGap: {
    count: number;
    routes: string[];
    effect: string;
  };
  permissionAssumption: {
    scope: string;
    finding: string;
    appLevelReductionSupported: boolean;
  };
  maintainerFeedback: { solicited: boolean; status: string };
  limitations: string[];
};

const fixtureDirectory = join(
  process.cwd(),
  "case-studies",
  "all-contributors-app",
);
const runtimeManifestPath = join(fixtureDirectory, "runtime-case-study.json");
const runtimeHarnessPath = join(
  process.cwd(),
  "scripts",
  "run-all-contributors-runtime-pilot.mjs",
);
const pinnedCommit = "00f6362ffcc927a2d05fec27f42c3d09e4b03adb";

describe("All Contributors Bot credential-free runtime pilot", () => {
  it("records pinned mocked execution provenance and measured setup", async () => {
    const manifestText = await readFile(runtimeManifestPath, "utf8");
    const manifest = JSON.parse(manifestText) as RuntimeManifest;

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      fixtureKind: "credential-free-mocked-runtime",
      upstream: {
        name: "All Contributors Bot",
        repository: "https://github.com/all-contributors/app",
        commit: pinnedCommit,
        commitUrl: `https://github.com/all-contributors/app/commit/${pinnedCommit}`,
        license: "MIT",
      },
      scenario: {
        name: "all-contributors-mocked-runtime",
        trigger: "issue_comment.created",
        requestCount: 10,
        uniqueRouteCount: 7,
        catalogCoveredUniqueRouteCount: 3,
        catalogGapUniqueRouteCount: 4,
      },
      execution: {
        capturedOn: "2026-08-09",
        liveGitHub: false,
        networkBoundary: "nock.disableNetConnect()",
      },
      maintainerFeedback: {
        solicited: false,
        status: "unavailable",
      },
    });
    expect(manifest.upstream.packageLockSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(manifest.execution.credentials).toContain("dummy");
    expect(manifestText).not.toMatch(
      /(?:\/private\/tmp(?:\/|\b)|\/var\/folders(?:\/|\b))/u,
    );
    expect(manifest.execution.setupMeasurements.map(({ cwd }) => cwd)).toEqual([
      "<granttrace-checkout>",
      undefined,
      "<temporary-root>/upstream",
      "<temporary-root>/upstream",
    ]);
    expect(manifest.execution.runtimeMeasurement).toMatchObject({
      command:
        "/usr/bin/time -p node --import=tsx scripts/run-all-contributors-runtime-pilot.mjs --upstream <pinned-upstream-checkout>",
      cwd: "<granttrace-checkout>",
    });
    expect(manifest.execution.endToEndMeasurement.cwd).toBe(
      "<granttrace-checkout>",
    );
    expect(manifest.execution.upstreamInstallAuditSummary).toEqual({
      total: 62,
      low: 9,
      moderate: 31,
      high: 20,
      critical: 2,
      remediationAttempted: false,
    });
    expect(manifest.execution.setupMeasurements).toHaveLength(4);
    for (const measurement of [
      ...manifest.execution.setupMeasurements,
      manifest.execution.runtimeMeasurement,
      manifest.execution.endToEndMeasurement,
    ]) {
      expect(measurement.command.length).toBeGreaterThan(0);
      expect(measurement.elapsedSeconds).toBeGreaterThan(0);
    }
    expect(manifest.limitations).toContain(
      "This was credential-free mocked runtime execution, not live GitHub behavior.",
    );
    expect(manifest.permissionAssumption).toMatchObject({
      scope: "covered subset of this executed scenario only",
      appLevelReductionSupported: false,
    });
  });

  it("keeps checksum preflight and mocked networking fail-closed", async () => {
    const harness = await readFile(runtimeHarnessPath, "utf8");
    const preflight = harness.indexOf(
      "await assertPinnedCheckout(upstreamDirectory);",
    );
    const install = harness.indexOf(
      'await runMeasured("npm", ["ci", "--ignore-scripts"]',
    );
    const disableNetwork = harness.indexOf("nock.disableNetConnect();");
    const loadApp = harness.indexOf(
      'const app = require(join(upstreamDirectory, "app.js"));',
    );

    expect(preflight).toBeGreaterThanOrEqual(0);
    expect(preflight).toBeLessThan(install);
    expect(disableNetwork).toBeGreaterThanOrEqual(0);
    expect(disableNetwork).toBeLessThan(loadApp);
    expect(harness).not.toContain("nock.enableNetConnect");
  });

  it("keeps exact emitted route coverage aligned with the recorder artifact", async () => {
    const manifest = await loadJson<RuntimeManifest>("runtime-case-study.json");
    const emitted = await loadJson<{
      schemaVersion: 1;
      captureKind: string;
      upstreamCommit: string;
      scenario: string;
      liveGitHub: boolean;
      networkBoundary: string;
      requests: EmittedRequest[];
    }>(manifest.scenario.emittedRequests);
    const observations = await loadObservations(
      join(fixtureDirectory, manifest.scenario.observations),
    );

    expect(emitted).toMatchObject({
      schemaVersion: 1,
      captureKind: "credential-free-mocked-octokit-runtime",
      upstreamCommit: pinnedCommit,
      scenario: manifest.scenario.name,
      liveGitHub: false,
      networkBoundary: "nock.disableNetConnect()",
    });
    expect(emitted.requests).toHaveLength(manifest.scenario.requestCount);
    expect(observations).toHaveLength(manifest.scenario.requestCount);
    for (const request of emitted.requests) {
      expect(isSyntacticallySafeTemplate(request.routeTemplate)).toBe(true);
      expect(request.status).toBeGreaterThanOrEqual(100);
      expect(request.status).toBeLessThanOrEqual(599);
    }

    const routeGroups = groupRoutes(emitted.requests);
    expect(routeGroups.size).toBe(manifest.scenario.uniqueRouteCount);
    for (const coverage of manifest.routeCoverage) {
      const key = `${coverage.method} ${coverage.template}`;
      expect(routeGroups.get(key)).toEqual({
        calls: coverage.calls,
        statuses: coverage.statuses,
      });
      expect(
        githubPermissionCatalog.has({
          method: coverage.method,
          template: coverage.template,
        }),
      ).toBe(coverage.catalogSupport === "covered");
    }
    expect(
      manifest.routeCoverage.filter(
        (route) => route.catalogSupport === "covered",
      ),
    ).toHaveLength(manifest.scenario.catalogCoveredUniqueRouteCount);
    expect(
      manifest.routeCoverage.filter((route) => route.catalogSupport === "gap"),
    ).toHaveLength(manifest.scenario.catalogGapUniqueRouteCount);
    expect(manifest.evidencedCatalogGap.routes).toEqual(
      manifest.routeCoverage
        .filter((route) => route.catalogSupport === "gap")
        .map((route) => `${route.method} ${route.template}`),
    );

    expect(
      observations.map(({ method, routeTemplate, status }) => ({
        method,
        routeTemplate,
        status,
      })),
    ).toEqual([
      { method: "GET", routeTemplate: null, status: 404 },
      {
        method: "GET",
        routeTemplate: "/repos/{owner}/{repo}/contents/{path}",
        status: 200,
      },
      { method: "GET", routeTemplate: null, status: 200 },
      {
        method: "GET",
        routeTemplate: "/repos/{owner}/{repo}/contents/{path}",
        status: 200,
      },
      { method: "GET", routeTemplate: null, status: 200 },
      { method: "POST", routeTemplate: null, status: 201 },
      { method: "PUT", routeTemplate: null, status: 200 },
      { method: "PUT", routeTemplate: null, status: 200 },
      {
        method: "POST",
        routeTemplate: "/repos/{owner}/{repo}/pulls",
        status: 201,
      },
      {
        method: "POST",
        routeTemplate:
          "/repos/{owner}/{repo}/issues/{issue_number}/comments",
        status: 200,
      },
    ]);

    const retained = `${JSON.stringify(emitted)}\n${await readFile(
      join(fixtureDirectory, manifest.scenario.observations),
      "utf8",
    )}`;
    for (const concrete of [
      "/repos/all-contributors/",
      "/users/jakebolam",
      "/issues/1/comments",
      "githubToken",
    ]) {
      expect(retained).not.toContain(concrete);
    }
  });

  it("reports only the catalog-resolvable permission subset", async () => {
    const manifest = await loadJson<RuntimeManifest>("runtime-case-study.json");
    const observations = await loadObservations(
      join(fixtureDirectory, manifest.scenario.observations),
    );
    const contract = buildContract(observations, githubPermissionCatalog);

    expect(contract.selectedPermissions).toEqual(
      manifest.resolvableSubset.selectedPermissions,
    );
    expect(contract.permissionFrontier).toEqual(
      manifest.resolvableSubset.permissionFrontier,
    );
    expect(contract.routes).toHaveLength(3);
    expect(contract.routes.every((route) =>
      route.evidence.includes("pinned_catalog"),
    )).toBe(true);
    expect(contract.routes.every((route) =>
      !route.evidence.includes("runtime_header"),
    )).toBe(true);
    expect(
      observations.every(
        (observation) =>
          observation.requirements === null &&
          observation.evidenceSource === "none",
      ),
    ).toBe(true);
    expect(manifest.resolvableSubset.evidence).toBe(
      "pinned catalog only; mocked responses had no x-accepted-github-permissions header",
    );
    expect(contract.unknowns.map((unknown) => unknown.method)).toEqual(
      manifest.resolvableSubset.unknownMethods,
    );
    expect(manifest.resolvableSubset.complete).toBe(false);
    expect(manifest.declaredPermissions).toEqual({
      contents: "write",
      issues: "write",
      metadata: "read",
      pull_requests: "write",
    });
  });
});

function groupRoutes(requests: EmittedRequest[]) {
  const groups = new Map<string, { calls: number; statuses: number[] }>();
  for (const request of requests) {
    const key = `${request.method} ${request.routeTemplate}`;
    const group = groups.get(key) ?? { calls: 0, statuses: [] };
    group.calls += 1;
    group.statuses.push(request.status);
    groups.set(key, group);
  }
  return groups;
}

async function loadJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(join(fixtureDirectory, name), "utf8")) as T;
}

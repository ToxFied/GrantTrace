import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildContract } from "../../src/contract/build.js";
import { loadObservations } from "../../src/contract/observation-file.js";
import { githubPermissionCatalog } from "../../src/evidence/catalog.js";
import { isSyntacticallySafeTemplate } from "../../src/routes/canonical.js";

type CaseStudyRoute = {
  method: string;
  template: string;
  catalogSupport: "covered" | "gap";
  sourceCall: string;
  sourceUrl: string;
  documentation: string;
};

type CaseStudyManifest = {
  schemaVersion: 1;
  fixtureKind: "source-derived-replay";
  upstream: {
    repository: string;
    commit: string;
    license: string;
    files: Array<{ path: string; sha256: string }>;
  };
  declaredPermissions: Record<string, "read" | "write">;
  scenarios: Array<{
    name: string;
    fixture: string;
    routes: CaseStudyRoute[];
  }>;
};

const fixtureDirectory = join(
  process.cwd(),
  "case-studies",
  "all-contributors-app",
);

describe("All Contributors Bot external case study", () => {
  it("pins reviewable upstream provenance and catalog coverage", async () => {
    const manifest = await loadManifest();

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      fixtureKind: "source-derived-replay",
      upstream: {
        repository: "https://github.com/all-contributors/app",
        commit: "00f6362ffcc927a2d05fec27f42c3d09e4b03adb",
        license: "MIT",
      },
      declaredPermissions: {
        contents: "write",
        issues: "write",
        metadata: "read",
        pull_requests: "write",
      },
    });
    expect(new Set(manifest.upstream.files.map((file) => file.path)).size).toBe(
      manifest.upstream.files.length,
    );
    for (const file of manifest.upstream.files) {
      expect(file.path).not.toContain("..");
      expect(file.sha256).toMatch(/^[a-f0-9]{64}$/u);
    }

    const routes = manifest.scenarios.flatMap((scenario) => scenario.routes);
    for (const route of routes) {
      expect(route.sourceUrl).toContain(manifest.upstream.commit);
      expect(route.sourceCall.length).toBeGreaterThan(0);
      expect(route.documentation).toMatch(
        /^https:\/\/docs\.github\.com\/en\/rest\//u,
      );
      expect(route.documentation).toContain("apiVersion=2026-03-10#");
      expect(isSyntacticallySafeTemplate(route.template)).toBe(true);
      expect(
        githubPermissionCatalog.has({
          method: route.method,
          template: route.template,
        }),
        `${route.method} ${route.template}`,
      ).toBe(route.catalogSupport === "covered");
    }
    expect(
      routes.filter((route) => route.catalogSupport === "covered"),
    ).toHaveLength(4);
    expect(routes.filter((route) => route.catalogSupport === "gap")).toHaveLength(
      4,
    );
    expect(
      routes
        .filter((route) => route.catalogSupport === "gap")
        .map((route) => `${route.method} ${route.template}`)
        .sort(),
    ).toEqual([
      "GET /repos/{owner}/{repo}/git/ref/{ref}",
      "GET /users/{username}",
      "POST /repos/{owner}/{repo}/git/refs",
      "PUT /repos/{owner}/{repo}/contents/{path}",
    ]);
  });

  it("preserves the issue-or-pull-request frontier for the reply route", async () => {
    const observations = await loadObservations(
      join(fixtureDirectory, "reply-only.observations.ndjson"),
    );
    const contract = buildContract(observations, githubPermissionCatalog);

    expect(contract.unknowns).toEqual([]);
    expect(contract.selectedPermissions).toEqual({ issues: "write" });
    expect(contract.permissionFrontier).toEqual([
      { issues: "write" },
      { pull_requests: "write" },
    ]);
    expect(contract.routes).toHaveLength(1);
    expect(contract.routes[0]?.evidence).toEqual(["pinned_catalog"]);
  });

  it("does not add issues:write to the resolvable PR-path subset", async () => {
    const fixturePath = join(
      fixtureDirectory,
      "new-branch-pr.observations.ndjson",
    );
    const fixtureContent = await readFile(fixturePath, "utf8");
    expect(fixtureContent).not.toMatch(/\/repos\/all-contributors\//u);
    expect(fixtureContent).not.toMatch(/\/users\/[a-z0-9_-]+/iu);

    const observations = await loadObservations(fixturePath);
    const contract = buildContract(observations, githubPermissionCatalog);

    expect(contract.selectedPermissions).toEqual({
      contents: "read",
      pull_requests: "write",
    });
    expect(contract.permissionFrontier).toEqual([
      { contents: "read", pull_requests: "write" },
    ]);
    expect(contract.unknowns).toEqual([
      {
        scenario: "all-contributors-new-branch-pr",
        method: "GET",
        template: null,
        finding: "unresolved_route",
      },
      {
        scenario: "all-contributors-new-branch-pr",
        method: "POST",
        template: null,
        finding: "unresolved_route",
      },
      {
        scenario: "all-contributors-new-branch-pr",
        method: "PUT",
        template: null,
        finding: "unresolved_route",
      },
    ]);
    expect(contract.routes.map((route) => `${route.method} ${route.template}`))
      .toEqual([
        "GET /repos/{owner}/{repo}/contents/{path}",
        "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
        "POST /repos/{owner}/{repo}/pulls",
      ]);
  });
});

async function loadManifest(): Promise<CaseStudyManifest> {
  return JSON.parse(
    await readFile(join(fixtureDirectory, "case-study.json"), "utf8"),
  ) as CaseStudyManifest;
}

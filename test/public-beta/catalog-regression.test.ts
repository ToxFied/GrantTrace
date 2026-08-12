import { describe, expect, it } from "vitest";

import { buildContract } from "../../src/contract/build.js";
import type { Observation } from "../../src/contract/observation.js";
import {
  GITHUB_REST_CATALOG_ENTRIES,
  githubPermissionCatalog,
} from "../../src/evidence/catalog.js";

const metadataRoute = "/repos/{owner}/{repo}";
const commentRoute =
  "/repos/{owner}/{repo}/issues/{issue_number}/comments";

describe("public-beta GitHub REST catalog", () => {
  it("pins a reviewable 53-route identity to the selected API version", () => {
    expect(GITHUB_REST_CATALOG_ENTRIES).toHaveLength(53);
    expect(githubPermissionCatalog.identity).toEqual({
      source: "github-docs",
      version: "2026-03-10.20260812.1",
      checksum:
        "sha256:daaae7b3f52900e715e3236beacadb4d791af38943e8dacce73b979ab8592712",
    });

    const routeKeys = GITHUB_REST_CATALOG_ENTRIES.map(
      (entry) => `${entry.method} ${entry.template}`,
    );
    expect(new Set(routeKeys).size).toBe(routeKeys.length);
    expect(
      GITHUB_REST_CATALOG_ENTRIES.every(
        (entry) =>
          entry.documentation.startsWith("https://docs.github.com/en/rest/") &&
          entry.documentation.includes("apiVersion=2026-03-10#"),
      ),
    ).toBe(true);
  });

  it("covers the advertised repository workflow families", () => {
    const routeKeys = new Set(
      GITHUB_REST_CATALOG_ENTRIES.map(
        (entry) => `${entry.method} ${entry.template}`,
      ),
    );

    expect(routeKeys.size).toBe(53);
    for (const route of [
      "GET /repos/{owner}/{repo}",
      "POST /repos/{owner}/{repo}/issues",
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      "POST /repos/{owner}/{repo}/pulls",
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
      "GET /repos/{owner}/{repo}/contents/{path}",
      "PUT /repos/{owner}/{repo}/contents/{path}",
      "PUT /repos/{owner}/{repo}/contents/.github/workflows/{path}",
      "GET /repos/{owner}/{repo}/git/ref/{ref}",
      "GET /users/{username}",
      "POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches",
      "POST /repos/{owner}/{repo}/check-runs",
      "POST /repos/{owner}/{repo}/statuses/{sha}",
      "GET /repos/{owner}/{repo}/releases/latest",
    ]) {
      expect(routeKeys.has(route), route).toBe(true);
    }
  });

  it("models no-additional-permission and path-dependent workflow writes", () => {
    expect(
      githubPermissionCatalog.lookup({
        method: "GET",
        template: "/users/{username}",
      }),
    ).toEqual([[]]);
    expect(
      githubPermissionCatalog.lookup({
        method: "PUT",
        template: "/repos/{owner}/{repo}/contents/{path}",
      }),
    ).toEqual([[{ permission: "contents", level: "write" }]]);
    expect(
      githubPermissionCatalog.lookup({
        method: "PUT",
        template:
          "/repos/{owner}/{repo}/contents/.github/workflows/{path}",
      }),
    ).toEqual([[
      { permission: "contents", level: "write" },
      { permission: "workflows", level: "write" },
    ]]);

    const contract = buildContract(
      [
        observation({
          scenario: "public-profile",
          method: "GET",
          routeTemplate: "/users/{username}",
          requirements: [[]],
        }),
      ],
      githubPermissionCatalog,
    );
    expect(contract.selectedPermissions).toEqual({});
    expect(contract.permissionFrontier).toEqual([{}]);
  });

  it("preserves the documented issue-or-pull-request alternatives", () => {
    expect(
      githubPermissionCatalog.lookup({
        method: "GET",
        template: commentRoute,
      }),
    ).toEqual([
      [{ permission: "issues", level: "read" }],
      [{ permission: "pull_requests", level: "read" }],
    ]);
    expect(
      githubPermissionCatalog.lookup({
        method: "POST",
        template: commentRoute,
      }),
    ).toEqual([
      [{ permission: "issues", level: "write" }],
      [{ permission: "pull_requests", level: "write" }],
    ]);
  });

  it("keeps mandatory metadata out of the selected contract", () => {
    const contract = buildContract(
      [
        observation({
          scenario: "repository-read",
          method: "GET",
          routeTemplate: metadataRoute,
          requirements: [[{ permission: "metadata", level: "read" }]],
        }),
      ],
      githubPermissionCatalog,
    );

    expect(contract.selectedPermissions).toEqual({});
    expect(contract.permissionFrontier).toEqual([{}]);
    expect(contract.routes[0]?.alternatives).toEqual([
      [{ permission: "metadata", level: "read" }],
    ]);
  });

  it("fails closed for excluded global and identity-shaped routes", () => {
    for (const route of [
      { method: "GET", template: "/user" },
      { method: "GET", template: "/repos/example/private-repository" },
      {
        method: "GET",
        template: "/repos/{owner}/{repo}/route-not-in-the-reviewed-catalog",
      },
    ]) {
      expect(githubPermissionCatalog.has(route), JSON.stringify(route)).toBe(
        false,
      );
      expect(githubPermissionCatalog.lookup(route)).toBeNull();
    }
  });
});

function observation(
  input: Pick<
    Observation,
    "scenario" | "method" | "routeTemplate" | "requirements"
  >,
): Observation {
  return {
    schemaVersion: 1,
    ...input,
    status: 200,
    evidenceSource: "runtime_header",
    finding: null,
  };
}

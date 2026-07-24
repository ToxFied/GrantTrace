import { describe, expect, it } from "vitest";

import { diffContracts } from "../../src/contract/diff.js";
import type { GrantTraceContract } from "../../src/contract/schema.js";
import { fixtureCatalog } from "../../src/evidence/catalog.js";

describe("contract diff classification", () => {
  it("separates additions and read-to-write escalations", () => {
    const previous = contract({ contents: "read" });
    const next = contract({ contents: "write", issues: "read" });
    const diff = diffContracts(previous, next);

    expect(diff.additions).toEqual([
      { permission: "issues", from: null, to: "read" },
    ]);
    expect(diff.escalations).toEqual([
      { permission: "contents", from: "read", to: "write" },
    ]);
    expect(diff.hasBlockingChange).toBe(true);
  });

  it("separates no-longer-observed permissions and reductions", () => {
    const previous = contract({ contents: "write", issues: "read" });
    const next = contract({ contents: "read" });
    const diff = diffContracts(previous, next);

    expect(diff.removals).toEqual([
      { permission: "issues", from: "read", to: null },
    ]);
    expect(diff.reductions).toEqual([
      { permission: "contents", from: "write", to: "read" },
    ]);
    expect(diff.hasBlockingChange).toBe(true);
  });

  it("blocks a pure route/permission contraction for explicit review", () => {
    const previous = contract({ contents: "read", issues: "write" });
    previous.routes = [
      route("GET", "/repos/{owner}/{repo}/contents/{path}", "contents", "read"),
      route(
        "POST",
        "/repos/{owner}/{repo}/issues/{issue_number}/comments",
        "issues",
        "write",
      ),
    ];
    const next = contract({ issues: "write" });
    next.routes = [previous.routes[1]!];

    const diff = diffContracts(previous, next);
    expect(diff.removals).toEqual([
      { permission: "contents", from: "read", to: null },
    ]);
    expect(diff.warningOnly).toBe(false);
    expect(diff.hasBlockingChange).toBe(true);
  });

  it("shows scenario provenance changes even when the route union is unchanged", () => {
    const previous = contract({ issues: "read" });
    const next = structuredClone(previous);
    previous.scenarios = [{ name: "alpha" }, { name: "beta" }];
    next.scenarios = structuredClone(previous.scenarios);
    previous.routes[0]!.scenarios = ["alpha", "beta"];
    next.routes[0]!.scenarios = ["alpha", "beta"];
    previous.routes[0]!.evidence = ["runtime_header", "pinned_catalog"];
    next.routes[0]!.evidence = ["runtime_header", "pinned_catalog"];
    previous.routes[0]!.scenarioEvidence = {
      alpha: ["runtime_header", "pinned_catalog"],
      beta: ["pinned_catalog"],
    };
    next.routes[0]!.scenarioEvidence = {
      alpha: ["pinned_catalog"],
      beta: ["runtime_header", "pinned_catalog"],
    };

    expect(diffContracts(previous, next).scenarioEvidenceChanges).toEqual([
      {
        method: "GET",
        template: "/test/{issues}",
        scenario: "alpha",
        from: ["runtime_header", "pinned_catalog"],
        to: ["pinned_catalog"],
      },
      {
        method: "GET",
        template: "/test/{issues}",
        scenario: "beta",
        from: ["pinned_catalog"],
        to: ["runtime_header", "pinned_catalog"],
      },
    ]);
  });
});

function contract(
  selectedPermissions: GrantTraceContract["selectedPermissions"],
): GrantTraceContract {
  return {
    schemaVersion: 2,
    toolVersion: "0.1.0-beta.1",
    apiVersion: "2026-03-10",
    catalog: fixtureCatalog.identity,
    scenarios: [{ name: "triage-integration" }],
    routes: Object.entries(selectedPermissions).map(([permission, level]) =>
      route(
        "GET",
        `/test/{${permission}}`,
        permission,
        level,
      ),
    ),
    selectedPermissions,
    permissionFrontier: [selectedPermissions],
    manualKeeps: {},
    unknowns: [],
  };
}

function route(
  method: "GET" | "POST",
  template: string,
  permission: string,
  level: "read" | "write",
): GrantTraceContract["routes"][number] {
  return {
    method,
    template,
    alternatives: [[{ permission, level }]],
    evidence: ["runtime_header"],
    scenarioEvidence: {
      "triage-integration": ["runtime_header"],
    },
    scenarios: ["triage-integration"],
  };
}

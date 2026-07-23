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

  it("treats a pure route/permission contraction as warning-only", () => {
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
    expect(diff.warningOnly).toBe(true);
    expect(diff.hasBlockingChange).toBe(false);
  });
});

function contract(
  selectedPermissions: GrantTraceContract["selectedPermissions"],
): GrantTraceContract {
  return {
    schemaVersion: 1,
    toolVersion: "0.0.0-dev",
    apiVersion: "2026-03-10",
    catalog: fixtureCatalog.identity,
    scenarios: [{ name: "triage-integration" }],
    routes: [],
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
  };
}

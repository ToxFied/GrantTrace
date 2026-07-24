import { describe, expect, it } from "vitest";

import {
  assignmentDominates,
  solvePermissionContract,
  SolverLimitError,
} from "../../src/permissions/solver.js";
import { assignmentSatisfiesDNF } from "../../src/permissions/canonical.js";
import type { RouteRequirement } from "../../src/permissions/types.js";

describe("permission lattice and solver", () => {
  it("lets write satisfy read for the same permission only", () => {
    expect(
      assignmentSatisfiesDNF(
        { contents: "write" },
        [[{ permission: "contents", level: "read" }]],
      ),
    ).toBe(true);
    expect(
      assignmentSatisfiesDNF(
        { issues: "write" },
        [[{ permission: "contents", level: "read" }]],
      ),
    ).toBe(false);
  });

  it("selects a deterministic global contract across competing alternatives", () => {
    const result = solvePermissionContract([
      requirement("GET", "/a", [
        [{ permission: "issues", level: "read" }],
        [{ permission: "pull_requests", level: "read" }],
      ]),
      requirement("POST", "/b", [
        [{ permission: "issues", level: "write" }],
        [{ permission: "contents", level: "read" }],
      ]),
    ]);

    expect(result.selected).toEqual({
      contents: "read",
      issues: "read",
    });
    expect(result.frontier).toContainEqual({
      issues: "write",
    });
  });

  it("uses lexical order only after write count, weight, and width tie", () => {
    const result = solvePermissionContract([
      requirement("POST", "/route", [
        [{ permission: "pull_requests", level: "write" }],
        [{ permission: "issues", level: "write" }],
      ]),
    ]);

    expect(result.selected).toEqual({ issues: "write" });
  });

  it("prefers no writes before total access weight", () => {
    const result = solvePermissionContract([
      requirement("POST", "/route", [
        [{ permission: "mutation", level: "write" }],
        [
          { permission: "alpha", level: "read" },
          { permission: "beta", level: "read" },
          { permission: "gamma", level: "read" },
          { permission: "delta", level: "read" },
          { permission: "epsilon", level: "read" },
        ],
      ]),
    ]);

    expect(result.selected).not.toHaveProperty("mutation");
  });

  it("prunes candidates that are strictly more privileged", () => {
    expect(
      assignmentDominates(
        { contents: "read" },
        { contents: "write", issues: "read" },
      ),
    ).toBe(true);
  });

  it("fails clearly when the nondominated frontier exceeds the bound", () => {
    expect(() =>
      solvePermissionContract(
        [
          requirement("GET", "/route", [
            [{ permission: "alpha", level: "read" }],
            [{ permission: "beta", level: "read" }],
            [{ permission: "gamma", level: "read" }],
          ]),
        ],
        { maxFrontier: 2 },
      ),
    ).toThrow(SolverLimitError);
  });
});

function requirement(
  method: string,
  template: string,
  alternatives: RouteRequirement["alternatives"],
): RouteRequirement {
  return {
    route: { method, template },
    alternatives,
    evidence: ["runtime_header"],
    scenarioEvidence: { "solver-test": ["runtime_header"] },
    scenarios: ["solver-test"],
  };
}

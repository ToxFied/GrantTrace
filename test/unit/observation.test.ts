import { describe, expect, it } from "vitest";

import { ObservationSchema } from "../../src/contract/observation.js";

const base = {
  schemaVersion: 1,
  scenario: "triage-integration",
  method: "POST",
  routeTemplate:
    "/repos/{owner}/{repo}/issues/{issue_number}/comments",
  status: 201,
} as const;

describe("observation boundary validation", () => {
  it("accepts coherent classified and unresolved observations", () => {
    expect(
      ObservationSchema.safeParse({
        ...base,
        requirements: [[{ permission: "issues", level: "write" }]],
        evidenceSource: "runtime_header",
        finding: null,
      }).success,
    ).toBe(true);
    expect(
      ObservationSchema.safeParse({
        ...base,
        routeTemplate: null,
        requirements: null,
        evidenceSource: "none",
        finding: "unresolved_route",
      }).success,
    ).toBe(true);
  });

  it("rejects contradictory finding/evidence/route combinations", () => {
    expect(
      ObservationSchema.safeParse({
        ...base,
        requirements: [[{ permission: "issues", level: "write" }]],
        evidenceSource: "runtime_header",
        finding: "missing_evidence",
      }).success,
    ).toBe(false);
    expect(
      ObservationSchema.safeParse({
        ...base,
        requirements: null,
        evidenceSource: "none",
        finding: null,
      }).success,
    ).toBe(false);
    expect(
      ObservationSchema.safeParse({
        ...base,
        requirements: null,
        evidenceSource: "none",
        finding: "unresolved_route",
      }).success,
    ).toBe(false);
  });
});

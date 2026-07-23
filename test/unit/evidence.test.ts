import { describe, expect, it } from "vitest";

import { fixtureCatalog } from "../../src/evidence/catalog.js";
import { resolveEvidence } from "../../src/evidence/resolve.js";
import type { Observation } from "../../src/contract/observation.js";

const route =
  "/repos/{owner}/{repo}/issues/{issue_number}/comments";

describe("evidence resolution", () => {
  it("retains both source labels when runtime and catalog agree", () => {
    const result = resolveEvidence(
      [
        observation([
          [{ permission: "pull_requests", level: "write" }],
          [{ permission: "issues", level: "write" }],
        ]),
      ],
      fixtureCatalog,
    );

    expect(result.unknowns).toEqual([]);
    expect(result.requirements[0]?.evidence).toEqual([
      "runtime_header",
      "pinned_catalog",
    ]);
  });

  it("blocks a runtime/catalog contradiction", () => {
    const result = resolveEvidence(
      [observation([[{ permission: "issues", level: "write" }]])],
      fixtureCatalog,
    );

    expect(result.requirements).toEqual([]);
    expect(result.unknowns).toEqual([
      {
        scenario: "triage-integration",
        method: "POST",
        template: route,
        finding: "evidence_contradiction",
      },
    ]);
  });

  it("uses catalog evidence when the runtime header is missing", () => {
    const missing = observation(null);
    missing.evidenceSource = "none";
    missing.finding = "missing_evidence";

    const result = resolveEvidence([missing], fixtureCatalog);
    expect(result.unknowns).toEqual([]);
    expect(result.requirements[0]?.evidence).toEqual(["pinned_catalog"]);
  });

  it("does not retain an unrecognized route template", () => {
    const unsafe = observation([[{ permission: "issues", level: "write" }]]);
    unsafe.routeTemplate =
      "/repos/private-owner/private-repo/issues/{issue_number}/comments";

    const result = resolveEvidence([unsafe], fixtureCatalog);
    expect(result.unknowns[0]?.template).toBeNull();
    expect(JSON.stringify(result)).not.toContain("private-owner");
    expect(JSON.stringify(result)).not.toContain("private-repo");
  });
});

function observation(
  requirements: Observation["requirements"],
): Observation {
  return {
    schemaVersion: 1,
    scenario: "triage-integration",
    method: "POST",
    routeTemplate: route,
    status: 201,
    requirements,
    evidenceSource: "runtime_header",
    finding: null,
  };
}

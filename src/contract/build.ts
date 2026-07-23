import type { Observation } from "./observation.js";
import { compareAscii } from "../deterministic.js";
import type { PermissionCatalog } from "../evidence/catalog.js";
import { resolveEvidence } from "../evidence/resolve.js";
import { canonicalizeAssignment } from "../permissions/canonical.js";
import { solvePermissionContract } from "../permissions/solver.js";
import { GITHUB_API_VERSION, TOOL_VERSION } from "../version.js";
import type { GrantTraceContract } from "./schema.js";

export function buildContract(
  observations: Observation[],
  catalog: PermissionCatalog,
): GrantTraceContract {
  const resolution = resolveEvidence(observations, catalog);
  const solution = solvePermissionContract(resolution.requirements);

  return {
    schemaVersion: 1,
    toolVersion: TOOL_VERSION,
    apiVersion: GITHUB_API_VERSION,
    catalog: {
      source: catalog.identity.source,
      version: catalog.identity.version,
      checksum: catalog.identity.checksum,
    },
    scenarios: [...new Set(observations.map((observation) => observation.scenario))]
      .sort(compareAscii)
      .map((name) => ({ name })),
    routes: resolution.requirements.map((requirement) => ({
      method: requirement.route.method as
        | "DELETE"
        | "GET"
        | "HEAD"
        | "PATCH"
        | "POST"
        | "PUT",
      template: requirement.route.template,
      alternatives: requirement.alternatives,
      evidence: requirement.evidence,
    })),
    selectedPermissions: canonicalizeAssignment(solution.selected),
    permissionFrontier: solution.frontier.map(canonicalizeAssignment),
    manualKeeps: {},
    unknowns: resolution.unknowns.map((unknown) => ({
      scenario: unknown.scenario,
      method: unknown.method as
        | "DELETE"
        | "GET"
        | "HEAD"
        | "PATCH"
        | "POST"
        | "PUT"
        | "UNKNOWN",
      template: unknown.template,
      finding: unknown.finding,
    })),
  };
}

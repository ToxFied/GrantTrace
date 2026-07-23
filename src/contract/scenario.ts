import { canonicalizeAssignment } from "../permissions/canonical.js";
import { solvePermissionContract } from "../permissions/solver.js";
import { MANDATORY_INSTALLATION_PERMISSIONS } from "../proof/permission-baseline.js";
import type { GrantTraceContract } from "./schema.js";

export function contractForScenario(
  contract: GrantTraceContract,
  scenario: string,
): GrantTraceContract {
  const routes = contract.routes
    .filter((route) => route.scenarios.includes(scenario))
    .map((route) => ({
      ...route,
      scenarios: [scenario],
    }));
  const solution = solvePermissionContract(
    routes.map((route) => ({
      route: { method: route.method, template: route.template },
      alternatives: route.alternatives,
      evidence: route.evidence,
      scenarios: route.scenarios,
    })),
    { baseline: MANDATORY_INSTALLATION_PERMISSIONS },
  );

  return {
    ...contract,
    scenarios: [{ name: scenario }],
    routes,
    selectedPermissions: canonicalizeAssignment(solution.selected),
    permissionFrontier: solution.frontier.map(canonicalizeAssignment),
    unknowns: contract.unknowns.filter(
      (unknown) => unknown.scenario === scenario,
    ),
  };
}

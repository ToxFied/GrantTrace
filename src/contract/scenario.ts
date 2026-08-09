import { canonicalizeAssignment } from "../permissions/canonical.js";
import { solvePermissionContract } from "../permissions/solver.js";
import { MANDATORY_INSTALLATION_PERMISSIONS } from "../proof/permission-baseline.js";
import { findCoveredFrontierAssignment } from "./frontier.js";
import type { GrantTraceContract } from "./schema.js";

export function contractForScenario(
  contract: GrantTraceContract,
  scenario: string,
): GrantTraceContract {
  const routes = contract.routes
    .filter((route) => route.scenarios.includes(scenario))
    .map((route) => ({
      ...route,
      evidence: route.scenarioEvidence[scenario] ?? route.evidence,
      scenarioEvidence: {
        [scenario]: route.scenarioEvidence[scenario] ?? route.evidence,
      },
      scenarios: [scenario],
    }));
  const solution = solvePermissionContract(
    routes.map((route) => ({
      route: { method: route.method, template: route.template },
      alternatives: route.alternatives,
      evidence: route.evidence,
      scenarioEvidence: route.scenarioEvidence,
      scenarios: route.scenarios,
    })),
    { baseline: MANDATORY_INSTALLATION_PERMISSIONS },
  );
  const selected =
    findCoveredFrontierAssignment(
      solution.frontier,
      contract.selectedPermissions,
    ) ?? solution.selected;

  return {
    ...contract,
    scenarios: [{ name: scenario }],
    routes,
    selectedPermissions: canonicalizeAssignment(selected),
    permissionFrontier: solution.frontier.map(canonicalizeAssignment),
    unknowns: contract.unknowns.filter(
      (unknown) => unknown.scenario === scenario,
    ),
  };
}

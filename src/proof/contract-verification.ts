import { buildContract } from "../contract/build.js";
import { preserveFrontierSelection } from "../contract/frontier.js";
import type { Observation } from "../contract/observation.js";
import type { GrantTraceContract } from "../contract/schema.js";
import { serializeContract } from "../contract/serialize.js";
import { contractForScenario } from "../contract/scenario.js";
import { githubPermissionCatalog } from "../evidence/catalog.js";
import { canonicalDNFKey } from "../permissions/canonical.js";
import { GITHUB_API_VERSION, TOOL_VERSION } from "../version.js";

export class ProofContractMismatchError extends Error {
  public constructor() {
    super(
      "The live observations did not reproduce the accepted contract exactly.",
    );
    this.name = "ProofContractMismatchError";
  }
}

export function validateAcceptedProofContract(
  contract: GrantTraceContract,
  scenario: string,
): void {
  const routesMatchCatalog = contract.routes.every((route) => {
    const catalogAlternatives = githubPermissionCatalog.lookup({
      method: route.method,
      template: route.template,
    });
    return (
      catalogAlternatives !== null &&
      canonicalDNFKey(route.alternatives) ===
        canonicalDNFKey(catalogAlternatives) &&
      Object.values(route.scenarioEvidence).every((evidence) =>
        evidence.includes("pinned_catalog"),
      )
    );
  });
  if (
    contract.unknowns.length > 0 ||
    !contract.scenarios.some((candidate) => candidate.name === scenario) ||
    contract.apiVersion !== GITHUB_API_VERSION ||
    contract.toolVersion !== TOOL_VERSION ||
    contract.catalog.source !== githubPermissionCatalog.identity.source ||
    contract.catalog.version !== githubPermissionCatalog.identity.version ||
    contract.catalog.checksum !== githubPermissionCatalog.identity.checksum ||
    !routesMatchCatalog
  ) {
    throw new ProofContractMismatchError();
  }
}

export function verifyProofObservations(
  contract: GrantTraceContract,
  scenario: string,
  observations: Observation[],
): GrantTraceContract {
  validateAcceptedProofContract(contract, scenario);
  const expected = contractForScenario(contract, scenario);
  const observed = buildContract(observations, githubPermissionCatalog);
  const observedWithSelection = preserveFrontierSelection(
    observed,
    expected.selectedPermissions,
  );
  const observedWithManualKeeps = {
    ...observedWithSelection,
    manualKeeps: expected.manualKeeps,
  };
  if (
    observed.unknowns.length > 0 ||
    serializeContract(observedWithManualKeeps) !== serializeContract(expected)
  ) {
    throw new ProofContractMismatchError();
  }
  return observedWithManualKeeps;
}

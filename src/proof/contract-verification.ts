import { buildContract } from "../contract/build.js";
import type { Observation } from "../contract/observation.js";
import type { GrantTraceContract } from "../contract/schema.js";
import { serializeContract } from "../contract/serialize.js";
import { contractForScenario } from "../contract/scenario.js";
import { fixtureCatalog } from "../evidence/catalog.js";
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
  if (
    contract.unknowns.length > 0 ||
    !contract.scenarios.some((candidate) => candidate.name === scenario) ||
    contract.apiVersion !== GITHUB_API_VERSION ||
    contract.toolVersion !== TOOL_VERSION ||
    contract.catalog.source !== fixtureCatalog.identity.source ||
    contract.catalog.version !== fixtureCatalog.identity.version ||
    contract.catalog.checksum !== fixtureCatalog.identity.checksum
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
  const observed = buildContract(observations, fixtureCatalog);
  const observedWithManualKeeps = {
    ...observed,
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

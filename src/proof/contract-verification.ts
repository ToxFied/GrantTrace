import { buildContract } from "../contract/build.js";
import type { Observation } from "../contract/observation.js";
import type { GrantTraceContract } from "../contract/schema.js";
import { serializeContract } from "../contract/serialize.js";
import { fixtureCatalog } from "../evidence/catalog.js";

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
    contract.scenarios.length !== 1 ||
    contract.scenarios[0]?.name !== scenario ||
    Object.keys(contract.manualKeeps).length > 0
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
  const observed = buildContract(observations, fixtureCatalog);
  if (
    observed.unknowns.length > 0 ||
    serializeContract(observed) !== serializeContract(contract)
  ) {
    throw new ProofContractMismatchError();
  }
  return observed;
}

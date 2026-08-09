import { createHash, randomBytes } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  assignmentKey,
  canonicalizeAssignment,
  canonicalizeDNF,
} from "../permissions/canonical.js";
import { compareAscii } from "../deterministic.js";
import { solvePermissionContract } from "../permissions/solver.js";
import { MANDATORY_INSTALLATION_PERMISSIONS } from "../proof/permission-baseline.js";
import {
  GrantTraceContractSchema,
  GrantTraceContractLegacyV2Schema,
  GrantTraceContractV2Schema,
  GrantTraceContractV1Schema,
  type GrantTraceContract,
} from "./schema.js";
import {
  BoundedFileError,
  readBoundedRegularFile,
} from "../security/bounded-file.js";
import { findManualKeepConflicts } from "./manual-keeps.js";

const MAX_CONTRACT_BYTES = 5 * 1024 * 1024;

export class ContractFileError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ContractFileError";
  }
}

export function serializeContract(contract: GrantTraceContract): string {
  return `${JSON.stringify(canonicalizeContract(contract), null, 2)}\n`;
}

export function contractHash(contract: GrantTraceContract): `sha256:${string}` {
  const hash = createHash("sha256")
    .update(serializeContract(contract), "utf8")
    .digest("hex");
  return `sha256:${hash}`;
}

export async function readContract(path: string): Promise<GrantTraceContract> {
  return (await readContractWithMetadata(path)).contract;
}

export type ReadContractResult = {
  contract: GrantTraceContract;
  migrations: ContractMigration[];
};

export const ContractMigration = {
  schemaV1ToV3: "schema_v1_to_v3",
  schemaV2ToV3: "schema_v2_to_v3",
  legacySchemaV2ToV3: "legacy_schema_v2_to_v3",
} as const;

export type ContractMigration =
  (typeof ContractMigration)[keyof typeof ContractMigration];

export async function readContractWithMetadata(
  path: string,
): Promise<ReadContractResult> {
  let content: string;
  try {
    content = (await readBoundedRegularFile(path, MAX_CONTRACT_BYTES)).toString(
      "utf8",
    );
  } catch (error) {
    if (error instanceof BoundedFileError && error.code === "too_large") {
      throw new ContractFileError("Contract file exceeds the size limit.");
    }
    throw new ContractFileError(
      isMissingFile(error)
        ? "Contract file does not exist."
        : "Contract file could not be read.",
    );
  }

  try {
    const raw: unknown = JSON.parse(content);
    const current = GrantTraceContractSchema.safeParse(raw);
    if (current.success) {
      return {
        contract: canonicalizeContract(current.data),
        migrations: [],
      };
    }
    const schemaV2 = GrantTraceContractV2Schema.safeParse(raw);
    if (schemaV2.success) {
      const contract = canonicalizeContract({
        ...schemaV2.data,
        schemaVersion: 3,
      });
      validateDeterministicDefaultSelection(contract);
      return {
        contract,
        migrations: [ContractMigration.schemaV2ToV3],
      };
    }
    const legacyV2 = GrantTraceContractLegacyV2Schema.safeParse(raw);
    if (legacyV2.success) {
      const contract = canonicalizeContract({
        ...legacyV2.data,
        schemaVersion: 3,
        routes: legacyV2.data.routes.map((route) => ({
          ...route,
          scenarioEvidence: Object.fromEntries(
            route.scenarios.map((scenario) => [scenario, route.evidence]),
          ),
        })),
      });
      validateDeterministicDefaultSelection(contract);
      return {
        contract,
        migrations: [ContractMigration.legacySchemaV2ToV3],
      };
    }
    const legacy = GrantTraceContractV1Schema.parse(raw);
    const scenarios = legacy.scenarios.map((scenario) => scenario.name);
    const contract = canonicalizeContract({
      ...legacy,
      schemaVersion: 3,
      routes: legacy.routes.map((route) => ({
        ...route,
        scenarioEvidence: Object.fromEntries(
          scenarios.map((scenario) => [scenario, route.evidence]),
        ),
        scenarios,
      })),
    });
    validateDeterministicDefaultSelection(contract);
    return {
      contract,
      migrations: [ContractMigration.schemaV1ToV3],
    };
  } catch {
    throw new ContractFileError("Contract file is invalid.");
  }
}

export async function writeContractAtomic(
  path: string,
  contract: GrantTraceContract,
): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;

  try {
    await writeFile(temporaryPath, serializeContract(contract), {
      encoding: "utf8",
      mode: 0o644,
      flag: "wx",
    });
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function canonicalizeContract(contract: GrantTraceContract): GrantTraceContract {
  const parsed = GrantTraceContractSchema.parse(contract);
  const canonical: GrantTraceContract = {
    schemaVersion: 3,
    toolVersion: parsed.toolVersion,
    apiVersion: parsed.apiVersion,
    catalog: {
      source: parsed.catalog.source,
      version: parsed.catalog.version,
      checksum: parsed.catalog.checksum,
    },
    scenarios: [...parsed.scenarios].sort((left, right) =>
      compareAscii(left.name, right.name),
    ),
    routes: [...parsed.routes]
      .map((route) => ({
        method: route.method,
        template: route.template,
        alternatives: canonicalizeDNF(route.alternatives),
        evidence: [...new Set(route.evidence)].sort(compareEvidence),
        scenarioEvidence: Object.fromEntries(
          Object.entries(route.scenarioEvidence)
            .sort(([left], [right]) => compareAscii(left, right))
            .map(([scenario, evidence]) => [
              scenario,
              [...new Set(evidence)].sort(compareEvidence),
            ]),
        ),
        scenarios: [...new Set(route.scenarios)].sort(compareAscii),
      }))
      .sort((left, right) =>
        compareAscii(
          `${left.method} ${left.template}`,
          `${right.method} ${right.template}`,
        ),
      ),
    selectedPermissions: canonicalizeAssignment(parsed.selectedPermissions),
    permissionFrontier: [...parsed.permissionFrontier]
      .map(canonicalizeAssignment)
      .sort((left, right) =>
        compareAscii(JSON.stringify(left), JSON.stringify(right)),
      ),
    manualKeeps: Object.fromEntries(
      Object.entries(parsed.manualKeeps)
        .sort(([left], [right]) => compareAscii(left, right))
        .map(([permission, keep]) => [
          permission,
          { level: keep.level, reason: keep.reason.trim() },
        ]),
    ),
    unknowns: [...parsed.unknowns].sort((left, right) =>
      compareAscii(
        [
          left.scenario,
          left.method,
          left.template ?? "",
          left.finding,
        ].join("\u0000"),
        [
          right.scenario,
          right.method,
          right.template ?? "",
          right.finding,
        ].join("\u0000"),
      ),
      ),
  };
  validateContractSemantics(canonical);
  return canonical;
}

function validateDeterministicDefaultSelection(
  contract: GrantTraceContract,
): void {
  const solution = solvePermissionContract(
    contract.routes.map((route) => ({
      route: { method: route.method, template: route.template },
      alternatives: route.alternatives,
      evidence: route.evidence,
      scenarioEvidence: route.scenarioEvidence,
      scenarios: route.scenarios,
    })),
    { baseline: MANDATORY_INSTALLATION_PERMISSIONS },
  );
  if (
    assignmentKey(contract.selectedPermissions) !==
    assignmentKey(solution.selected)
  ) {
    throw new ContractFileError(
      "Legacy contracts must use the deterministic default permission selection.",
    );
  }
}

function validateContractSemantics(contract: GrantTraceContract): void {
  const scenarioNames = contract.scenarios.map((scenario) => scenario.name);
  const declaredScenarios = new Set(scenarioNames);
  if (declaredScenarios.size !== scenarioNames.length) {
    throw new ContractFileError("Contract scenarios must be unique.");
  }

  const routeKeys = contract.routes.map(
    (route) => `${route.method} ${route.template}`,
  );
  if (new Set(routeKeys).size !== routeKeys.length) {
    throw new ContractFileError("Contract routes must be unique.");
  }

  const attributedScenarios = new Set<string>();
  for (const route of contract.routes) {
    const scenarioEvidenceNames = Object.keys(route.scenarioEvidence);
    if (
      scenarioEvidenceNames.length !== route.scenarios.length ||
      route.scenarios.some(
        (scenario) => route.scenarioEvidence[scenario] === undefined,
      ) ||
      scenarioEvidenceNames.some(
        (scenario) => !route.scenarios.includes(scenario),
      )
    ) {
      throw new ContractFileError(
        "Route evidence attribution must exactly match route scenarios.",
      );
    }
    const evidenceUnion = [
      ...new Set(Object.values(route.scenarioEvidence).flat()),
    ].sort(compareEvidence);
    if (JSON.stringify(evidenceUnion) !== JSON.stringify(route.evidence)) {
      throw new ContractFileError(
        "Route evidence must equal its scenario evidence union.",
      );
    }
    for (const scenario of route.scenarios) {
      if (!declaredScenarios.has(scenario)) {
        throw new ContractFileError(
          "Route attribution references an undeclared scenario.",
        );
      }
      attributedScenarios.add(scenario);
    }
  }
  for (const unknown of contract.unknowns) {
    if (!declaredScenarios.has(unknown.scenario)) {
      throw new ContractFileError(
        "Unknown evidence references an undeclared scenario.",
      );
    }
    attributedScenarios.add(unknown.scenario);
  }
  if (
    attributedScenarios.size !== declaredScenarios.size ||
    [...declaredScenarios].some(
      (scenario) => !attributedScenarios.has(scenario),
    )
  ) {
    throw new ContractFileError(
      "Every declared scenario needs route or unknown-evidence attribution.",
    );
  }

  const solution = solvePermissionContract(
    contract.routes.map((route) => ({
      route: { method: route.method, template: route.template },
      alternatives: route.alternatives,
      evidence: route.evidence,
      scenarioEvidence: route.scenarioEvidence,
      scenarios: route.scenarios,
    })),
    { baseline: MANDATORY_INSTALLATION_PERMISSIONS },
  );
  const solvedFrontierKeys = solution.frontier
    .map(assignmentKey)
    .sort(compareAscii);
  const storedFrontierKeys = contract.permissionFrontier
    .map(assignmentKey)
    .sort(compareAscii);
  if (solvedFrontierKeys.join("\n") !== storedFrontierKeys.join("\n")) {
    throw new ContractFileError(
      "Permission frontier does not exactly match the attributed routes.",
    );
  }
  if (!solvedFrontierKeys.includes(assignmentKey(contract.selectedPermissions))) {
    throw new ContractFileError(
      "Selected permissions must exactly match one permission frontier assignment.",
    );
  }

  for (const conflict of findManualKeepConflicts(
    contract,
    contract.selectedPermissions,
    MANDATORY_INSTALLATION_PERMISSIONS,
  )) {
    if (conflict.kind === "mandatory_baseline") {
      throw new ContractFileError(
        "A manual keep duplicates the mandatory GitHub baseline.",
      );
    }
    throw new ContractFileError(
      "A manual keep duplicates observed selected access.",
    );
  }
}

function compareEvidence(left: string, right: string): number {
  const rank: Readonly<Record<string, number>> = {
    runtime_header: 0,
    pinned_catalog: 1,
  };
  return (rank[left] ?? 99) - (rank[right] ?? 99);
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

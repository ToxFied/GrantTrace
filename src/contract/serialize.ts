import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  assignmentKey,
  canonicalizeAssignment,
  canonicalizeDNF,
  comparePermissionLevels,
} from "../permissions/canonical.js";
import { compareAscii } from "../deterministic.js";
import { solvePermissionContract } from "../permissions/solver.js";
import { MANDATORY_INSTALLATION_PERMISSIONS } from "../proof/permission-baseline.js";
import {
  GrantTraceContractSchema,
  GrantTraceContractV1Schema,
  type GrantTraceContract,
} from "./schema.js";

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
  migratedFromV1: boolean;
};

export async function readContractWithMetadata(
  path: string,
): Promise<ReadContractResult> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    throw new ContractFileError(
      isMissingFile(error)
        ? "Contract file does not exist."
        : "Contract file could not be read.",
    );
  }

  if (Buffer.byteLength(content, "utf8") > MAX_CONTRACT_BYTES) {
    throw new ContractFileError("Contract file exceeds the size limit.");
  }

  try {
    const raw: unknown = JSON.parse(content);
    const current = GrantTraceContractSchema.safeParse(raw);
    if (current.success) {
      return {
        contract: canonicalizeContract(current.data),
        migratedFromV1: false,
      };
    }
    const legacy = GrantTraceContractV1Schema.parse(raw);
    const scenarios = legacy.scenarios.map((scenario) => scenario.name);
    return {
      contract: canonicalizeContract({
        ...legacy,
        schemaVersion: 2,
        routes: legacy.routes.map((route) => ({
          ...route,
          scenarios,
        })),
      }),
      migratedFromV1: true,
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
    schemaVersion: 2,
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
      scenarios: route.scenarios,
    })),
    { baseline: MANDATORY_INSTALLATION_PERMISSIONS },
  );
  if (
    assignmentKey(solution.selected) !==
      assignmentKey(contract.selectedPermissions) ||
    solution.frontier.map(assignmentKey).sort(compareAscii).join("\n") !==
      contract.permissionFrontier
        .map(assignmentKey)
        .sort(compareAscii)
        .join("\n")
  ) {
    throw new ContractFileError(
      "Selected permissions do not exactly match the attributed routes.",
    );
  }

  for (const [permission, keep] of Object.entries(contract.manualKeeps)) {
    const mandatory = MANDATORY_INSTALLATION_PERMISSIONS[permission];
    if (
      mandatory !== undefined &&
      comparePermissionLevels(mandatory, keep.level) >= 0
    ) {
      throw new ContractFileError(
        "A manual keep duplicates the mandatory GitHub baseline.",
      );
    }
    const selected = contract.selectedPermissions[permission];
    if (
      selected !== undefined &&
      comparePermissionLevels(selected, keep.level) >= 0
    ) {
      throw new ContractFileError(
        "A manual keep duplicates observed selected access.",
      );
    }
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

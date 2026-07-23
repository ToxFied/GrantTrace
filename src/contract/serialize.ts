import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  canonicalizeAssignment,
  canonicalizeDNF,
} from "../permissions/canonical.js";
import { compareAscii } from "../deterministic.js";
import {
  GrantTraceContractSchema,
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
    return canonicalizeContract(GrantTraceContractSchema.parse(JSON.parse(content)));
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
  const temporaryPath = `${path}.tmp-${process.pid}`;

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
  return {
    schemaVersion: 1,
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
      Object.entries(parsed.manualKeeps).sort(([left], [right]) =>
        compareAscii(left, right),
      ),
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

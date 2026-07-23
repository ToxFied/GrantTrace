import type { PermissionLevel } from "../permissions/types.js";
import { compareAscii } from "../deterministic.js";
import type { GrantTraceContract } from "./schema.js";
import { serializeContract } from "./serialize.js";

export type PermissionChange = {
  permission: string;
  from: PermissionLevel | null;
  to: PermissionLevel | null;
};

export type ContractDiff = {
  additions: PermissionChange[];
  escalations: PermissionChange[];
  removals: PermissionChange[];
  reductions: PermissionChange[];
  semanticChange: boolean;
  warningOnly: boolean;
  hasBlockingChange: boolean;
};

export function diffContracts(
  previous: GrantTraceContract,
  next: GrantTraceContract,
): ContractDiff {
  const additions: PermissionChange[] = [];
  const escalations: PermissionChange[] = [];
  const removals: PermissionChange[] = [];
  const reductions: PermissionChange[] = [];
  const permissions = new Set([
    ...Object.keys(previous.selectedPermissions),
    ...Object.keys(next.selectedPermissions),
  ]);

  for (const permission of [...permissions].sort(compareAscii)) {
    const from = previous.selectedPermissions[permission] ?? null;
    const to = next.selectedPermissions[permission] ?? null;
    if (from === to) {
      continue;
    }
    const change = { permission, from, to };
    if (from === null) {
      additions.push(change);
    } else if (to === null) {
      removals.push(change);
    } else if (from === "read" && to === "write") {
      escalations.push(change);
    } else {
      reductions.push(change);
    }
  }

  const semanticChange = serializeContract(previous) !== serializeContract(next);
  const warningOnly =
    semanticChange &&
    isRemovalOnlyContraction(
      previous,
      next,
      additions,
      escalations,
      removals,
      reductions,
    );
  return {
    additions,
    escalations,
    removals,
    reductions,
    semanticChange,
    warningOnly,
    hasBlockingChange: semanticChange && !warningOnly,
  };
}

function isRemovalOnlyContraction(
  previous: GrantTraceContract,
  next: GrantTraceContract,
  additions: PermissionChange[],
  escalations: PermissionChange[],
  removals: PermissionChange[],
  reductions: PermissionChange[],
): boolean {
  if (
    additions.length > 0 ||
    escalations.length > 0 ||
    reductions.length > 0 ||
    removals.length === 0 ||
    previous.schemaVersion !== next.schemaVersion ||
    previous.toolVersion !== next.toolVersion ||
    previous.apiVersion !== next.apiVersion ||
    JSON.stringify(previous.catalog) !== JSON.stringify(next.catalog) ||
    JSON.stringify(previous.manualKeeps) !== JSON.stringify(next.manualKeeps) ||
    previous.unknowns.length > 0 ||
    next.unknowns.length > 0
  ) {
    return false;
  }

  const previousScenarios = new Set(
    previous.scenarios.map((scenario) => scenario.name),
  );
  if (
    next.scenarios.some(
      (scenario) => !previousScenarios.has(scenario.name),
    )
  ) {
    return false;
  }

  const previousRoutes = new Set(
    previous.routes.map((route) => JSON.stringify(route)),
  );
  return next.routes.every((route) =>
    previousRoutes.has(JSON.stringify(route)),
  );
}

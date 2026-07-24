import type { PermissionLevel } from "../permissions/types.js";
import { compareAscii } from "../deterministic.js";
import type { GrantTraceContract } from "./schema.js";

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
  scenarioAdditions: string[];
  scenarioRemovals: string[];
  routeAdditions: RouteChange[];
  routeRemovals: RouteChange[];
  attributionAdditions: AttributionChange[];
  attributionRemovals: AttributionChange[];
  scenarioEvidenceChanges: ScenarioEvidenceChange[];
  routeRequirementChanges: RouteRequirementChange[];
  manualKeepAdditions: ManualKeepChange[];
  manualKeepRemovals: ManualKeepChange[];
  manualKeepChanges: ManualKeepUpdate[];
  toolVersionChanged: boolean;
  apiVersionChanged: boolean;
  catalogChanged: boolean;
  semanticChange: boolean;
  warningOnly: boolean;
  hasBlockingChange: boolean;
};

export type RouteChange = {
  method: string;
  template: string;
};

export type AttributionChange = RouteChange & {
  scenario: string;
};

export type RouteRequirementChange = RouteChange & {
  alternativesChanged: boolean;
  evidenceChanged: boolean;
};

export type ScenarioEvidenceChange = RouteChange & {
  scenario: string;
  from: string[];
  to: string[];
};

export type ManualKeepChange = {
  permission: string;
  level: PermissionLevel;
  reason: string;
};

export type ManualKeepUpdate = {
  permission: string;
  from: { level: PermissionLevel; reason: string };
  to: { level: PermissionLevel; reason: string };
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

  const semanticChange = JSON.stringify(previous) !== JSON.stringify(next);
  const scenarioChanges = diffStrings(
    previous.scenarios.map((scenario) => scenario.name),
    next.scenarios.map((scenario) => scenario.name),
  );
  const previousRoutes = new Map(
    previous.routes.map((route) => [routeKey(route), route]),
  );
  const nextRoutes = new Map(next.routes.map((route) => [routeKey(route), route]));
  const routeAdditions: RouteChange[] = [];
  const routeRemovals: RouteChange[] = [];
  const attributionAdditions: AttributionChange[] = [];
  const attributionRemovals: AttributionChange[] = [];
  const scenarioEvidenceChanges: ScenarioEvidenceChange[] = [];
  const routeRequirementChanges: RouteRequirementChange[] = [];
  for (const key of [...new Set([...previousRoutes.keys(), ...nextRoutes.keys()])]
    .sort(compareAscii)) {
    const before = previousRoutes.get(key);
    const after = nextRoutes.get(key);
    if (before === undefined && after !== undefined) {
      routeAdditions.push({ method: after.method, template: after.template });
      continue;
    }
    if (before !== undefined && after === undefined) {
      routeRemovals.push({ method: before.method, template: before.template });
      continue;
    }
    if (before === undefined || after === undefined) {
      continue;
    }
    const attribution = diffStrings(before.scenarios, after.scenarios);
    attribution.additions.forEach((scenario) => {
      attributionAdditions.push({
        method: after.method,
        template: after.template,
        scenario,
      });
    });
    attribution.removals.forEach((scenario) => {
      attributionRemovals.push({
        method: before.method,
        template: before.template,
        scenario,
      });
    });
    for (const scenario of [
      ...new Set([
        ...Object.keys(before.scenarioEvidence),
        ...Object.keys(after.scenarioEvidence),
      ]),
    ].sort(compareAscii)) {
      const from = before.scenarioEvidence[scenario] ?? [];
      const to = after.scenarioEvidence[scenario] ?? [];
      if (JSON.stringify(from) !== JSON.stringify(to)) {
        scenarioEvidenceChanges.push({
          method: after.method,
          template: after.template,
          scenario,
          from,
          to,
        });
      }
    }
    const alternativesChanged =
      JSON.stringify(before.alternatives) !== JSON.stringify(after.alternatives);
    const evidenceChanged =
      JSON.stringify(before.evidence) !== JSON.stringify(after.evidence);
    if (alternativesChanged || evidenceChanged) {
      routeRequirementChanges.push({
        method: after.method,
        template: after.template,
        alternativesChanged,
        evidenceChanged,
      });
    }
  }

  const manualKeepAdditions: ManualKeepChange[] = [];
  const manualKeepRemovals: ManualKeepChange[] = [];
  const manualKeepChanges: ManualKeepUpdate[] = [];
  for (const permission of [
    ...new Set([
      ...Object.keys(previous.manualKeeps),
      ...Object.keys(next.manualKeeps),
    ]),
  ].sort(compareAscii)) {
    const before = previous.manualKeeps[permission];
    const after = next.manualKeeps[permission];
    if (before === undefined && after !== undefined) {
      manualKeepAdditions.push({ permission, ...after });
    } else if (before !== undefined && after === undefined) {
      manualKeepRemovals.push({ permission, ...before });
    } else if (
      before !== undefined &&
      after !== undefined &&
      (before.level !== after.level || before.reason !== after.reason)
    ) {
      manualKeepChanges.push({ permission, from: before, to: after });
    }
  }

  return {
    additions,
    escalations,
    removals,
    reductions,
    scenarioAdditions: scenarioChanges.additions,
    scenarioRemovals: scenarioChanges.removals,
    routeAdditions,
    routeRemovals,
    attributionAdditions,
    attributionRemovals,
    scenarioEvidenceChanges,
    routeRequirementChanges,
    manualKeepAdditions,
    manualKeepRemovals,
    manualKeepChanges,
    toolVersionChanged: previous.toolVersion !== next.toolVersion,
    apiVersionChanged: previous.apiVersion !== next.apiVersion,
    catalogChanged:
      JSON.stringify(previous.catalog) !== JSON.stringify(next.catalog),
    semanticChange,
    warningOnly: false,
    hasBlockingChange: semanticChange,
  };
}

function diffStrings(
  previous: readonly string[],
  next: readonly string[],
): { additions: string[]; removals: string[] } {
  const before = new Set(previous);
  const after = new Set(next);
  return {
    additions: [...after].filter((value) => !before.has(value)).sort(compareAscii),
    removals: [...before].filter((value) => !after.has(value)).sort(compareAscii),
  };
}

function routeKey(route: { method: string; template: string }): string {
  return `${route.method} ${route.template}`;
}

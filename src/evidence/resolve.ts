import { canonicalDNFKey, canonicalizeDNF } from "../permissions/canonical.js";
import { compareAscii } from "../deterministic.js";
import type {
  EvidenceSource,
  RouteRequirement,
} from "../permissions/types.js";
import type { Observation, ObservationFinding } from "../contract/observation.js";
import type { PermissionCatalog } from "./catalog.js";

export type ContractUnknown = {
  scenario: string;
  method: string;
  template: string | null;
  finding: ObservationFinding;
};

export type EvidenceResolution = {
  requirements: RouteRequirement[];
  unknowns: ContractUnknown[];
};

export function resolveEvidence(
  observations: Observation[],
  catalog: PermissionCatalog,
): EvidenceResolution {
  const groups = new Map<string, Observation[]>();
  const unknowns: ContractUnknown[] = [];

  for (const observation of observations) {
    if (observation.routeTemplate === null) {
      unknowns.push({
        scenario: observation.scenario,
        method: observation.method,
        template: null,
        finding: observation.finding ?? "unresolved_route",
      });
      continue;
    }

    const route = {
      method: observation.method,
      template: observation.routeTemplate,
    };
    if (!catalog.has(route)) {
      unknowns.push({
        scenario: observation.scenario,
        method: observation.method,
        template: null,
        finding: "unresolved_route",
      });
      continue;
    }

    const key = routeKey(route);
    const group = groups.get(key) ?? [];
    group.push(observation);
    groups.set(key, group);
  }

  const requirements: RouteRequirement[] = [];
  for (const [key, group] of [...groups.entries()].sort(([left], [right]) =>
    compareAscii(left, right),
  )) {
    const first = group[0];
    if (first === undefined || first.routeTemplate === null) {
      continue;
    }

    const route = {
      method: first.method,
      template: first.routeTemplate,
    };
    const catalogEvidence = catalog.lookup(route);
    const successful: Array<{
      scenario: string;
      alternatives: NonNullable<Observation["requirements"]>;
      evidence: EvidenceSource[];
    }> = [];
    const byScenario = new Map<string, Observation[]>();
    for (const observation of group) {
      const scenarioGroup = byScenario.get(observation.scenario) ?? [];
      scenarioGroup.push(observation);
      byScenario.set(observation.scenario, scenarioGroup);
    }
    for (const [scenario, scenarioGroup] of [...byScenario.entries()].sort(
      ([left], [right]) => compareAscii(left, right),
    )) {
      const resolved = resolveScenarioRoute(
        scenarioGroup,
        route,
        catalogEvidence,
      );
      if ("unknown" in resolved) {
        unknowns.push({ scenario, ...resolved.unknown });
      } else {
        successful.push({ scenario, ...resolved });
      }
    }

    if (successful.length > 0) {
      const alternativeKeys = new Set(
        successful.map((item) => canonicalDNFKey(item.alternatives)),
      );
      if (alternativeKeys.size !== 1) {
        for (const item of successful) {
          unknowns.push({
            scenario: item.scenario,
            method: route.method,
            template: route.template,
            finding: "evidence_contradiction",
          });
        }
      } else {
        const scenarioEvidence = Object.fromEntries(
          successful.map((item) => [item.scenario, item.evidence]),
        );
        requirements.push({
          route,
          alternatives: canonicalizeDNF(successful[0]!.alternatives),
          evidence: (["runtime_header", "pinned_catalog"] as const).filter(
            (source) =>
              successful.some((item) => item.evidence.includes(source)),
          ),
          scenarioEvidence,
          scenarios: successful.map((item) => item.scenario),
        });
      }
    }

    void key;
  }

  return {
    requirements,
    unknowns: deduplicateUnknowns(unknowns),
  };
}

function resolveScenarioRoute(
  group: Observation[],
  route: { method: string; template: string },
  catalogEvidence: ReturnType<PermissionCatalog["lookup"]>,
):
  | {
      alternatives: NonNullable<Observation["requirements"]>;
      evidence: EvidenceSource[];
    }
  | {
      unknown: Omit<ContractUnknown, "scenario">;
    } {
  const blocking = group.find(
    (observation) =>
      observation.finding === "malformed_header" ||
      observation.finding === "evidence_contradiction" ||
      observation.finding === "unsupported_api" ||
      observation.finding === "unresolved_route",
  );
  if (blocking !== undefined) {
    return {
      unknown: {
        method: blocking.method,
        template: route.template,
        finding: blocking.finding ?? "unresolved_route",
      },
    };
  }

  const runtimeEvidence = uniqueEvidence(
    group.flatMap((observation) =>
      observation.evidenceSource === "runtime_header" &&
      observation.requirements !== null
        ? [observation.requirements]
        : [],
    ),
  );
  const embeddedCatalogEvidence = uniqueEvidence(
    group.flatMap((observation) =>
      observation.evidenceSource === "pinned_catalog" &&
      observation.requirements !== null
        ? [observation.requirements]
        : [],
    ),
  );
  if (runtimeEvidence.length > 1 || embeddedCatalogEvidence.length > 1) {
    return {
      unknown: {
        method: route.method,
        template: route.template,
        finding: "evidence_contradiction",
      },
    };
  }

  const runtime = runtimeEvidence[0] ?? null;
  const embeddedCatalog = embeddedCatalogEvidence[0] ?? null;
  if (
    (embeddedCatalog !== null &&
      catalogEvidence !== null &&
      canonicalDNFKey(embeddedCatalog) !== canonicalDNFKey(catalogEvidence)) ||
    (runtime !== null &&
      catalogEvidence !== null &&
      canonicalDNFKey(runtime) !== canonicalDNFKey(catalogEvidence))
  ) {
    return {
      unknown: {
        method: route.method,
        template: route.template,
        finding: "evidence_contradiction",
      },
    };
  }

  const alternatives = runtime ?? embeddedCatalog ?? catalogEvidence;
  if (alternatives === null) {
    return {
      unknown: {
        method: route.method,
        template: route.template,
        finding: "missing_evidence",
      },
    };
  }

  const evidence: EvidenceSource[] = [];
  if (runtime !== null) {
    evidence.push("runtime_header");
  }
  if (catalogEvidence !== null || embeddedCatalog !== null) {
    evidence.push("pinned_catalog");
  }
  return { alternatives, evidence };
}

function uniqueEvidence(
  evidence: NonNullable<Observation["requirements"]>[],
) {
  const byKey = new Map(
    evidence.map((dnf) => [canonicalDNFKey(dnf), canonicalizeDNF(dnf)]),
  );
  return [...byKey.entries()]
    .sort(([left], [right]) => compareAscii(left, right))
    .map(([, dnf]) => dnf);
}

function deduplicateUnknowns(unknowns: ContractUnknown[]): ContractUnknown[] {
  const byKey = new Map<string, ContractUnknown>();
  for (const unknown of unknowns) {
    byKey.set(
      [
        unknown.scenario,
        unknown.method,
        unknown.template ?? "",
        unknown.finding,
      ].join("\u0000"),
      unknown,
    );
  }

  return [...byKey.entries()]
    .sort(([left], [right]) => compareAscii(left, right))
    .map(([, unknown]) => unknown);
}

function routeKey(route: { method: string; template: string }): string {
  return `${route.method} ${route.template}`;
}

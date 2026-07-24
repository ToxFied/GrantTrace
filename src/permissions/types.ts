export type PermissionLevel = "read" | "write";

export type PermissionTerm = {
  permission: string;
  level: PermissionLevel;
};

// Every term in a conjunction is required.
export type PermissionConjunction = PermissionTerm[];

// Any conjunction in the list may satisfy the route.
export type PermissionDNF = PermissionConjunction[];

export type CanonicalRoute = {
  method: string;
  template: string;
};

export type EvidenceSource = "runtime_header" | "pinned_catalog";

export type RouteRequirement = {
  route: CanonicalRoute;
  alternatives: PermissionDNF;
  evidence: EvidenceSource[];
  scenarioEvidence: Record<string, EvidenceSource[]>;
  scenarios: string[];
};

export type PermissionAssignment = Record<string, PermissionLevel>;

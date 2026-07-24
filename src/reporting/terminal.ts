import type { GrantTraceContract } from "../contract/schema.js";
import type { ContractDiff } from "../contract/diff.js";

const COVERAGE =
  "This contract describes only GitHub REST operations observed in the selected scenarios.";

export function renderAnalysisReport(
  contract: GrantTraceContract,
  observationCount: number,
): string {
  const lines = [
    "GrantTrace",
    "",
    `Scenario${contract.scenarios.length === 1 ? "" : "s"}: ${contract.scenarios
      .map((scenario) => scenario.name)
      .join(", ")}`,
    `Observed: ${observationCount} GitHub REST operation${observationCount === 1 ? "" : "s"}`,
    "",
  ];

  if (contract.unknowns.length > 0) {
    lines.push("Analysis blocked", "");
    for (const unknown of contract.unknowns) {
      lines.push(
        `  ${unknown.scenario}  ${findingLabel(unknown.finding)}  ${unknown.method}${
          unknown.template === null ? "" : ` ${unknown.template}`
        }`,
      );
    }
  } else {
    lines.push("Selected permission contract");
    const permissions = Object.entries(contract.selectedPermissions);
    if (permissions.length === 0) {
      lines.push("  (none)");
    } else {
      for (const [permission, level] of permissions) {
        lines.push(`  ${permission}: ${level}`);
      }
    }
  }

  lines.push("", "Coverage", `  ${COVERAGE}`, "");
  return lines.join("\n");
}

export function renderCheckSuccess(contract: GrantTraceContract): string {
  const lines = [
    "GrantTrace check passed",
    "",
    `Scenarios  ${
      contract.scenarios.length === 0
        ? "(none)"
        : contract.scenarios.map((scenario) => scenario.name).join(", ")
    }`,
    `Routes     ${contract.routes.length}`,
    `Observed permissions  ${Object.keys(contract.selectedPermissions).length}`,
    "",
  ];
  appendSelectedPermissions(lines, contract);
  appendManualKeeps(lines, contract);
  appendMandatoryBaseline(lines);
  appendCoverage(lines, contract);
  return lines.join("\n");
}

export function renderAccepted(
  contract: GrantTraceContract,
  options: { removedKeeps?: string[] } = {},
): string {
  const lines = [
    "GrantTrace contract accepted",
    "",
    "Selected permission contract",
    ...(Object.entries(contract.selectedPermissions).length === 0
      ? ["  (none)"]
      : Object.entries(contract.selectedPermissions).map(
          ([permission, level]) => `  ${permission}: ${level}`,
        )),
    "",
  ];
  if ((options.removedKeeps?.length ?? 0) > 0) {
    lines.push("Manual keeps removed because access is now observed");
    for (const permission of options.removedKeeps ?? []) {
      lines.push(`  ${permission}`);
    }
    lines.push("");
  }
  appendManualKeeps(lines, contract);
  appendMandatoryBaseline(lines);
  lines.push(
    "Next",
    "  Review and commit granttrace.lock.json.",
    "",
  );
  appendCoverage(lines, contract);
  return lines.join("\n");
}

export function renderContractDiff(
  diff: ContractDiff,
  next: GrantTraceContract,
  options: {
    migratedFromLegacyV2?: boolean;
    migratedFromV1?: boolean;
    nextAction?: "prompt" | "noninteractive" | "standalone";
  } = {},
): string {
  const lines = ["GrantTrace contract review required", ""];

  if (options.migratedFromV1 === true) {
    lines.push(
      "Schema migration required",
      "  v1 -> v2 adds exact route-to-scenario attribution.",
      "",
    );
  }
  if (options.migratedFromLegacyV2 === true) {
    lines.push(
      "Schema v2 provenance upgrade required",
      "  Route evidence is now attributed to each scenario, not only merged globally.",
      "",
    );
  }
  if (diff.toolVersionChanged) {
    lines.push("Tool contract version changed", "");
  }
  if (diff.apiVersionChanged) {
    lines.push("Pinned GitHub REST API version changed", "");
  }
  if (diff.catalogChanged) {
    lines.push(
      "Pinned permission catalog changed",
      `  ${next.catalog.source} ${next.catalog.version}`,
      `  ${next.catalog.checksum}`,
      "",
    );
  }
  for (const change of diff.additions) {
    lines.push("New permission", `  ${change.permission}: ${change.to}`, "");
    appendRoutes(lines, next, change.permission);
  }
  for (const change of diff.escalations) {
    lines.push(
      "Permission escalation",
      `  ${change.permission}: ${change.from} -> ${change.to}`,
      "",
    );
    appendRoutes(lines, next, change.permission);
  }
  for (const change of diff.removals) {
    lines.push(
      "No longer observed",
      `  ${change.permission}: ${change.from}`,
      "",
    );
  }
  for (const change of diff.reductions) {
    lines.push(
      "Observed access reduced",
      `  ${change.permission}: ${change.from} -> ${change.to}`,
      "",
    );
  }
  appendNamedChanges(lines, "Scenario added", diff.scenarioAdditions);
  appendNamedChanges(lines, "Scenario removed", diff.scenarioRemovals);
  appendRouteChanges(lines, "Route added", diff.routeAdditions);
  appendRouteChanges(lines, "Route removed", diff.routeRemovals);
  for (const change of diff.attributionAdditions) {
    lines.push(
      "Scenario attribution added",
      `  ${change.scenario}`,
      `  ${change.method} ${change.template}`,
      "",
    );
  }
  for (const change of diff.attributionRemovals) {
    lines.push(
      "Scenario attribution removed",
      `  ${change.scenario}`,
      `  ${change.method} ${change.template}`,
      "",
    );
  }
  for (const change of diff.scenarioEvidenceChanges) {
    lines.push(
      "Scenario evidence provenance changed",
      `  ${change.scenario}`,
      `  ${change.method} ${change.template}`,
      `  ${evidenceList(change.from)} -> ${evidenceList(change.to)}`,
      "",
    );
  }
  for (const change of diff.routeRequirementChanges) {
    const changed = [
      change.alternativesChanged ? "permission alternatives" : null,
      change.evidenceChanged ? "evidence provenance" : null,
    ].filter((value) => value !== null);
    lines.push(
      "Route evidence changed",
      `  ${change.method} ${change.template}`,
      `  ${changed.join(", ")}`,
      "",
    );
  }
  for (const change of diff.manualKeepAdditions) {
    lines.push(
      "Manual keep added (not proven necessary)",
      `  ${change.permission}: ${change.level}`,
      `  Reason: ${change.reason}`,
      "",
    );
  }
  for (const change of diff.manualKeepRemovals) {
    lines.push(
      "Manual keep removed",
      `  ${change.permission}: ${change.level}`,
      "",
    );
  }
  for (const change of diff.manualKeepChanges) {
    lines.push(
      "Manual keep changed (not proven necessary)",
      `  ${change.permission}: ${change.from.level} -> ${change.to.level}`,
      `  Reason: ${change.from.reason} -> ${change.to.reason}`,
      "",
    );
  }
  if (
    diff.additions.length === 0 &&
    diff.escalations.length === 0 &&
    diff.removals.length === 0 &&
    diff.reductions.length === 0 &&
    diff.scenarioAdditions.length === 0 &&
    diff.scenarioRemovals.length === 0 &&
    diff.routeAdditions.length === 0 &&
    diff.routeRemovals.length === 0 &&
    diff.attributionAdditions.length === 0 &&
    diff.attributionRemovals.length === 0 &&
    diff.scenarioEvidenceChanges.length === 0 &&
    diff.routeRequirementChanges.length === 0 &&
    diff.manualKeepAdditions.length === 0 &&
    diff.manualKeepRemovals.length === 0 &&
    diff.manualKeepChanges.length === 0 &&
    !diff.toolVersionChanged &&
    !diff.apiVersionChanged &&
    !diff.catalogChanged
  ) {
    lines.push("Contract evidence changed", "");
  }

  if (options.nextAction === "prompt") {
    lines.push(
      "Decision",
      "  Review the exact change above.",
      "  Accept only if the permission and coverage change is intentional.",
      "",
    );
  } else if (options.nextAction === "noninteractive") {
    lines.push(
      "Not accepted",
      "  This terminal is noninteractive.",
      "  Review locally, then run granttrace check --accept.",
      "",
    );
  } else {
    lines.push(
      "Next",
      "  Review the evidence, then run:",
      "  granttrace check --accept",
      "",
    );
  }
  appendManualKeeps(lines, next);
  appendMandatoryBaseline(lines);
  appendCoverage(lines, next);
  return lines.join("\n");
}

export function renderInstrumentationError(): string {
  return [
    "GrantTrace record failed",
    "",
    "No supported GitHub REST operation was observed.",
    "",
    "Next",
    "  Confirm the scenario makes a GitHub REST request through standard Node fetch.",
    "  For a custom fetch or transport, use granttrace/octokit explicitly.",
    "",
  ].join("\n");
}

function appendRoutes(
  lines: string[],
  contract: GrantTraceContract,
  permission: string,
): void {
  const routes = contract.routes.filter((route) =>
    route.alternatives.some((conjunction) =>
      conjunction.some((term) => term.permission === permission),
    ),
  );
  if (routes.length === 0) {
    return;
  }

  lines.push("Observed in");
  for (const route of routes) {
    lines.push(`  Route     ${route.method} ${route.template}`);
    lines.push(`  Scenarios ${route.scenarios.join(", ")}`);
    lines.push(`  Evidence  ${evidenceList(route.evidence)}`);
  }
  lines.push("");
}

function appendSelectedPermissions(
  lines: string[],
  contract: GrantTraceContract,
): void {
  lines.push("Observed permission contract");
  const permissions = Object.entries(contract.selectedPermissions);
  if (permissions.length === 0) {
    lines.push("  (none)");
  } else {
    for (const [permission, level] of permissions) {
      lines.push(`  ${permission}: ${level}`);
    }
  }
  lines.push("");
}

function appendNamedChanges(
  lines: string[],
  heading: string,
  values: string[],
): void {
  for (const value of values) {
    lines.push(heading, `  ${value}`, "");
  }
}

function appendRouteChanges(
  lines: string[],
  heading: string,
  routes: Array<{ method: string; template: string }>,
): void {
  for (const route of routes) {
    lines.push(heading, `  ${route.method} ${route.template}`, "");
  }
}

function appendManualKeeps(
  lines: string[],
  contract: GrantTraceContract,
): void {
  const keeps = Object.entries(contract.manualKeeps);
  if (keeps.length === 0) {
    return;
  }

  lines.push("Manual keeps");
  for (const [permission, keep] of keeps) {
    lines.push(`  ${permission}: ${keep.level} — ${keep.reason}`);
  }
  lines.push("");
}

function appendMandatoryBaseline(lines: string[]): void {
  lines.push(
    "Mandatory GitHub baseline (not selected or manually kept)",
    "  metadata: read",
    "",
  );
}

function appendCoverage(
  lines: string[],
  contract: GrantTraceContract,
): void {
  lines.push("Coverage");
  if (contract.scenarios.length === 0) {
    lines.push(
      "  No recorded scenario coverage remains. This contract makes no operation-specific claim.",
    );
  } else {
    lines.push(`  ${COVERAGE}`);
  }
  lines.push("");
}

function evidenceList(evidence: string[]): string {
  return evidence.length === 0
    ? "(none)"
    : evidence.map(evidenceLabel).join(", ");
}

function evidenceLabel(evidence: string): string {
  switch (evidence) {
    case "runtime_header":
      return "Runtime response header";
    case "pinned_catalog":
      return "Pinned permission catalog";
    default:
      return evidence;
  }
}

function findingLabel(finding: string): string {
  switch (finding) {
    case "unresolved_route":
      return "Unrecognized REST route";
    case "missing_evidence":
      return "Missing permission evidence";
    case "malformed_header":
      return "Malformed permission header";
    case "evidence_contradiction":
      return "Evidence conflict";
    case "unsupported_api":
      return "Unsupported API";
    default:
      return finding;
  }
}

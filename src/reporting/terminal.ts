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
        `  ${unknown.finding}  ${unknown.method}${
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
    `Scenarios  ${contract.scenarios.map((scenario) => scenario.name).join(", ")}`,
    `Routes     ${contract.routes.length}`,
    "",
  ];
  appendManualKeeps(lines, contract);
  lines.push("Coverage", `  ${COVERAGE}`, "");
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
    ...Object.entries(contract.selectedPermissions).map(
      ([permission, level]) => `  ${permission}: ${level}`,
    ),
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
  lines.push("Coverage", `  ${COVERAGE}`, "");
  return lines.join("\n");
}

export function renderContractDiff(
  diff: ContractDiff,
  next: GrantTraceContract,
  options: { migratedFromV1?: boolean } = {},
): string {
  const lines = ["GrantTrace check failed", ""];

  if (options.migratedFromV1 === true) {
    lines.push(
      "Schema migration required",
      "  v1 -> v2 adds exact route-to-scenario attribution.",
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

  lines.push(
    "Next",
    "  Review the evidence, then run:",
    "  granttrace check --accept",
    "",
  );
  appendManualKeeps(lines, next);
  lines.push("Coverage", `  ${COVERAGE}`, "");
  return lines.join("\n");
}

export function renderInstrumentationError(): string {
  return [
    "GrantTrace record failed",
    "",
    "No instrumented GitHub REST operation was observed.",
    "",
    "Next",
    "  Load granttrace/octokit in the child process and make the scenario use that Octokit instance.",
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
    lines.push(`  Evidence  ${route.evidence.join(", ")}`);
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

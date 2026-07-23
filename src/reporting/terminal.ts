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

export function renderAccepted(contract: GrantTraceContract): string {
  const lines = [
    "GrantTrace contract accepted",
    "",
    "Selected permission contract",
    ...Object.entries(contract.selectedPermissions).map(
      ([permission, level]) => `  ${permission}: ${level}`,
    ),
    "",
  ];
  appendManualKeeps(lines, contract);
  lines.push("Coverage", `  ${COVERAGE}`, "");
  return lines.join("\n");
}

export function renderContractDiff(
  diff: ContractDiff,
  next: GrantTraceContract,
): string {
  const lines = ["GrantTrace check failed", ""];

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
  if (
    diff.additions.length === 0 &&
    diff.escalations.length === 0 &&
    diff.removals.length === 0 &&
    diff.reductions.length === 0
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

export function renderContractWarnings(
  diff: ContractDiff,
  next: GrantTraceContract,
): string {
  const lines = ["GrantTrace check passed with warnings", ""];
  for (const change of diff.removals) {
    lines.push(
      "Previously observed permission is no longer observed",
      `  ${change.permission}: ${change.from}`,
      "",
    );
  }
  lines.push(
    "This is not evidence that the permission is safe to remove in production.",
    "",
    "Optional",
    "  Review the coverage change, then update the lock with:",
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

import type { ContractDiff, PermissionChange } from "../contract/diff.js";
import type { GrantTraceContract } from "../contract/schema.js";
import type { ExitCodeValue } from "../cli/exit-codes.js";
import { githubPermissionCatalog } from "../evidence/catalog.js";
import { MANDATORY_INSTALLATION_PERMISSIONS } from "../proof/permission-baseline.js";
import type { ContractMigration } from "../contract/serialize.js";

export type CheckStatus =
  | "accepted"
  | "acceptance_refused"
  | "analysis_failed"
  | "evidence_blocked"
  | "no_observations"
  | "passed"
  | "review_required";

export type CheckReason =
  | "ci_accept_forbidden"
  | "invalid_artifact"
  | "operation_locked"
  | "operation_lock_cleanup_failed"
  | "summary_unavailable"
  | null;

export type CheckReportInput = {
  status: CheckStatus;
  exitCode: ExitCodeValue;
  reason?: CheckReason;
  contract?: GrantTraceContract;
  diff?: ContractDiff;
  migrations?: ContractMigration[];
};

type SafePermissionChange = {
  permission: string;
  from: "read" | "write" | null;
  to: "read" | "write" | null;
};

type SafeRouteChange = {
  method: string;
  template: string | null;
};

export type CheckReport = {
  schemaVersion: 1;
  status: CheckStatus;
  exitCode: ExitCodeValue;
  reason: CheckReason;
  summary: {
    scenarios: number;
    routes: number;
    observedPermissions: number;
    manualKeeps: number;
    findings: number;
  } | null;
  observedPermissions: Array<{
    permission: string;
    level: "read" | "write";
  }>;
  manualKeeps: Array<{
    permission: string;
    level: "read" | "write";
  }>;
  mandatoryPermissions: Array<{
    permission: string;
    level: "read" | "write";
  }>;
  changes: {
    permissionAdditions: SafePermissionChange[];
    permissionEscalations: SafePermissionChange[];
    permissionRemovals: SafePermissionChange[];
    permissionReductions: SafePermissionChange[];
    scenarioAdditions: number;
    scenarioRemovals: number;
    routeAdditions: SafeRouteChange[];
    routeRemovals: SafeRouteChange[];
    attributionAdditions: number;
    attributionRemovals: number;
    scenarioEvidenceChanges: number;
    routeRequirementChanges: Array<
      SafeRouteChange & {
        alternativesChanged: boolean;
        evidenceChanged: boolean;
      }
    >;
    manualKeepAdditions: Array<{
      permission: string;
      level: "read" | "write";
    }>;
    manualKeepRemovals: Array<{
      permission: string;
      level: "read" | "write";
    }>;
    manualKeepChanges: Array<{
      permission: string;
      from: "read" | "write";
      to: "read" | "write";
    }>;
    toolVersionChanged: boolean;
    apiVersionChanged: boolean;
    catalogChanged: boolean;
    contractEvidenceChanged: boolean;
  } | null;
  findings: Array<{
    finding:
      | "unresolved_route"
      | "missing_evidence"
      | "malformed_header"
      | "evidence_contradiction"
      | "unsupported_api";
    method: string;
    template: string | null;
  }>;
  migrations: ContractMigration[];
};

export function createCheckReport(input: CheckReportInput): CheckReport {
  const contract = input.contract;
  const diff = input.diff;
  return {
    schemaVersion: 1,
    status: input.status,
    exitCode: input.exitCode,
    reason: input.reason ?? null,
    summary:
      contract === undefined
        ? null
        : {
            scenarios: contract.scenarios.length,
            routes: contract.routes.length,
            observedPermissions: Object.keys(contract.selectedPermissions).length,
            manualKeeps: Object.keys(contract.manualKeeps).length,
            findings: contract.unknowns.length,
          },
    observedPermissions:
      contract === undefined
        ? []
        : Object.entries(contract.selectedPermissions).map(
            ([permission, level]) => ({ permission, level }),
          ),
    manualKeeps:
      contract === undefined
        ? []
        : Object.entries(contract.manualKeeps).map(([permission, keep]) => ({
            permission,
            level: keep.level,
          })),
    mandatoryPermissions:
      contract === undefined
        ? []
        : Object.entries(MANDATORY_INSTALLATION_PERMISSIONS).map(
            ([permission, level]) => ({ permission, level }),
          ),
    changes:
      diff === undefined
        ? null
        : {
            permissionAdditions: safePermissionChanges(diff.additions),
            permissionEscalations: safePermissionChanges(diff.escalations),
            permissionRemovals: safePermissionChanges(diff.removals),
            permissionReductions: safePermissionChanges(diff.reductions),
            scenarioAdditions: diff.scenarioAdditions.length,
            scenarioRemovals: diff.scenarioRemovals.length,
            routeAdditions: diff.routeAdditions.map(safeRouteChange),
            routeRemovals: diff.routeRemovals.map(safeRouteChange),
            attributionAdditions: diff.attributionAdditions.length,
            attributionRemovals: diff.attributionRemovals.length,
            scenarioEvidenceChanges: diff.scenarioEvidenceChanges.length,
            routeRequirementChanges: diff.routeRequirementChanges.map(
              (change) => ({
                ...safeRouteChange(change),
                alternativesChanged: change.alternativesChanged,
                evidenceChanged: change.evidenceChanged,
              }),
            ),
            manualKeepAdditions: diff.manualKeepAdditions.map((change) => ({
              permission: change.permission,
              level: change.level,
            })),
            manualKeepRemovals: diff.manualKeepRemovals.map((change) => ({
              permission: change.permission,
              level: change.level,
            })),
            manualKeepChanges: diff.manualKeepChanges.map((change) => ({
              permission: change.permission,
              from: change.from.level,
              to: change.to.level,
            })),
            toolVersionChanged: diff.toolVersionChanged,
            apiVersionChanged: diff.apiVersionChanged,
            catalogChanged: diff.catalogChanged,
            contractEvidenceChanged:
              diff.semanticChange && !hasNamedDiffChange(diff),
          },
    findings:
      contract?.unknowns.map((unknown) => ({
        finding: unknown.finding,
        method: unknown.method,
        template: safeRouteTemplate(unknown.method, unknown.template),
      })) ?? [],
    migrations: [...(input.migrations ?? [])],
  };
}

export function serializeCheckReport(input: CheckReportInput): string {
  return `${JSON.stringify(createCheckReport(input), null, 2)}\n`;
}

export function renderCheckMarkdown(input: CheckReportInput): string {
  const report = createCheckReport(input);
  const lines = [
    "## GrantTrace contract check",
    "",
    `**Status:** ${statusLabel(report.status)}`,
    `**Exit code:** ${report.exitCode}`,
  ];
  if (report.reason !== null) {
    lines.push(`**Reason:** ${reasonLabel(report.reason)}`);
  }

  if (report.summary !== null) {
    lines.push(
      "",
      "| Coverage | Count |",
      "| --- | ---: |",
      `| Scenarios | ${report.summary.scenarios} |`,
      `| Routes | ${report.summary.routes} |`,
      `| Observed permissions | ${report.summary.observedPermissions} |`,
      `| Manual keeps | ${report.summary.manualKeeps} |`,
      `| Blocked findings | ${report.summary.findings} |`,
    );
  }

  appendPermissionTable(lines, "Observed permissions", report.observedPermissions);
  appendPermissionChanges(lines, report);
  appendCoverageChanges(lines, report);
  appendRouteChanges(lines, report);
  appendManualKeepChanges(lines, report);
  appendMetadataChanges(lines, report);
  appendFindings(lines, report);

  if (report.migrations.length > 0) {
    lines.push("", "### Contract migrations", "");
    for (const migration of report.migrations) {
      lines.push(`- ${migrationLabel(migration)}`);
    }
  }

  if (report.manualKeeps.length > 0) {
    appendPermissionTable(lines, "Manual keeps", report.manualKeeps);
  }
  appendPermissionTable(
    lines,
    "Mandatory GitHub baseline",
    report.mandatoryPermissions,
  );

  lines.push(
    "",
    "> This report contains only validated permission names, safe route templates, and aggregate counts. It excludes raw URLs, identities, commands, credentials, and error details.",
    "",
  );
  return lines.join("\n");
}

function safePermissionChanges(
  changes: PermissionChange[],
): SafePermissionChange[] {
  return changes.map((change) => ({
    permission: change.permission,
    from: change.from,
    to: change.to,
  }));
}

function safeRouteChange(change: {
  method: string;
  template: string;
}): SafeRouteChange {
  return {
    method: change.method,
    template: safeRouteTemplate(change.method, change.template),
  };
}

function safeRouteTemplate(
  method: string,
  template: string | null,
): string | null {
  return template !== null && githubPermissionCatalog.has({ method, template })
    ? template
    : null;
}

function hasNamedDiffChange(diff: ContractDiff): boolean {
  return (
    diff.additions.length > 0 ||
    diff.escalations.length > 0 ||
    diff.removals.length > 0 ||
    diff.reductions.length > 0 ||
    diff.scenarioAdditions.length > 0 ||
    diff.scenarioRemovals.length > 0 ||
    diff.routeAdditions.length > 0 ||
    diff.routeRemovals.length > 0 ||
    diff.attributionAdditions.length > 0 ||
    diff.attributionRemovals.length > 0 ||
    diff.scenarioEvidenceChanges.length > 0 ||
    diff.routeRequirementChanges.length > 0 ||
    diff.manualKeepAdditions.length > 0 ||
    diff.manualKeepRemovals.length > 0 ||
    diff.manualKeepChanges.length > 0 ||
    diff.toolVersionChanged ||
    diff.apiVersionChanged ||
    diff.catalogChanged
  );
}

function appendPermissionTable(
  lines: string[],
  heading: string,
  permissions: Array<{ permission: string; level: "read" | "write" }>,
): void {
  if (permissions.length === 0) {
    return;
  }
  lines.push(
    "",
    `### ${heading}`,
    "",
    "| Permission | Access |",
    "| --- | --- |",
  );
  for (const permission of permissions) {
    lines.push(`| ${permission.permission} | ${permission.level} |`);
  }
}

function appendPermissionChanges(lines: string[], report: CheckReport): void {
  if (report.changes === null) {
    return;
  }
  const changes = [
    ...report.changes.permissionAdditions.map((change) => ({
      kind: "Added",
      ...change,
    })),
    ...report.changes.permissionEscalations.map((change) => ({
      kind: "Escalated",
      ...change,
    })),
    ...report.changes.permissionRemovals.map((change) => ({
      kind: "No longer observed",
      ...change,
    })),
    ...report.changes.permissionReductions.map((change) => ({
      kind: "Reduced",
      ...change,
    })),
  ];
  if (changes.length === 0) {
    return;
  }
  lines.push(
    "",
    "### Permission changes",
    "",
    "| Change | Permission | From | To |",
    "| --- | --- | --- | --- |",
  );
  for (const change of changes) {
    lines.push(
      `| ${change.kind} | ${change.permission} | ${change.from ?? "—"} | ${change.to ?? "—"} |`,
    );
  }
}

function appendCoverageChanges(lines: string[], report: CheckReport): void {
  if (report.changes === null) {
    return;
  }
  const rows = [
    ["Scenarios added", report.changes.scenarioAdditions],
    ["Scenarios removed", report.changes.scenarioRemovals],
    ["Routes added", report.changes.routeAdditions.length],
    ["Routes removed", report.changes.routeRemovals.length],
    ["Attributions added", report.changes.attributionAdditions],
    ["Attributions removed", report.changes.attributionRemovals],
    ["Scenario evidence changes", report.changes.scenarioEvidenceChanges],
    ["Route requirement changes", report.changes.routeRequirementChanges.length],
  ] as const;
  if (rows.every(([, count]) => count === 0)) {
    return;
  }
  lines.push(
    "",
    "### Coverage changes",
    "",
    "| Change | Count |",
    "| --- | ---: |",
  );
  for (const [label, count] of rows) {
    if (count > 0) {
      lines.push(`| ${label} | ${count} |`);
    }
  }
}

function appendRouteChanges(lines: string[], report: CheckReport): void {
  if (report.changes === null) {
    return;
  }
  const routeChanges = [
    ...report.changes.routeAdditions.map((route) => ({
      change: "Added",
      ...route,
    })),
    ...report.changes.routeRemovals.map((route) => ({
      change: "Removed",
      ...route,
    })),
  ];
  if (routeChanges.length === 0) {
    return;
  }
  lines.push(
    "",
    "### Safe route-template changes",
    "",
    "| Change | Method | Template |",
    "| --- | --- | --- |",
  );
  for (const route of routeChanges) {
    lines.push(
      `| ${route.change} | ${route.method} | ${route.template ?? "—"} |`,
    );
  }
}

function appendManualKeepChanges(lines: string[], report: CheckReport): void {
  if (report.changes === null) {
    return;
  }
  const changes = [
    ...report.changes.manualKeepAdditions.map((change) => ({
      change: "Added",
      permission: change.permission,
      from: null,
      to: change.level,
    })),
    ...report.changes.manualKeepRemovals.map((change) => ({
      change: "Removed",
      permission: change.permission,
      from: change.level,
      to: null,
    })),
    ...report.changes.manualKeepChanges.map((change) => ({
      change: "Changed",
      ...change,
    })),
  ];
  if (changes.length === 0) {
    return;
  }
  lines.push(
    "",
    "### Manual-keep changes",
    "",
    "| Change | Permission | From | To |",
    "| --- | --- | --- | --- |",
  );
  for (const change of changes) {
    lines.push(
      `| ${change.change} | ${change.permission} | ${change.from ?? "—"} | ${change.to ?? "—"} |`,
    );
  }
}

function appendMetadataChanges(lines: string[], report: CheckReport): void {
  if (report.changes === null) {
    return;
  }
  const changes = [
    report.changes.toolVersionChanged ? "Tool contract version" : null,
    report.changes.apiVersionChanged ? "Pinned GitHub REST API version" : null,
    report.changes.catalogChanged ? "Pinned permission catalog" : null,
    report.changes.contractEvidenceChanged ? "Contract evidence" : null,
  ].filter((change): change is string => change !== null);
  if (changes.length === 0) {
    return;
  }
  lines.push("", "### Metadata changes", "");
  for (const change of changes) {
    lines.push(`- ${change}`);
  }
}

function appendFindings(lines: string[], report: CheckReport): void {
  if (report.findings.length === 0) {
    return;
  }
  lines.push(
    "",
    "### Blocked findings",
    "",
    "| Finding | Method | Safe route template |",
    "| --- | --- | --- |",
  );
  for (const finding of report.findings) {
    lines.push(
      `| ${findingLabel(finding.finding)} | ${finding.method} | ${finding.template ?? "—"} |`,
    );
  }
}

function statusLabel(status: CheckStatus): string {
  switch (status) {
    case "accepted":
      return "Accepted";
    case "acceptance_refused":
      return "Acceptance refused";
    case "analysis_failed":
      return "Analysis failed";
    case "evidence_blocked":
      return "Evidence blocked";
    case "no_observations":
      return "No observations";
    case "passed":
      return "Passed";
    case "review_required":
      return "Review required";
  }
}

function reasonLabel(reason: Exclude<CheckReason, null>): string {
  switch (reason) {
    case "ci_accept_forbidden":
      return "Contract acceptance is disabled in CI";
    case "invalid_artifact":
      return "An observation or contract artifact is invalid";
    case "operation_locked":
      return "Another local operation is active";
    case "operation_lock_cleanup_failed":
      return "The local operation lock could not be released";
    case "summary_unavailable":
      return "The GitHub step summary file is unavailable or unsafe";
  }
}

function migrationLabel(
  migration: CheckReport["migrations"][number],
): string {
  switch (migration) {
    case "schema_v1_to_v3":
      return "Schema v1 to v3";
    case "schema_v2_to_v3":
      return "Schema v2 to v3 frontier-selection semantics";
    case "legacy_schema_v2_to_v3":
      return "Legacy schema v2 provenance and frontier-selection semantics to v3";
  }
}

function findingLabel(finding: CheckReport["findings"][number]["finding"]): string {
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
  }
}

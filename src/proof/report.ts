import {
  chmod,
  mkdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";

import { z } from "zod";

import {
  assignmentKey,
  canonicalizeAssignment,
} from "../permissions/canonical.js";
import {
  PermissionAssignmentSchema,
  PermissionLevelSchema,
  PermissionNameSchema,
  ScenarioNameSchema,
} from "../permissions/schema.js";
import {
  findManualKeepConflicts,
  manualKeepPermissions,
  requestedProofPermissions,
} from "../contract/manual-keeps.js";
import { ProofFailureSchema } from "./failure.js";
import {
  combineEffectivePermissions,
  MANDATORY_INSTALLATION_PERMISSIONS,
} from "./permission-baseline.js";
import { isSafeReviewText } from "../security/review-text.js";

const CatalogIdentitySchema = z.strictObject({
  source: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/u),
  version: z.string().min(1).max(80).regex(/^[a-zA-Z0-9._-]+$/u),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
});

const REQUIRED_NEGATIVE_CONTROL_IDS = [
  "issue-comment-create",
  "issue-comments-read",
] as const;

const PhaseResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("not_run") }),
  z.strictObject({ status: z.literal("pass") }),
  z.strictObject({
    status: z.literal("failed"),
    failure: ProofFailureSchema,
  }),
]);

const NegativeControlResultSchema = z
  .strictObject({
    id: z.enum(["issue-comments-read", "issue-comment-create"]),
    mode: z.enum(["read_only", "mutating"]),
    removedPermission: PermissionNameSchema,
    status: z.enum([
      "not_run",
      "not_applicable",
      "expected_rejection",
      "unexpected_pass",
      "indeterminate",
    ]),
    failure: ProofFailureSchema.optional(),
    cleanup: z.enum(["not_required", "pass", "failed"]),
  })
  .superRefine((result, context) => {
    const expectedMode =
      result.id === "issue-comments-read" ? "read_only" : "mutating";
    if (result.mode !== expectedMode || result.removedPermission !== "issues") {
      context.addIssue({
        code: "custom",
        message: "Negative-control identity does not match its definition.",
      });
    }
    if (
      (result.status === "indeterminate") !==
      (result.failure !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["failure"],
        message: "Only an indeterminate control carries a failure class.",
      });
    }
    if (result.mode === "read_only" && result.cleanup !== "not_required") {
      context.addIssue({
        code: "custom",
        path: ["cleanup"],
        message: "A read-only control never requires cleanup.",
      });
    }
    if (
      result.mode === "mutating" &&
      result.status === "unexpected_pass" &&
      result.cleanup === "not_required"
    ) {
      context.addIssue({
        code: "custom",
        path: ["cleanup"],
        message: "An unexpected mutation requires a terminal cleanup result.",
      });
    }
    if (
      result.mode === "mutating" &&
      result.status !== "unexpected_pass" &&
      result.cleanup !== "not_required"
    ) {
      context.addIssue({
        code: "custom",
        path: ["cleanup"],
        message: "A mutation that did not occur never requires cleanup.",
      });
    }
  });

const CleanupResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("not_run") }),
  z.strictObject({ status: z.literal("pass") }),
  z.strictObject({
    status: z.literal("failed"),
    failure: z.literal("cleanup_failure"),
  }),
]);

export const ProofStrengthSchema = z.enum([
  "not_established",
  "restricted_scope_reproduced",
  "necessity_partially_tested",
  "necessity_tested",
]);

export type ProofStrength = z.infer<typeof ProofStrengthSchema>;

type ProofStrengthInput = {
  selectedPermissions: Readonly<Record<string, unknown>>;
  positiveProof: { status: string };
  negativeControls: ReadonlyArray<{
    removedPermission: string;
    status: string;
  }>;
  cleanup: { status: string };
};

export function deriveProofStrength(
  report: ProofStrengthInput,
): ProofStrength {
  const controlsCompletedSuccessfully = report.negativeControls.every(
    (control) =>
      control.status === "expected_rejection" ||
      control.status === "not_applicable",
  );
  if (
    report.positiveProof.status !== "pass" ||
    report.cleanup.status !== "pass" ||
    !controlsCompletedSuccessfully
  ) {
    return "not_established";
  }

  const selectedPermissions = Object.keys(report.selectedPermissions);
  const testedPermissions = new Set(
    report.negativeControls
      .filter((control) => control.status === "expected_rejection")
      .map((control) => control.removedPermission)
      .filter((permission) => permission in report.selectedPermissions),
  );
  if (testedPermissions.size === 0) {
    return "restricted_scope_reproduced";
  }
  return testedPermissions.size === selectedPermissions.length
    ? "necessity_tested"
    : "necessity_partially_tested";
}

export const ProofRunReportSchema = z
  .strictObject({
    schemaVersion: z.literal(3),
    toolVersion: z.string().min(1).max(64),
    apiVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    sourceCommit: z
      .string()
      .regex(/^[a-f0-9]{7,64}$/u)
      .nullable(),
    scenario: ScenarioNameSchema,
    catalog: CatalogIdentitySchema,
    contractHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    selectedPermissions: PermissionAssignmentSchema,
    manualKeeps: z.record(
      PermissionNameSchema,
      z.strictObject({
        level: PermissionLevelSchema,
        reason: z.string().trim().min(1).max(240).refine(isSafeReviewText),
      }),
    ),
    requestedPermissions: PermissionAssignmentSchema,
    mandatoryPermissions: PermissionAssignmentSchema,
    effectivePermissions: PermissionAssignmentSchema.nullable(),
    repositoryScopeVerified: z.boolean(),
    contractMatched: z.boolean(),
    proofStrength: ProofStrengthSchema,
    child: z.strictObject({
      exitCode: z.number().int().min(0).max(255).nullable(),
      signal: z.string().regex(/^SIG[A-Z0-9]+$/u).nullable(),
      observedOperations: z.number().int().min(0).max(10_000),
    }),
    positiveProof: PhaseResultSchema,
    negativeControls: z.array(NegativeControlResultSchema).min(1).max(16),
    cleanup: CleanupResultSchema,
  })
  .superRefine((report, context) => {
    if (
      new Set(report.negativeControls.map((control) => control.id)).size !==
      report.negativeControls.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["negativeControls"],
        message: "Negative-control identifiers must be unique.",
      });
    }
    const controlIds = report.negativeControls
      .map((control) => control.id)
      .sort();
    if (
      JSON.stringify(controlIds) !==
      JSON.stringify(REQUIRED_NEGATIVE_CONTROL_IDS)
    ) {
      context.addIssue({
        code: "custom",
        path: ["negativeControls"],
        message:
          "Proof reports must include every built-in negative control exactly once.",
      });
    }
    if (
      report.negativeControls.some((control) => control.cleanup === "failed") &&
      report.cleanup.status !== "failed"
    ) {
      context.addIssue({
        code: "custom",
        path: ["cleanup"],
        message: "A negative-control cleanup failure must fail overall cleanup.",
      });
    }
    if (
      report.negativeControls.some(
        (control) =>
          control.status !== "not_run" &&
          control.status !== "not_applicable" &&
          report.selectedPermissions[control.removedPermission] === undefined,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["negativeControls"],
        message:
          "An applicable negative control must remove a selected permission.",
      });
    }
    if (
      findManualKeepConflicts(
        report,
        report.selectedPermissions,
        MANDATORY_INSTALLATION_PERMISSIONS,
      ).length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["manualKeeps"],
        message:
          "Manual keeps cannot duplicate selected access or the mandatory baseline.",
      });
    }
    const expectedRequested = requestedProofPermissions(
      report.selectedPermissions,
      manualKeepPermissions(report),
    );
    if (
      assignmentKey(report.requestedPermissions) !==
      assignmentKey(expectedRequested)
    ) {
      context.addIssue({
        code: "custom",
        path: ["requestedPermissions"],
        message:
          "Requested permissions must equal scenario-selected permissions plus manual keeps.",
      });
    }
    if (
      assignmentKey(report.mandatoryPermissions) !==
      assignmentKey(MANDATORY_INSTALLATION_PERMISSIONS)
    ) {
      context.addIssue({
        code: "custom",
        path: ["mandatoryPermissions"],
        message:
          "Mandatory permissions must exactly match GrantTrace's GitHub baseline.",
      });
    }

    if (
      report.effectivePermissions === null &&
      report.repositoryScopeVerified
    ) {
      context.addIssue({
        code: "custom",
        path: ["repositoryScopeVerified"],
        message:
          "Repository scope cannot be verified without an effective token response.",
      });
    }

    if (
      report.effectivePermissions !== null &&
      assignmentKey(report.effectivePermissions) !==
        assignmentKey(
          combineEffectivePermissions(
            report.requestedPermissions,
            report.mandatoryPermissions,
          ),
        )
    ) {
      context.addIssue({
        code: "custom",
        path: ["effectivePermissions"],
        message:
          "Effective permissions must equal requested permissions plus the mandatory baseline.",
      });
    }

    if (
      report.child.exitCode !== null &&
      report.child.signal !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["child"],
        message: "A child cannot exit by both code and signal.",
      });
    }

    if (
      report.positiveProof.status === "pass" &&
      (report.effectivePermissions === null ||
        !report.repositoryScopeVerified ||
        !report.contractMatched ||
        report.child.exitCode !== 0 ||
        report.child.signal !== null ||
        report.child.observedOperations === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["positiveProof"],
        message:
          "A passing proof requires verified scope, effective permissions, a passing child, and observations.",
      });
    }
    if (
      report.positiveProof.status === "pass" &&
      report.cleanup.status === "not_run"
    ) {
      context.addIssue({
        code: "custom",
        path: ["cleanup"],
        message: "A completed positive proof requires terminal cleanup.",
      });
    }
    if (
      report.positiveProof.status === "pass" &&
      report.cleanup.status === "pass" &&
      report.negativeControls.some((control) => control.status === "not_run")
    ) {
      context.addIssue({
        code: "custom",
        path: ["negativeControls"],
        message:
          "A clean completed proof requires terminal negative controls.",
      });
    }
    if (
      report.positiveProof.status !== "pass" &&
      report.negativeControls.some(
        (control) => control.status !== "not_run",
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["negativeControls"],
        message:
          "Negative controls cannot run before the positive proof passes.",
      });
    }
    if (report.proofStrength !== deriveProofStrength(report)) {
      context.addIssue({
        code: "custom",
        path: ["proofStrength"],
        message:
          "Proof strength must be derived from reproduction, cleanup, selected permissions, and negative controls.",
      });
    }
  });

export type ProofRunReport = z.infer<typeof ProofRunReportSchema>;

export class ProofReportError extends Error {
  public constructor() {
    super("The proof report could not be validated or written safely.");
    this.name = "ProofReportError";
  }
}

export function serializeProofReport(input: unknown): string {
  const parsed = ProofRunReportSchema.safeParse(input);
  if (!parsed.success) {
    throw new ProofReportError();
  }

  const report: ProofRunReport = {
    schemaVersion: 3,
    toolVersion: parsed.data.toolVersion,
    apiVersion: parsed.data.apiVersion,
    sourceCommit: parsed.data.sourceCommit,
    scenario: parsed.data.scenario,
    catalog: {
      source: parsed.data.catalog.source,
      version: parsed.data.catalog.version,
      checksum: parsed.data.catalog.checksum,
    },
    contractHash: parsed.data.contractHash,
    selectedPermissions: canonicalizeAssignment(
      parsed.data.selectedPermissions,
    ),
    manualKeeps: Object.fromEntries(
      Object.entries(parsed.data.manualKeeps).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    ),
    requestedPermissions: canonicalizeAssignment(
      parsed.data.requestedPermissions,
    ),
    mandatoryPermissions: canonicalizeAssignment(
      parsed.data.mandatoryPermissions,
    ),
    effectivePermissions:
      parsed.data.effectivePermissions === null
        ? null
        : canonicalizeAssignment(parsed.data.effectivePermissions),
    repositoryScopeVerified: parsed.data.repositoryScopeVerified,
    contractMatched: parsed.data.contractMatched,
    proofStrength: parsed.data.proofStrength,
    child: {
      exitCode: parsed.data.child.exitCode,
      signal: parsed.data.child.signal,
      observedOperations: parsed.data.child.observedOperations,
    },
    positiveProof: parsed.data.positiveProof,
    negativeControls: parsed.data.negativeControls,
    cleanup: parsed.data.cleanup,
  };

  return `${JSON.stringify(report, null, 2)}\n`;
}

export async function writeProofReport(
  path: string,
  input: unknown,
): Promise<void> {
  const content = serializeProofReport(input);
  const directory = dirname(path);
  const temporaryPath = `${path}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;

  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await writeFile(temporaryPath, content, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } catch {
    await unlink(temporaryPath).catch(() => undefined);
    throw new ProofReportError();
  }
}

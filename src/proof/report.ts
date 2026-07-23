import {
  chmod,
  mkdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import {
  assignmentKey,
  canonicalizeAssignment,
} from "../permissions/canonical.js";
import {
  PermissionAssignmentSchema,
  ScenarioNameSchema,
} from "../permissions/schema.js";
import { ProofFailureSchema } from "./failure.js";
import { combineEffectivePermissions } from "./permission-baseline.js";

const CatalogIdentitySchema = z.strictObject({
  source: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/u),
  version: z.string().min(1).max(80).regex(/^[a-zA-Z0-9._-]+$/u),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
});

const PhaseResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("not_run") }),
  z.strictObject({ status: z.literal("pass") }),
  z.strictObject({
    status: z.literal("failed"),
    failure: ProofFailureSchema,
  }),
]);

const NegativeControlResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("not_run") }),
  z.strictObject({ status: z.literal("not_applicable") }),
  z.strictObject({ status: z.literal("expected_rejection") }),
  z.strictObject({ status: z.literal("unexpected_pass") }),
  z.strictObject({
    status: z.literal("indeterminate"),
    failure: ProofFailureSchema,
  }),
]);

const CleanupResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("not_run") }),
  z.strictObject({ status: z.literal("pass") }),
  z.strictObject({
    status: z.literal("failed"),
    failure: z.literal("cleanup_failure"),
  }),
]);

export const ProofRunReportSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
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
    mandatoryPermissions: PermissionAssignmentSchema,
    effectivePermissions: PermissionAssignmentSchema.nullable(),
    repositoryScopeVerified: z.boolean(),
    contractMatched: z.boolean(),
    child: z.strictObject({
      exitCode: z.number().int().min(0).max(255).nullable(),
      signal: z.string().regex(/^SIG[A-Z0-9]+$/u).nullable(),
      observedOperations: z.number().int().min(0).max(10_000),
    }),
    positiveProof: PhaseResultSchema,
    negativeControl: NegativeControlResultSchema,
    cleanup: CleanupResultSchema,
  })
  .superRefine((report, context) => {
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
            report.selectedPermissions,
            report.mandatoryPermissions,
          ),
        )
    ) {
      context.addIssue({
        code: "custom",
        path: ["effectivePermissions"],
        message:
          "Effective permissions must equal selected permissions plus the mandatory baseline.",
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
    schemaVersion: 1,
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
    mandatoryPermissions: canonicalizeAssignment(
      parsed.data.mandatoryPermissions,
    ),
    effectivePermissions:
      parsed.data.effectivePermissions === null
        ? null
        : canonicalizeAssignment(parsed.data.effectivePermissions),
    repositoryScopeVerified: parsed.data.repositoryScopeVerified,
    contractMatched: parsed.data.contractMatched,
    child: {
      exitCode: parsed.data.child.exitCode,
      signal: parsed.data.child.signal,
      observedOperations: parsed.data.child.observedOperations,
    },
    positiveProof: parsed.data.positiveProof,
    negativeControl: parsed.data.negativeControl,
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
  const temporaryPath = `${path}.tmp-${process.pid}`;

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

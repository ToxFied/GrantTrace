import { z } from "zod";

import { ObservationFindingSchema } from "./observation.js";
import {
  PermissionAssignmentSchema,
  PermissionDNFSchema,
  PermissionLevelSchema,
  PermissionNameSchema,
  ScenarioNameSchema,
} from "../permissions/schema.js";
import { isSyntacticallySafeTemplate } from "../routes/canonical.js";
import { isSafeReviewText } from "../security/review-text.js";

const CatalogIdentitySchema = z.strictObject({
  source: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/u),
  version: z.string().min(1).max(80).regex(/^[a-zA-Z0-9._-]+$/u),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
});

const EvidenceSourcesSchema = z
  .array(z.enum(["runtime_header", "pinned_catalog"]))
  .min(1);

const ContractRouteSchema = z.strictObject({
  method: z.enum(["DELETE", "GET", "HEAD", "PATCH", "POST", "PUT"]),
  template: z.string().refine(isSyntacticallySafeTemplate),
  alternatives: PermissionDNFSchema,
  evidence: EvidenceSourcesSchema,
  scenarioEvidence: z.record(ScenarioNameSchema, EvidenceSourcesSchema),
  scenarios: z.array(ScenarioNameSchema).min(1),
});

const LegacyContractRouteSchema = ContractRouteSchema.omit({
  scenarioEvidence: true,
});

const ManualKeepSchema = z.strictObject({
  level: PermissionLevelSchema,
  reason: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .refine(isSafeReviewText),
});

const ContractBodyShape = {
  toolVersion: z.string().min(1).max(64),
  apiVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  catalog: CatalogIdentitySchema,
  scenarios: z
    .array(
      z.strictObject({
        name: ScenarioNameSchema,
      }),
    ),
  routes: z.array(ContractRouteSchema),
  selectedPermissions: PermissionAssignmentSchema,
  permissionFrontier: z.array(PermissionAssignmentSchema).min(1),
  manualKeeps: z.record(PermissionNameSchema, ManualKeepSchema),
  unknowns: z.array(
    z.strictObject({
      scenario: ScenarioNameSchema,
      method: z.enum([
        "DELETE",
        "GET",
        "HEAD",
        "PATCH",
        "POST",
        "PUT",
        "UNKNOWN",
      ]),
      template: z
        .string()
        .refine(isSyntacticallySafeTemplate)
        .nullable(),
      finding: ObservationFindingSchema,
    }),
  ),
};

export const GrantTraceContractSchema = z.strictObject({
  schemaVersion: z.literal(3),
  ...ContractBodyShape,
});

export type GrantTraceContract = z.infer<typeof GrantTraceContractSchema>;

export const GrantTraceContractV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  ...ContractBodyShape,
});

export const GrantTraceContractLegacyV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  toolVersion: z.string().min(1).max(64),
  apiVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  catalog: CatalogIdentitySchema,
  scenarios: z.array(
    z.strictObject({
      name: ScenarioNameSchema,
    }),
  ),
  routes: z.array(LegacyContractRouteSchema),
  selectedPermissions: PermissionAssignmentSchema,
  permissionFrontier: z.array(PermissionAssignmentSchema).min(1),
  manualKeeps: z.record(PermissionNameSchema, ManualKeepSchema),
  unknowns: z.array(
    z.strictObject({
      scenario: ScenarioNameSchema,
      method: z.enum([
        "DELETE",
        "GET",
        "HEAD",
        "PATCH",
        "POST",
        "PUT",
        "UNKNOWN",
      ]),
      template: z
        .string()
        .refine(isSyntacticallySafeTemplate)
        .nullable(),
      finding: ObservationFindingSchema,
    }),
  ),
});

export const GrantTraceContractV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  toolVersion: z.string().min(1).max(64),
  apiVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  catalog: CatalogIdentitySchema,
  scenarios: z
    .array(
      z.strictObject({
        name: ScenarioNameSchema,
      }),
    )
    .min(1),
  routes: z.array(
    ContractRouteSchema.omit({
      scenarioEvidence: true,
      scenarios: true,
    }),
  ),
  selectedPermissions: PermissionAssignmentSchema,
  permissionFrontier: z.array(PermissionAssignmentSchema).min(1),
  manualKeeps: z.record(PermissionNameSchema, ManualKeepSchema),
  unknowns: z.array(
    z.strictObject({
      scenario: ScenarioNameSchema,
      method: z.enum([
        "DELETE",
        "GET",
        "HEAD",
        "PATCH",
        "POST",
        "PUT",
        "UNKNOWN",
      ]),
      template: z.string().min(1).max(256).startsWith("/").nullable(),
      finding: ObservationFindingSchema,
    }),
  ),
});

export type GrantTraceContractV1 = z.infer<
  typeof GrantTraceContractV1Schema
>;

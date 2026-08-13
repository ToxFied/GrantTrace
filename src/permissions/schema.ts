import { z } from "zod";

export const PermissionNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/u);

export const PermissionLevelSchema = z.enum(["read", "write"]);

export const PermissionAssignmentSchema = z.record(
  PermissionNameSchema,
  PermissionLevelSchema,
);

export const PermissionTermSchema = z.strictObject({
  permission: PermissionNameSchema,
  level: PermissionLevelSchema,
});

// An empty conjunction is boolean true: the route needs no additional
// GitHub App permission beyond GitHub's installation baseline.
export const PermissionConjunctionSchema = z.array(PermissionTermSchema);

export const PermissionDNFSchema = z.array(PermissionConjunctionSchema).min(1);

export const ScenarioNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/u);

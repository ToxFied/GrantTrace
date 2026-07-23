import { z } from "zod";

import {
  assignmentKey,
  canonicalizeAssignment,
} from "../permissions/canonical.js";
import {
  PermissionAssignmentSchema,
  PermissionNameSchema,
} from "../permissions/schema.js";
import type { PermissionAssignment } from "../permissions/types.js";
import { SensitiveValue } from "../security/sensitive-value.js";
import type { ProofFailure } from "./failure.js";
import { combineEffectivePermissions } from "./permission-baseline.js";

const RawTokenResponseSchema = z
  .object({
    token: z.string().min(1).max(4_096),
    expires_at: z.string().min(1).max(64),
    permissions: z
      .record(PermissionNameSchema, z.string().min(1).max(16))
      .optional(),
    repositories: z
      .array(
        z
          .object({
            full_name: z.string().min(3).max(141),
          })
          .passthrough(),
      )
      .max(500)
      .optional(),
  })
  .passthrough();

export type ValidatedInstallationToken = {
  token: SensitiveValue;
  expiresAt: Date;
  requestedPermissions: PermissionAssignment;
  mandatoryPermissions: PermissionAssignment;
  effectivePermissions: PermissionAssignment;
  repositoryScopeVerified: true;
};

export class TokenResponseError extends Error {
  public readonly code: Extract<
    ProofFailure,
    | "invalid_token_response"
    | "missing_effective_permissions"
    | "effective_permission_mismatch"
    | "unverified_repository_scope"
  >;

  public constructor(code: TokenResponseError["code"]) {
    super(`The installation-token response was not conclusive (${code}).`);
    this.name = "TokenResponseError";
    this.code = code;
  }
}

export function validateInstallationTokenResponse(
  raw: unknown,
  expected: {
    requestedPermissions: PermissionAssignment;
    mandatoryPermissions: PermissionAssignment;
    owner: string;
    repository: string;
  },
  now = new Date(),
): ValidatedInstallationToken {
  const parsed = RawTokenResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TokenResponseError("invalid_token_response");
  }

  if (parsed.data.permissions === undefined) {
    throw new TokenResponseError("missing_effective_permissions");
  }

  const effectiveResult = PermissionAssignmentSchema.safeParse(
    parsed.data.permissions,
  );
  const expectedResult = PermissionAssignmentSchema.safeParse(
    expected.requestedPermissions,
  );
  const mandatoryResult = PermissionAssignmentSchema.safeParse(
    expected.mandatoryPermissions,
  );
  if (
    !effectiveResult.success ||
    !expectedResult.success ||
    !mandatoryResult.success
  ) {
    throw new TokenResponseError("invalid_token_response");
  }

  const effectivePermissions = canonicalizeAssignment(effectiveResult.data);
  const requestedPermissions = canonicalizeAssignment(expectedResult.data);
  const mandatoryPermissions = canonicalizeAssignment(
    mandatoryResult.data,
  );
  const expectedEffectivePermissions = combineEffectivePermissions(
    requestedPermissions,
    mandatoryPermissions,
  );
  if (
    assignmentKey(effectivePermissions) !==
    assignmentKey(expectedEffectivePermissions)
  ) {
    throw new TokenResponseError("effective_permission_mismatch");
  }

  const expiresAt = new Date(parsed.data.expires_at);
  const lifetimeMs = expiresAt.getTime() - now.getTime();
  if (
    Number.isNaN(expiresAt.getTime()) ||
    lifetimeMs < 45 * 60 * 1_000 ||
    lifetimeMs > 65 * 60 * 1_000
  ) {
    throw new TokenResponseError("invalid_token_response");
  }

  const expectedFullName =
    `${expected.owner}/${expected.repository}`.toLowerCase();
  const repositories = parsed.data.repositories;
  if (
    repositories === undefined ||
    repositories.length !== 1 ||
    repositories[0]?.full_name.toLowerCase() !== expectedFullName
  ) {
    throw new TokenResponseError("unverified_repository_scope");
  }

  return {
    token: new SensitiveValue(parsed.data.token),
    expiresAt,
    requestedPermissions,
    mandatoryPermissions,
    effectivePermissions,
    repositoryScopeVerified: true,
  };
}

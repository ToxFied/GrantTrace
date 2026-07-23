import { canonicalizeAssignment } from "../permissions/canonical.js";
import type { PermissionAssignment } from "../permissions/types.js";

export const MANDATORY_INSTALLATION_PERMISSIONS: PermissionAssignment =
  Object.freeze({
    metadata: "read",
  });

export function combineEffectivePermissions(
  requested: PermissionAssignment,
  mandatory: PermissionAssignment = MANDATORY_INSTALLATION_PERMISSIONS,
): PermissionAssignment {
  const combined: PermissionAssignment = { ...requested };
  for (const [permission, level] of Object.entries(mandatory)) {
    const previous = combined[permission];
    combined[permission] =
      previous === "write" || level === "write"
        ? "write"
        : "read";
  }
  return canonicalizeAssignment(combined);
}

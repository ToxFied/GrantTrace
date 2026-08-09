import {
  assignmentKey,
  canonicalizeAssignment,
  comparePermissionLevels,
} from "../permissions/canonical.js";
import type { PermissionAssignment } from "../permissions/types.js";
import type { GrantTraceContract } from "./schema.js";

export function findFrontierAssignment(
  frontier: readonly PermissionAssignment[],
  assignment: PermissionAssignment,
): PermissionAssignment | null {
  const key = assignmentKey(assignment);
  const match = frontier.find((candidate) => assignmentKey(candidate) === key);
  return match === undefined ? null : canonicalizeAssignment(match);
}

export function preserveFrontierSelection(
  next: GrantTraceContract,
  previousSelection: PermissionAssignment,
): GrantTraceContract {
  const retained = findFrontierAssignment(
    next.permissionFrontier,
    previousSelection,
  );
  return retained === null
    ? next
    : { ...next, selectedPermissions: retained };
}

export function findCoveredFrontierAssignment(
  frontier: readonly PermissionAssignment[],
  available: PermissionAssignment,
): PermissionAssignment | null {
  const match = frontier.find((candidate) =>
    Object.entries(candidate).every(([permission, level]) => {
      const granted = available[permission];
      return (
        granted !== undefined && comparePermissionLevels(granted, level) >= 0
      );
    }),
  );
  return match === undefined ? null : canonicalizeAssignment(match);
}

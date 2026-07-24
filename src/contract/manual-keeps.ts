import {
  canonicalizeAssignment,
  comparePermissionLevels,
  maxPermissionLevel,
} from "../permissions/canonical.js";
import type { PermissionAssignment } from "../permissions/types.js";
import type { GrantTraceContract } from "./schema.js";

export type ManualKeepConflict = {
  permission: string;
  kind: "mandatory_baseline" | "selected_access";
};

export function manualKeepPermissions(
  contract: Pick<GrantTraceContract, "manualKeeps">,
): PermissionAssignment {
  return canonicalizeAssignment(
    Object.fromEntries(
      Object.entries(contract.manualKeeps).map(([permission, keep]) => [
        permission,
        keep.level,
      ]),
    ),
  );
}

export function requestedProofPermissions(
  selected: PermissionAssignment,
  manualKeeps: PermissionAssignment,
): PermissionAssignment {
  const requested: PermissionAssignment = { ...selected };
  for (const [permission, level] of Object.entries(manualKeeps)) {
    const previous = requested[permission];
    requested[permission] =
      previous === undefined ? level : maxPermissionLevel(previous, level);
  }
  return canonicalizeAssignment(requested);
}

export function findManualKeepConflicts(
  contract: Pick<GrantTraceContract, "manualKeeps">,
  selected: PermissionAssignment,
  mandatory: PermissionAssignment,
): ManualKeepConflict[] {
  const conflicts: ManualKeepConflict[] = [];
  for (const [permission, keep] of Object.entries(contract.manualKeeps)) {
    if (mandatory[permission] !== undefined) {
      conflicts.push({ permission, kind: "mandatory_baseline" });
      continue;
    }
    const observed = selected[permission];
    if (
      observed !== undefined &&
      comparePermissionLevels(observed, keep.level) >= 0
    ) {
      conflicts.push({ permission, kind: "selected_access" });
    }
  }
  return conflicts;
}

export function retainUnobservedManualKeeps(
  contract: Pick<GrantTraceContract, "manualKeeps">,
  selected: PermissionAssignment,
): GrantTraceContract["manualKeeps"] {
  return Object.fromEntries(
    Object.entries(contract.manualKeeps).filter(([permission, keep]) => {
      const observed = selected[permission];
      return (
        observed === undefined ||
        comparePermissionLevels(observed, keep.level) < 0
      );
    }),
  );
}

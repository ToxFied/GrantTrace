import { PermissionDNFSchema } from "./schema.js";
import { compareAscii } from "../deterministic.js";
import type {
  PermissionAssignment,
  PermissionConjunction,
  PermissionDNF,
  PermissionLevel,
  PermissionTerm,
} from "./types.js";

const LEVEL_RANK: Readonly<Record<PermissionLevel, number>> = {
  read: 1,
  write: 2,
};

export class PermissionModelError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PermissionModelError";
  }
}

export function comparePermissionLevels(
  left: PermissionLevel,
  right: PermissionLevel,
): number {
  return LEVEL_RANK[left] - LEVEL_RANK[right];
}

export function maxPermissionLevel(
  left: PermissionLevel,
  right: PermissionLevel,
): PermissionLevel {
  return comparePermissionLevels(left, right) >= 0 ? left : right;
}

export function canonicalTermKey(term: PermissionTerm): string {
  return `${term.permission}=${term.level}`;
}

export function canonicalizeConjunction(
  conjunction: PermissionConjunction,
): PermissionConjunction {
  const byPermission = new Map<string, PermissionLevel>();

  for (const term of conjunction) {
    const previous = byPermission.get(term.permission);
    if (previous !== undefined && previous !== term.level) {
      throw new PermissionModelError(
        "A conjunction repeats one permission with conflicting levels.",
      );
    }
    byPermission.set(term.permission, term.level);
  }

  return [...byPermission.entries()]
    .map(([permission, level]) => ({ permission, level }))
    .sort((left, right) =>
      compareAscii(canonicalTermKey(left), canonicalTermKey(right)),
    );
}

export function canonicalConjunctionKey(
  conjunction: PermissionConjunction,
): string {
  return canonicalizeConjunction(conjunction).map(canonicalTermKey).join(",");
}

export function canonicalizeDNF(input: unknown): PermissionDNF {
  const parsed = PermissionDNFSchema.parse(input);
  const alternatives = new Map<string, PermissionConjunction>();

  for (const conjunction of parsed) {
    const canonical = canonicalizeConjunction(conjunction);
    alternatives.set(canonical.map(canonicalTermKey).join(","), canonical);
  }

  return [...alternatives.entries()]
    .sort(([left], [right]) => compareAscii(left, right))
    .map(([, conjunction]) => conjunction);
}

export function canonicalDNFKey(dnf: PermissionDNF): string {
  return canonicalizeDNF(dnf).map(canonicalConjunctionKey).join(";");
}

export function assignmentKey(assignment: PermissionAssignment): string {
  return Object.entries(assignment)
    .sort(([left], [right]) => compareAscii(left, right))
    .map(([permission, level]) => `${permission}=${level}`)
    .join(",");
}

export function canonicalizeAssignment(
  assignment: PermissionAssignment,
): PermissionAssignment {
  return Object.fromEntries(
    Object.entries(assignment).sort(([left], [right]) =>
      compareAscii(left, right),
    ),
  ) as PermissionAssignment;
}

export function assignmentSatisfiesTerm(
  assignment: PermissionAssignment,
  term: PermissionTerm,
): boolean {
  const granted = assignment[term.permission];
  return (
    granted !== undefined && comparePermissionLevels(granted, term.level) >= 0
  );
}

export function assignmentSatisfiesDNF(
  assignment: PermissionAssignment,
  dnf: PermissionDNF,
): boolean {
  return dnf.some((conjunction) =>
    conjunction.every((term) => assignmentSatisfiesTerm(assignment, term)),
  );
}

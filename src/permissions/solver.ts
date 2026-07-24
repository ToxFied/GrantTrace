import {
  assignmentKey,
  canonicalizeAssignment,
  canonicalizeDNF,
  comparePermissionLevels,
  maxPermissionLevel,
} from "./canonical.js";
import { compareAscii } from "../deterministic.js";
import type {
  PermissionAssignment,
  PermissionConjunction,
  PermissionLevel,
  RouteRequirement,
} from "./types.js";

export type SolverOptions = {
  baseline?: PermissionAssignment;
  maxCombinations?: number;
  maxFrontier?: number;
};

export type SolverResult = {
  selected: PermissionAssignment;
  frontier: PermissionAssignment[];
};

const DEFAULT_MAX_COMBINATIONS = 16_384;
const DEFAULT_MAX_FRONTIER = 1_024;

export class SolverLimitError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SolverLimitError";
  }
}

export function solvePermissionContract(
  requirements: RouteRequirement[],
  options: SolverOptions = {},
): SolverResult {
  const maxCombinations =
    options.maxCombinations ?? DEFAULT_MAX_COMBINATIONS;
  const maxFrontier = options.maxFrontier ?? DEFAULT_MAX_FRONTIER;

  if (maxCombinations < 1 || maxFrontier < 1) {
    throw new SolverLimitError("Solver bounds must be positive.");
  }

  const baseline = canonicalizeAssignment(options.baseline ?? {});
  let frontier: PermissionAssignment[] = [baseline];
  const orderedRequirements = [...requirements].sort((left, right) =>
    compareAscii(routeKey(left), routeKey(right)),
  );

  for (const requirement of orderedRequirements) {
    const alternatives = canonicalizeDNF(requirement.alternatives);
    const combinationCount = frontier.length * alternatives.length;
    if (combinationCount > maxCombinations) {
      throw new SolverLimitError(
        `Permission search requires ${combinationCount} combinations; the supported limit is ${maxCombinations}.`,
      );
    }

    const combined = new Map<string, PermissionAssignment>();
    for (const candidate of frontier) {
      for (const alternative of alternatives) {
        const assignment = joinConjunction(candidate, alternative);
        combined.set(assignmentKey(assignment), assignment);
      }
    }

    frontier = pruneDominatedBounded([...combined.values()], maxFrontier);
  }

  frontier.sort(compareAssignments);
  const selected = frontier[0];
  if (selected === undefined) {
    throw new SolverLimitError("Permission solver produced no candidates.");
  }

  return {
    selected: removeBaseline(selected, baseline),
    frontier: frontier.map((assignment) => removeBaseline(assignment, baseline)),
  };
}

function removeBaseline(
  assignment: PermissionAssignment,
  baseline: PermissionAssignment,
): PermissionAssignment {
  const additional: PermissionAssignment = {};
  for (const [permission, level] of Object.entries(assignment)) {
    const baselineLevel = baseline[permission];
    if (
      baselineLevel === undefined ||
      comparePermissionLevels(level, baselineLevel) > 0
    ) {
      additional[permission] = level;
    }
  }
  return canonicalizeAssignment(additional);
}

export function joinConjunction(
  assignment: PermissionAssignment,
  conjunction: PermissionConjunction,
): PermissionAssignment {
  const joined: PermissionAssignment = { ...assignment };

  for (const term of conjunction) {
    const previous = joined[term.permission];
    joined[term.permission] =
      previous === undefined
        ? term.level
        : maxPermissionLevel(previous, term.level);
  }

  return canonicalizeAssignment(joined);
}

export function assignmentDominates(
  candidate: PermissionAssignment,
  other: PermissionAssignment,
): boolean {
  const permissions = new Set([
    ...Object.keys(candidate),
    ...Object.keys(other),
  ]);
  let strictlyLess = false;

  for (const permission of permissions) {
    const candidateLevel = candidate[permission];
    const otherLevel = other[permission];
    const comparison = compareOptionalLevels(candidateLevel, otherLevel);
    if (comparison > 0) {
      return false;
    }
    if (comparison < 0) {
      strictlyLess = true;
    }
  }

  return strictlyLess;
}

export function pruneDominated(
  assignments: PermissionAssignment[],
): PermissionAssignment[] {
  return pruneDominatedBounded(assignments, Number.POSITIVE_INFINITY);
}

function pruneDominatedBounded(
  assignments: PermissionAssignment[],
  maximum: number,
): PermissionAssignment[] {
  const ordered = [...assignments].sort((left, right) => {
    const privilegeDifference =
      totalPrivilege(left) - totalPrivilege(right);
    return privilegeDifference !== 0
      ? privilegeDifference
      : compareAscii(assignmentKey(left), assignmentKey(right));
  });
  const frontier: PermissionAssignment[] = [];
  for (const assignment of ordered) {
    if (
      frontier.some((candidate) =>
        assignmentDominates(candidate, assignment),
      )
    ) {
      continue;
    }
    frontier.push(assignment);
    if (frontier.length > maximum) {
      throw new SolverLimitError(
        `Permission frontier reached more than ${maximum} candidates; the supported limit is ${maximum}.`,
      );
    }
  }
  return frontier;
}

function routeKey(requirement: RouteRequirement): string {
  return `${requirement.route.method} ${requirement.route.template}`;
}

function compareOptionalLevels(
  left: PermissionLevel | undefined,
  right: PermissionLevel | undefined,
): number {
  if (left === undefined) {
    return right === undefined ? 0 : -1;
  }
  if (right === undefined) {
    return 1;
  }
  return comparePermissionLevels(left, right);
}

function compareAssignments(
  left: PermissionAssignment,
  right: PermissionAssignment,
): number {
  const writeDifference = countWrites(left) - countWrites(right);
  if (writeDifference !== 0) {
    return writeDifference;
  }

  const weightDifference = accessWeight(left) - accessWeight(right);
  if (weightDifference !== 0) {
    return weightDifference;
  }

  const permissionDifference =
    Object.keys(left).length - Object.keys(right).length;
  if (permissionDifference !== 0) {
    return permissionDifference;
  }

  return compareAscii(assignmentKey(left), assignmentKey(right));
}

function countWrites(assignment: PermissionAssignment): number {
  return Object.values(assignment).filter((level) => level === "write").length;
}

function accessWeight(assignment: PermissionAssignment): number {
  return Object.values(assignment).reduce(
    (total, level) => total + (level === "write" ? 4 : 1),
    0,
  );
}

function totalPrivilege(assignment: PermissionAssignment): number {
  return Object.values(assignment).reduce(
    (total, level) => total + (level === "write" ? 2 : 1),
    0,
  );
}

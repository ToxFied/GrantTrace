import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { CatalogEntry } from "../../src/evidence/catalog.js";
import { solvePermissionContract } from "../../src/permissions/solver.js";
import type {
  PermissionAssignment,
  PermissionDNF,
  PermissionLevel,
  RouteRequirement,
} from "../../src/permissions/types.js";
import { isSyntacticallySafeTemplate } from "../../src/routes/canonical.js";
import {
  resolveRuntimeRoute,
  type RuntimeRouteResolution,
} from "../../src/runtime/route.js";

const PROPERTY_SEED = 0x4752414e;
const PERMISSIONS = [
  "actions",
  "contents",
  "issues",
  "pull_requests",
] as const;
const LEVELS = ["read", "write"] as const;

const permissionArbitrary = fc.constantFrom(...PERMISSIONS);
const levelArbitrary = fc.constantFrom(...LEVELS);
const conjunctionArbitrary = fc
  .uniqueArray(permissionArbitrary, {
    minLength: 1,
    maxLength: 3,
  })
  .chain((permissions) =>
    fc
      .array(levelArbitrary, {
        minLength: permissions.length,
        maxLength: permissions.length,
      })
      .map((levels) =>
        permissions.map((permission, index) => ({
          permission,
          level: levels[index]!,
        })),
      ),
  );
const dnfArbitrary = fc.array(conjunctionArbitrary, {
  minLength: 1,
  maxLength: 3,
});
const baselineArbitrary = fc
  .array(fc.tuple(permissionArbitrary, levelArbitrary), { maxLength: 4 })
  .map((entries) => Object.fromEntries(entries) as PermissionAssignment);

const literalSegmentArbitrary = fc.constantFrom(
  "actions",
  "contents",
  "graphql",
  "items",
  "latest",
  "releases",
  "repos",
);
const parameterSegmentArbitrary = fc.constantFrom(
  "{owner}",
  "{repo}",
  "{item_id}",
  "{ref}",
);
const templateArbitrary = fc
  .record({
    catchAll: fc.boolean(),
    prefix: fc.array(
      fc.oneof(literalSegmentArbitrary, parameterSegmentArbitrary),
      { maxLength: 4 },
    ),
  })
  .filter(({ catchAll, prefix }) => catchAll || prefix.length > 0)
  .map(({ catchAll, prefix }) =>
    `/${[...prefix, ...(catchAll ? ["{path}"] : [])].join("/")}`,
  );
const catalogEntryArbitrary = fc.record({
  method: fc.constantFrom("DELETE", "GET", "get", "POST", "PUT"),
  template: templateArbitrary,
});
const concreteSegmentArbitrary = fc.constantFrom(
  "42",
  "actions",
  "contents",
  "graphql",
  "items",
  "latest",
  "owner-name",
  "repo.name",
);
const methodInputArbitrary = fc.oneof(
  fc.constantFrom("DELETE", "GET", "get", "POST", "TRACE"),
  fc.constant(null),
  fc.constant(42),
);

describe("deterministic oracle assurance", () => {
  it("matches exhaustive permission-lattice solving, including baselines", () => {
    fc.assert(
      fc.property(
        fc.array(dnfArbitrary, { maxLength: 4 }),
        baselineArbitrary,
        (alternatives, baseline) => {
          const requirements = alternatives.map((dnf, index) =>
            requirement(index, dnf),
          );

          expect(
            solvePermissionContract(requirements, { baseline }),
          ).toEqual(bruteForceSolve(requirements, baseline));
        },
      ),
      { numRuns: 160, seed: PROPERTY_SEED },
    );
  });

  it("matches a reference URL parser and brute-force route matcher", () => {
    fc.assert(
      fc.property(
        fc.record({
          entries: fc.array(catalogEntryArbitrary, { maxLength: 10 }),
          ambiguous: fc.boolean(),
          catchAll: fc.boolean(),
          form: fc.constantFrom("request", "string", "url"),
          mask: fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }),
          method: methodInputArbitrary,
          origin: fc.constantFrom(
            "https://api.github.com",
            "https://example.com",
          ),
          path: fc.array(concreteSegmentArbitrary, {
            minLength: 1,
            maxLength: 6,
          }),
          trailingSlash: fc.boolean(),
        }),
        ({
          ambiguous,
          catchAll,
          entries: noise,
          form,
          mask,
          method,
          origin,
          path,
          trailingSlash,
        }) => {
          const href = `${origin}/${path.join("/")}${trailingSlash ? "/" : ""}?probe=1#fragment`;
          const input = requestInput(form, href);
          const matchingTemplate = templateForPath(path, mask, catchAll, false);
          const catalogMethod = typeof method === "string" ? method : "GET";
          const entries = [
            { method: catalogMethod, template: matchingTemplate },
            ...(ambiguous
              ? [
                  {
                    method: catalogMethod,
                    template: templateForPath(path, mask, catchAll, true),
                  },
                ]
              : []),
            ...noise,
          ];

          expect(resolveRuntimeRoute(method, input, entries)).toEqual(
            bruteForceRouteResolution(method, input, entries),
          );
        },
      ),
      { numRuns: 300, seed: PROPERTY_SEED },
    );
  });

  it("matches bounded parser rejection for arbitrary URL-shaped input", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ maxLength: 500 }),
          fc.constant("x".repeat(8_193)),
          fc.integer(),
          fc.constant(null),
        ),
        (input) => {
          expect(resolveRuntimeRoute("GET", input, [])).toEqual(
            bruteForceRouteResolution("GET", input, []),
          );
        },
      ),
      { numRuns: 200, seed: PROPERTY_SEED },
    );
  });

  it("matches a segment-by-segment safe-template parser", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string({ maxLength: 300 }), templateArbitrary),
        (value) => {
          expect(isSyntacticallySafeTemplate(value)).toBe(
            referenceSafeTemplate(value),
          );
        },
      ),
      { numRuns: 500, seed: PROPERTY_SEED },
    );
  });
});

function requirement(
  index: number,
  alternatives: PermissionDNF,
): RouteRequirement {
  return {
    route: { method: "GET", template: `/oracle/${String(index)}` },
    alternatives,
    evidence: ["runtime_header"],
    scenarioEvidence: { oracle: ["runtime_header"] },
    scenarios: ["oracle"],
  };
}

function bruteForceSolve(
  requirements: RouteRequirement[],
  baseline: PermissionAssignment,
): ReturnType<typeof solvePermissionContract> {
  const satisfying = enumerateAssignments().filter(
    (assignment) =>
      extendsBaseline(assignment, baseline) &&
      requirements.every((candidate) =>
        referenceSatisfiesDNF(assignment, candidate.alternatives),
      ),
  );
  const frontier = satisfying
    .filter(
      (candidate) =>
        !satisfying.some((other) => referenceDominates(other, candidate)),
    )
    .sort(compareReferenceAssignments);

  return {
    selected: removeReferenceBaseline(frontier[0]!, baseline),
    frontier: frontier.map((assignment) =>
      removeReferenceBaseline(assignment, baseline),
    ),
  };
}

function enumerateAssignments(): PermissionAssignment[] {
  let assignments: PermissionAssignment[] = [{}];
  for (const permission of PERMISSIONS) {
    assignments = assignments.flatMap((assignment) => [
      assignment,
      ...LEVELS.map((level) => ({ ...assignment, [permission]: level })),
    ]);
  }
  return assignments;
}

function extendsBaseline(
  assignment: PermissionAssignment,
  baseline: PermissionAssignment,
): boolean {
  return Object.entries(baseline).every(
    ([permission, level]) =>
      referenceLevel(assignment[permission]) >= referenceLevel(level),
  );
}

function referenceSatisfiesDNF(
  assignment: PermissionAssignment,
  dnf: PermissionDNF,
): boolean {
  return dnf.some((conjunction) =>
    conjunction.every(
      (term) =>
        referenceLevel(assignment[term.permission]) >=
        referenceLevel(term.level),
    ),
  );
}

function referenceDominates(
  candidate: PermissionAssignment,
  other: PermissionAssignment,
): boolean {
  let strictlyLower = false;
  for (const permission of PERMISSIONS) {
    const comparison =
      referenceLevel(candidate[permission]) -
      referenceLevel(other[permission]);
    if (comparison > 0) {
      return false;
    }
    strictlyLower ||= comparison < 0;
  }
  return strictlyLower;
}

function compareReferenceAssignments(
  left: PermissionAssignment,
  right: PermissionAssignment,
): number {
  const writeDifference =
    countReferenceWrites(left) - countReferenceWrites(right);
  if (writeDifference !== 0) {
    return writeDifference;
  }
  const weightDifference = referenceWeight(left) - referenceWeight(right);
  if (weightDifference !== 0) {
    return weightDifference;
  }
  const widthDifference = Object.keys(left).length - Object.keys(right).length;
  if (widthDifference !== 0) {
    return widthDifference;
  }
  const leftKey = referenceAssignmentKey(left);
  const rightKey = referenceAssignmentKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function countReferenceWrites(assignment: PermissionAssignment): number {
  return Object.values(assignment).filter((level) => level === "write").length;
}

function referenceWeight(assignment: PermissionAssignment): number {
  return Object.values(assignment).reduce(
    (total, level) => total + (level === "write" ? 4 : 1),
    0,
  );
}

function referenceAssignmentKey(assignment: PermissionAssignment): string {
  return Object.entries(assignment)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([permission, level]) => `${permission}=${level}`)
    .join(",");
}

function removeReferenceBaseline(
  assignment: PermissionAssignment,
  baseline: PermissionAssignment,
): PermissionAssignment {
  return Object.fromEntries(
    Object.entries(assignment).filter(
      ([permission, level]) =>
        referenceLevel(level) > referenceLevel(baseline[permission]),
    ),
  ) as PermissionAssignment;
}

function referenceLevel(level: PermissionLevel | undefined): number {
  return level === undefined ? 0 : level === "read" ? 1 : 2;
}

function requestInput(form: string, href: string): string | URL | Request {
  if (form === "url") {
    return new URL(href);
  }
  if (form === "request") {
    return new Request(href);
  }
  return href;
}

function bruteForceRouteResolution(
  methodInput: unknown,
  urlInput: unknown,
  entries: readonly Pick<CatalogEntry, "method" | "template">[],
): RuntimeRouteResolution {
  const url = referenceParseUrl(urlInput);
  if (url === null || url.origin !== "https://api.github.com") {
    return { kind: "ignored" };
  }

  const method = referenceSafeMethod(methodInput);
  if (method === "UNKNOWN") {
    return { kind: "unresolved", method, reason: "unresolved_route" };
  }
  if (url.pathname === "/graphql" || url.pathname.endsWith("/graphql")) {
    return { kind: "unresolved", method, reason: "unsupported_api" };
  }

  const matches = entries.flatMap((entry) => {
    if (entry.method.toUpperCase() !== method) {
      return [];
    }
    const score = referenceTemplateScore(entry.template, url.pathname);
    return score === null ? [] : [{ entry, ...score }];
  });
  if (matches.length === 0) {
    return { kind: "unresolved", method, reason: "unresolved_route" };
  }

  matches.sort((left, right) =>
    right.literals !== left.literals
      ? right.literals - left.literals
      : left.catchAlls - right.catchAlls,
  );
  const best = matches[0]!;
  const tied = matches.filter(
    (match) =>
      match.literals === best.literals &&
      match.catchAlls === best.catchAlls,
  );
  return tied.length === 1
    ? {
        kind: "resolved",
        route: { method, template: best.entry.template },
      }
    : { kind: "unresolved", method, reason: "unresolved_route" };
}

function referenceParseUrl(input: unknown): URL | null {
  let value: string;
  if (typeof input === "string") {
    value = input;
  } else if (input instanceof URL) {
    value = input.href;
  } else if (typeof Request !== "undefined" && input instanceof Request) {
    value = input.url;
  } else {
    return null;
  }

  if (value.length > 8_192) {
    return null;
  }
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function referenceSafeMethod(input: unknown): string {
  if (typeof input !== "string") {
    return "UNKNOWN";
  }
  const method = input.toUpperCase();
  return ["DELETE", "GET", "HEAD", "PATCH", "POST", "PUT"].includes(method)
    ? method
    : "UNKNOWN";
}

function templateForPath(
  path: string[],
  mask: boolean[],
  catchAll: boolean,
  alternateNames: boolean,
): string {
  const prefix = catchAll ? path.slice(0, -1) : path;
  const segments = prefix.map((segment, index) => {
    if (mask[index % mask.length]) {
      return segment;
    }
    return alternateNames
      ? index % 2 === 0
        ? "{item_id}"
        : "{ref}"
      : index % 2 === 0
        ? "{owner}"
        : "{repo}";
  });
  if (catchAll) {
    segments.push("{path}");
  }
  return `/${segments.join("/")}`;
}

function referenceTemplateScore(
  template: string,
  concretePath: string,
): { literals: number; catchAlls: number } | null {
  if (
    concretePath.length === 0 ||
    concretePath.length > 4_096 ||
    concretePath.includes("\\")
  ) {
    return null;
  }

  const expected = pathSegments(template);
  const actual = pathSegments(concretePath);
  let actualIndex = 0;
  let literals = 0;
  let catchAlls = 0;

  for (const [expectedIndex, segment] of expected.entries()) {
    if (segment === "{path}") {
      if (
        expectedIndex !== expected.length - 1 ||
        actualIndex >= actual.length
      ) {
        return null;
      }
      catchAlls += 1;
      actualIndex = actual.length;
      continue;
    }

    const concreteSegment = actual[actualIndex];
    if (concreteSegment === undefined || concreteSegment.length === 0) {
      return null;
    }
    if (/^\{[a-z][a-z0-9_]*\}$/u.test(segment)) {
      actualIndex += 1;
      continue;
    }
    if (segment !== concreteSegment) {
      return null;
    }
    literals += 1;
    actualIndex += 1;
  }

  return actualIndex === actual.length ? { literals, catchAlls } : null;
}

function pathSegments(path: string): string[] {
  return path.startsWith("/") ? path.slice(1).split("/") : [];
}

function referenceSafeTemplate(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 256 ||
    !value.startsWith("/") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("\\") ||
    value.includes("//") ||
    value.includes("..") ||
    !value.includes("{")
  ) {
    return false;
  }

  return value
    .slice(1)
    .split("/")
    .every(
      (segment) =>
        /^[a-zA-Z][a-zA-Z0-9._~-]*$/u.test(segment) ||
        /^\{[a-z][a-z0-9_]*\}$/u.test(segment),
    );
}

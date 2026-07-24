import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  assignmentKey,
  assignmentSatisfiesTerm,
  assignmentSatisfiesDNF,
  canonicalDNFKey,
} from "../../src/permissions/canonical.js";
import {
  parseAcceptedPermissionsHeader,
  PermissionEvidenceError,
} from "../../src/permissions/header.js";
import {
  assignmentDominates,
  joinConjunction,
  pruneDominated,
  solvePermissionContract,
} from "../../src/permissions/solver.js";
import { fixtureCatalog } from "../../src/evidence/catalog.js";
import { resolveSafeRoute } from "../../src/routes/canonical.js";
import type {
  PermissionAssignment,
  PermissionDNF,
  RouteRequirement,
} from "../../src/permissions/types.js";

const permissionArbitrary = fc.constantFrom(
  "actions",
  "contents",
  "issues",
  "pull_requests",
);
const levelArbitrary = fc.constantFrom<"read" | "write">("read", "write");
const conjunctionArbitrary = fc
  .array(
    fc.record({
      permission: permissionArbitrary,
      level: levelArbitrary,
    }),
    { minLength: 1, maxLength: 4 },
  )
  .filter((terms) => {
    const levels = new Map<string, string>();
    for (const term of terms) {
      const previous = levels.get(term.permission);
      if (previous !== undefined && previous !== term.level) {
        return false;
      }
      levels.set(term.permission, term.level);
    }
    return true;
  });
const dnfArbitrary = fc.array(conjunctionArbitrary, {
  minLength: 1,
  maxLength: 4,
});

describe("permission engine properties", () => {
  it("canonical header parsing is idempotent", () => {
    fc.assert(
      fc.property(dnfArbitrary, (dnf) => {
        const header = toHeader(dnf);
        const first = parseAcceptedPermissionsHeader(header);
        const second = parseAcceptedPermissionsHeader(canonicalDNFKey(first));
        expect(second).toEqual(first);
      }),
    );
  });

  it("route input ordering cannot change the selected assignment", () => {
    fc.assert(
      fc.property(
        fc.array(dnfArbitrary, { minLength: 1, maxLength: 5 }),
        (alternatives) => {
          const requirements = alternatives.map((dnf, index) =>
            requirement(`/route-${String(index)}`, dnf),
          );
          const forward = solvePermissionContract(requirements).selected;
          const reverse = solvePermissionContract(
            [...requirements].reverse(),
          ).selected;
          expect(reverse).toEqual(forward);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("every selected assignment satisfies every route", () => {
    fc.assert(
      fc.property(
        fc.array(dnfArbitrary, { minLength: 1, maxLength: 5 }),
        (alternatives) => {
          const requirements = alternatives.map((dnf, index) =>
            requirement(`/route-${String(index)}`, dnf),
          );
          const selected = solvePermissionContract(requirements).selected;
          for (const route of requirements) {
            expect(
              assignmentSatisfiesDNF(selected, route.alternatives),
            ).toBe(true);
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it("dominance pruning leaves a dominating representative", () => {
    fc.assert(
      fc.property(
        fc.array(dnfArbitrary, { minLength: 1, maxLength: 4 }),
        (alternatives) => {
          let candidates: PermissionAssignment[] = [{}];
          for (const dnf of alternatives) {
            const combined = new Map<string, PermissionAssignment>();
            for (const candidate of candidates) {
              for (const conjunction of dnf) {
                const joined = joinConjunction(candidate, conjunction);
                combined.set(assignmentKey(joined), joined);
              }
            }
            candidates = [...combined.values()];
          }

          const pruned = pruneDominated(candidates);
          expect(pruned.length).toBeGreaterThan(0);
          for (const candidate of candidates) {
            if (pruned.some((kept) => assignmentKey(kept) === assignmentKey(candidate))) {
              continue;
            }
            expect(
              pruned.some((kept) => assignmentDominates(kept, candidate)),
            ).toBe(true);
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it("raising read to write cannot make a satisfied term fail", () => {
    fc.assert(
      fc.property(permissionArbitrary, (permission) => {
        const term = { permission, level: "read" as const };
        expect(
          assignmentSatisfiesTerm({ [permission]: "read" }, term),
        ).toBe(true);
        expect(
          assignmentSatisfiesTerm({ [permission]: "write" }, term),
        ).toBe(true);
      }),
    );
  });

  it("arbitrary malformed evidence fails with a safe typed error", () => {
    fc.assert(
      fc.property(fc.string(), (suffix) => {
        const input = `SECRET_CANARY_${suffix}`;
        try {
          parseAcceptedPermissionsHeader(input);
          throw new Error("Expected malformed permission evidence.");
        } catch (error) {
          expect(error).toBeInstanceOf(PermissionEvidenceError);
          expect(String(error)).not.toContain(input);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("arbitrary concrete URL material is not retained on rejection", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 80 }), (secret) => {
        const candidate = `https://basic-user:basic-password@api.github.com/repos/${encodeURIComponent(secret)}/private?token=${encodeURIComponent(secret)}`;
        const resolution = resolveSafeRoute("GET", candidate, fixtureCatalog);
        expect(resolution.kind).toBe("unresolved");
        expect(JSON.stringify(resolution)).not.toContain(candidate);
      }),
      { numRuns: 100 },
    );
  });
});

function toHeader(dnf: PermissionDNF): string {
  return dnf
    .map((conjunction) =>
      conjunction
        .map((term) => `${term.permission}=${term.level}`)
        .join(","),
    )
    .join(";");
}

function requirement(
  template: string,
  alternatives: PermissionDNF,
): RouteRequirement {
  return {
    route: { method: "GET", template },
    alternatives,
    evidence: ["runtime_header"],
    scenarioEvidence: { "property-test": ["runtime_header"] },
    scenarios: ["property-test"],
  };
}

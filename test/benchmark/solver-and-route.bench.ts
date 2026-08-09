import { bench, describe } from "vitest";

import { solvePermissionContract } from "../../src/permissions/solver.js";
import type { RouteRequirement } from "../../src/permissions/types.js";
import { resolveRuntimeRoute } from "../../src/runtime/route.js";

const solverRequirements: RouteRequirement[] = Array.from(
  { length: 6 },
  (_, routeIndex): RouteRequirement => ({
    route: { method: "GET", template: `/benchmark/${String(routeIndex)}` },
    alternatives: Array.from({ length: 3 }, (_, alternativeIndex) => [
      {
        permission: `permission_${String((routeIndex + alternativeIndex) % 8)}`,
        level: (routeIndex + alternativeIndex) % 4 === 0 ? "write" : "read",
      },
    ]),
    evidence: ["runtime_header"],
    scenarioEvidence: { benchmark: ["runtime_header"] },
    scenarios: ["benchmark"],
  }),
);

const solverOptions = {
  iterations: 100,
  time: 0,
  warmupIterations: 10,
  warmupTime: 0,
};
const routeOptions = {
  iterations: 500,
  time: 0,
  warmupIterations: 50,
  warmupTime: 0,
};

describe("bounded permission and route measurements", () => {
  bench(
    "solve 6 routes with 3 alternatives each",
    () => {
      solvePermissionContract(solverRequirements);
    },
    solverOptions,
  );

  bench(
    "parse and match one URL against the pinned catalog",
    () => {
      resolveRuntimeRoute(
        "POST",
        "https://api.github.com/repos/benchmark-owner/benchmark-repo/issues/42/comments?ignored=1",
      );
    },
    routeOptions,
  );
});

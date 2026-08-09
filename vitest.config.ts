import { defineConfig } from "vitest/config";

const permissionFileThresholds = {
  branches: 75,
  functions: 90,
  lines: 85,
  statements: 85,
};
const routeFileThresholds = {
  branches: 75,
  functions: 90,
  lines: 85,
  statements: 85,
};
const securityFileThresholds = {
  branches: 60,
  functions: 75,
  lines: 70,
  statements: 70,
};

export default defineConfig({
  test: {
    benchmark: {
      include: ["test/benchmark/**/*.bench.ts"],
    },
    clearMocks: true,
    coverage: {
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 65,
        functions: 85,
        lines: 75,
        statements: 75,
        "src/permissions/canonical.ts": permissionFileThresholds,
        "src/permissions/header.ts": permissionFileThresholds,
        "src/permissions/schema.ts": permissionFileThresholds,
        "src/permissions/solver.ts": permissionFileThresholds,
        "src/routes/canonical.ts": routeFileThresholds,
        "src/runtime/route.ts": routeFileThresholds,
        "src/security/bounded-file.ts": securityFileThresholds,
        "src/security/local-state.ts": securityFileThresholds,
        "src/security/managed-child.ts": securityFileThresholds,
        "src/security/private-key-provider.ts": securityFileThresholds,
        "src/security/proof-environment.ts": securityFileThresholds,
        "src/security/review-text.ts": securityFileThresholds,
        "src/security/sensitive-value.ts": securityFileThresholds,
      },
    },
    environment: "node",
    include: ["test/**/*.test.ts"],
    restoreMocks: true,
    testTimeout: 15_000,
  },
});

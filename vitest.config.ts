import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
      },
    },
    environment: "node",
    include: ["test/**/*.test.ts"],
    restoreMocks: true,
    testTimeout: 15_000,
  },
});

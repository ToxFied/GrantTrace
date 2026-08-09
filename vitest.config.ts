import { defineConfig } from "vitest/config";

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
        "src/permissions/{canonical,header,schema,solver}.ts": {
          branches: 75,
          functions: 90,
          lines: 85,
          perFile: true,
          statements: 85,
        },
        "src/{routes/canonical,runtime/route}.ts": {
          branches: 75,
          functions: 90,
          lines: 85,
          perFile: true,
          statements: 85,
        },
        "src/security/*.ts": {
          branches: 60,
          functions: 75,
          lines: 70,
          perFile: true,
          statements: 70,
        },
      },
    },
    environment: "node",
    include: ["test/**/*.test.ts"],
    restoreMocks: true,
    testTimeout: 15_000,
  },
});

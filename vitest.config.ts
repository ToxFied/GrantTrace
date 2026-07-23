import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    coverage: {
      include: ["src/**/*.ts"],
    },
    environment: "node",
    include: ["test/**/*.test.ts"],
    restoreMocks: true,
    testTimeout: 15_000,
  },
});

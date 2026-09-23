import { describe, expect, it } from "vitest";

import { runManagedChild } from "../../src/security/managed-child.js";

describe("managed child cleanup", () => {
  it("reports unverified Windows cleanup after the child exits", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    if (!platform) throw new Error("process.platform is unavailable");
    Object.defineProperty(process, "platform", { ...platform, value: "win32" });
    try {
      const result = await runManagedChild({
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
        cwd: process.cwd(),
        environment: process.env,
        timeoutMs: 5_000,
      });
      expect(result.exitCode).toBe(0);
      expect(result.processTreeCleanupFailed).toBe(true);
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });
});

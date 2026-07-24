import { describe, expect, it } from "vitest";

import { injectRuntimePreload } from "../../src/runtime/injection.js";

describe("runtime preload injection", () => {
  it("preserves existing Node options and appends the GrantTrace preload", () => {
    const source = { NODE_OPTIONS: "--no-warnings", PRIVATE_VALUE: "kept" };

    const result = injectRuntimePreload(source);

    expect(result["NODE_OPTIONS"]).toContain("--no-warnings");
    expect(result["NODE_OPTIONS"]).toContain("--import=");
    expect(result["NODE_OPTIONS"]).toContain("runtime/preload.");
    expect(result["PRIVATE_VALUE"]).toBe("kept");
    expect(source["NODE_OPTIONS"]).toBe("--no-warnings");
  });
});

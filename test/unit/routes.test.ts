import { describe, expect, it } from "vitest";

import { fixtureCatalog } from "../../src/evidence/catalog.js";
import { resolveSafeRoute } from "../../src/routes/canonical.js";

describe("safe route resolution", () => {
  it("accepts an exact pinned route template", () => {
    expect(
      resolveSafeRoute(
        "post",
        "/repos/{owner}/{repo}/issues/{issue_number}/comments",
        fixtureCatalog,
      ),
    ).toEqual({
      kind: "resolved",
      route: {
        method: "POST",
        template:
          "/repos/{owner}/{repo}/issues/{issue_number}/comments",
      },
    });
  });

  it.each([
    "https://api.github.com/repos/acme/private/issues/1/comments",
    "/repos/acme/private/issues/1/comments",
    "/repos/{owner}/{repo}/issues/{issue_number}/comments?token=secret",
    "/repos/{owner}/{repo}/unknown/{resource_id}",
  ])("rejects rather than retaining concrete or unpinned routes", (url) => {
    const result = resolveSafeRoute("POST", url, fixtureCatalog);
    expect(result.kind).toBe("unresolved");
    expect(JSON.stringify(result)).not.toContain(url);
  });

  it("classifies GraphQL explicitly", () => {
    expect(resolveSafeRoute("POST", "/graphql", fixtureCatalog)).toEqual({
      kind: "unresolved",
      method: "POST",
      reason: "unsupported_api",
    });
  });
});

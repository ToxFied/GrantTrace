import { describe, expect, it } from "vitest";

import type { CatalogEntry } from "../../src/evidence/catalog.js";
import { resolveRuntimeRoute } from "../../src/runtime/route.js";

describe("runtime GitHub REST route resolution", () => {
  it("maps a concrete GitHub URL to its canonical pinned template", () => {
    expect(
      resolveRuntimeRoute(
        "post",
        "https://api.github.com/repos/secret-owner/secret-repo/issues/42/comments?token=secret",
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

  it("supports multi-segment repository content paths", () => {
    expect(
      resolveRuntimeRoute(
        "GET",
        new URL(
          "https://api.github.com/repos/secret-owner/secret-repo/contents/src/nested/private.ts",
        ),
      ),
    ).toEqual({
      kind: "resolved",
      route: {
        method: "GET",
        template: "/repos/{owner}/{repo}/contents/{path}",
      },
    });
  });

  it("prefers a literal endpoint over an equally shaped placeholder", () => {
    expect(
      resolveRuntimeRoute(
        "GET",
        "https://api.github.com/repos/owner/repo/releases/latest",
      ),
    ).toEqual({
      kind: "resolved",
      route: {
        method: "GET",
        template: "/repos/{owner}/{repo}/releases/latest",
      },
    });
  });

  it("fails closed when two catalog templates are equally specific", () => {
    const entries = [
      route("/repos/{owner}/{repo}/things/{thing_id}"),
      route("/repos/{account}/{project}/things/{item_id}"),
    ];

    expect(
      resolveRuntimeRoute(
        "GET",
        "https://api.github.com/repos/private/private/things/42",
        entries,
      ),
    ).toEqual({
      kind: "unresolved",
      method: "GET",
      reason: "unresolved_route",
    });
  });

  it("ignores non-GitHub origins and fails closed for unknown GitHub REST paths", () => {
    expect(
      resolveRuntimeRoute(
        "GET",
        "https://example.com/repos/owner/repo/issues",
      ),
    ).toEqual({ kind: "ignored" });
    expect(
      resolveRuntimeRoute(
        "GET",
        "https://api.github.com/user/private-identity",
      ),
    ).toEqual({
      kind: "unresolved",
      method: "GET",
      reason: "unresolved_route",
    });
  });

  it("classifies GitHub GraphQL without retaining the URL", () => {
    const result = resolveRuntimeRoute(
      "POST",
      "https://api.github.com/graphql?query=private",
    );
    expect(result).toEqual({
      kind: "unresolved",
      method: "POST",
      reason: "unsupported_api",
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });
});

function route(template: string): Pick<CatalogEntry, "method" | "template"> {
  return { method: "GET", template };
}

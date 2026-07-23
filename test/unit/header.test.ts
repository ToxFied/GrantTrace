import { describe, expect, it } from "vitest";

import {
  parseAcceptedPermissionsHeader,
  PermissionEvidenceError,
} from "../../src/permissions/header.js";

describe("parseAcceptedPermissionsHeader", () => {
  it("parses GitHub's documented single requirement", () => {
    expect(parseAcceptedPermissionsHeader("contents=read")).toEqual([
      [{ permission: "contents", level: "read" }],
    ]);
  });

  it("parses GitHub's documented AND conjunction", () => {
    expect(
      parseAcceptedPermissionsHeader(
        "pull_requests=write,contents=read",
      ),
    ).toEqual([
      [
        { permission: "contents", level: "read" },
        { permission: "pull_requests", level: "write" },
      ],
    ]);
  });

  it("preserves GitHub's documented OR-of-AND alternatives", () => {
    expect(
      parseAcceptedPermissionsHeader(
        "pull_requests=read,contents=read; issues=read,contents=read",
      ),
    ).toEqual([
      [
        { permission: "contents", level: "read" },
        { permission: "issues", level: "read" },
      ],
      [
        { permission: "contents", level: "read" },
        { permission: "pull_requests", level: "read" },
      ],
    ]);
  });

  it("canonicalizes whitespace, terms, alternatives, and exact duplicates", () => {
    expect(
      parseAcceptedPermissionsHeader(
        " issues=write, issues=write ; contents=read ; contents=read ",
      ),
    ).toEqual([
      [{ permission: "contents", level: "read" }],
      [{ permission: "issues", level: "write" }],
    ]);
  });

  it.each([
    "",
    ";",
    "contents=read;",
    "contents=read,,issues=read",
    "contents",
    "=read",
    "Contents=read",
    "contents=admin",
    "contents=read=write",
    "contents=read,contents=write",
  ])("fails closed for malformed input without echoing it: %s", (value) => {
    expect(() => parseAcceptedPermissionsHeader(value)).toThrow(
      PermissionEvidenceError,
    );
    try {
      parseAcceptedPermissionsHeader(value);
    } catch (error) {
      expect(String(error)).not.toContain(value || "canary-that-is-not-present");
    }
  });
});

import { createHash } from "node:crypto";

import { compareAscii } from "../deterministic.js";
import { canonicalDNFKey, canonicalizeDNF } from "../permissions/canonical.js";
import type {
  CanonicalRoute,
  PermissionDNF,
} from "../permissions/types.js";

export type CatalogIdentity = {
  source: string;
  version: string;
  checksum: `sha256:${string}`;
};

export interface PermissionCatalog {
  readonly identity: CatalogIdentity;
  has(route: CanonicalRoute): boolean;
  lookup(route: CanonicalRoute): PermissionDNF | null;
}

export type CatalogEntry = {
  method: string;
  template: string;
  alternatives: PermissionDNF;
  documentation: string;
};

const docs = (path: string, anchor: string): string =>
  `https://docs.github.com/en/rest/${path}?apiVersion=2026-03-10#${anchor}`;
const term = (permission: string, level: "read" | "write"): PermissionDNF => [
  [{ permission, level }],
];
const issueOrPull = (level: "read" | "write"): PermissionDNF => [
  [{ permission: "issues", level }],
  [{ permission: "pull_requests", level }],
];

/**
 * Curated from GitHub's official "Permissions required for GitHub Apps"
 * reference and the linked endpoint pages, accessed 2026-07-23. Routes whose
 * "additional permissions" relationship is conditional or ambiguous are
 * excluded unless the endpoint page explicitly documents its AND/OR shape.
 */
export const GITHUB_REST_CATALOG_ENTRIES: readonly CatalogEntry[] = [
  // Repository metadata (satisfied by GitHub's mandatory metadata:read baseline).
  {
    method: "GET",
    template: "/repos/{owner}/{repo}",
    alternatives: term("metadata", "read"),
    documentation: docs("repos/repos", "get-a-repository"),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/contributors",
    alternatives: term("metadata", "read"),
    documentation: docs("repos/repos", "list-repository-contributors"),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/languages",
    alternatives: term("metadata", "read"),
    documentation: docs("repos/repos", "list-repository-languages"),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/tags",
    alternatives: term("metadata", "read"),
    documentation: docs("repos/repos", "list-repository-tags"),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/topics",
    alternatives: term("metadata", "read"),
    documentation: docs("repos/repos", "get-all-repository-topics"),
  },

  // Issues and issue comments.
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/issues",
    alternatives: term("issues", "read"),
    documentation: docs("issues/issues", "list-repository-issues"),
  },
  {
    method: "POST",
    template: "/repos/{owner}/{repo}/issues",
    alternatives: term("issues", "write"),
    documentation: docs("issues/issues", "create-an-issue"),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/issues/{issue_number}",
    alternatives: term("issues", "read"),
    documentation: docs("issues/issues", "get-an-issue"),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/issues/comments",
    alternatives: issueOrPull("read"),
    documentation: docs(
      "issues/comments",
      "list-issue-comments-for-a-repository",
    ),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/issues/comments/{comment_id}",
    alternatives: issueOrPull("read"),
    documentation: docs("issues/comments", "get-an-issue-comment"),
  },
  {
    method: "PATCH",
    template: "/repos/{owner}/{repo}/issues/comments/{comment_id}",
    alternatives: issueOrPull("write"),
    documentation: docs("issues/comments", "update-an-issue-comment"),
  },
  {
    method: "DELETE",
    template: "/repos/{owner}/{repo}/issues/comments/{comment_id}",
    alternatives: issueOrPull("write"),
    documentation: docs("issues/comments", "delete-an-issue-comment"),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/issues/{issue_number}/comments",
    alternatives: issueOrPull("read"),
    documentation: docs("issues/comments", "list-issue-comments"),
  },
  {
    method: "POST",
    template: "/repos/{owner}/{repo}/issues/{issue_number}/comments",
    alternatives: issueOrPull("write"),
    documentation: docs("issues/comments", "create-an-issue-comment"),
  },

  // Pull requests, review comments, and reviews.
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/pulls",
    alternatives: term("pull_requests", "read"),
    documentation: docs("pulls/pulls", "list-pull-requests"),
  },
  {
    method: "POST",
    template: "/repos/{owner}/{repo}/pulls",
    alternatives: term("pull_requests", "write"),
    documentation: docs("pulls/pulls", "create-a-pull-request"),
  },
  {
    method: "PATCH",
    template: "/repos/{owner}/{repo}/pulls/{pull_number}",
    alternatives: term("pull_requests", "write"),
    documentation: docs("pulls/pulls", "update-a-pull-request"),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/pulls/comments",
    alternatives: term("pull_requests", "read"),
    documentation: docs(
      "pulls/comments",
      "list-review-comments-in-a-repository",
    ),
  },
  {
    method: "POST",
    template: "/repos/{owner}/{repo}/pulls/{pull_number}/comments",
    alternatives: term("pull_requests", "write"),
    documentation: docs(
      "pulls/comments",
      "create-a-review-comment-for-a-pull-request",
    ),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/pulls/{pull_number}/reviews",
    alternatives: term("pull_requests", "read"),
    documentation: docs("pulls/reviews", "list-reviews-for-a-pull-request"),
  },
  {
    method: "POST",
    template: "/repos/{owner}/{repo}/pulls/{pull_number}/reviews",
    alternatives: term("pull_requests", "write"),
    documentation: docs("pulls/reviews", "create-a-review-for-a-pull-request"),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}",
    alternatives: term("pull_requests", "read"),
    documentation: docs("pulls/reviews", "get-a-review-for-a-pull-request"),
  },
  {
    method: "POST",
    template:
      "/repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/events",
    alternatives: term("pull_requests", "write"),
    documentation: docs("pulls/reviews", "submit-a-review-for-a-pull-request"),
  },

  // Repository contents.
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/contents/{path}",
    alternatives: term("contents", "read"),
    documentation: docs("repos/contents", "get-repository-content"),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/readme",
    alternatives: term("contents", "read"),
    documentation: docs("repos/contents", "get-a-repository-readme"),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/commits",
    alternatives: term("contents", "read"),
    documentation: docs("commits/commits", "list-commits"),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/commits/{ref}",
    alternatives: term("contents", "read"),
    documentation: docs("commits/commits", "get-a-commit"),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/git/trees/{tree_sha}",
    alternatives: term("contents", "read"),
    documentation: docs("git/trees", "get-a-tree"),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/branches",
    alternatives: term("contents", "read"),
    documentation: docs("branches/branches", "list-branches"),
  },

  // Actions and workflows.
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/actions/workflows",
    alternatives: term("actions", "read"),
    documentation: docs("actions/workflows", "list-repository-workflows"),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/actions/workflows/{workflow_id}",
    alternatives: term("actions", "read"),
    documentation: docs("actions/workflows", "get-a-workflow"),
  },
  {
    method: "POST",
    template:
      "/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches",
    alternatives: term("actions", "write"),
    documentation: docs(
      "actions/workflows",
      "create-a-workflow-dispatch-event",
    ),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/actions/runs",
    alternatives: term("actions", "read"),
    documentation: docs(
      "actions/workflow-runs",
      "list-workflow-runs-for-a-repository",
    ),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/actions/runs/{run_id}",
    alternatives: term("actions", "read"),
    documentation: docs("actions/workflow-runs", "get-a-workflow-run"),
  },
  {
    method: "POST",
    template: "/repos/{owner}/{repo}/actions/runs/{run_id}/rerun",
    alternatives: term("actions", "write"),
    documentation: docs("actions/workflow-runs", "re-run-a-workflow"),
  },

  // Checks and commit statuses.
  {
    method: "POST",
    template: "/repos/{owner}/{repo}/check-runs",
    alternatives: term("checks", "write"),
    documentation: docs("checks/runs", "create-a-check-run"),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/check-runs/{check_run_id}",
    alternatives: term("checks", "read"),
    documentation: docs("checks/runs", "get-a-check-run"),
  },
  {
    method: "PATCH",
    template: "/repos/{owner}/{repo}/check-runs/{check_run_id}",
    alternatives: term("checks", "write"),
    documentation: docs("checks/runs", "update-a-check-run"),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/check-suites/{check_suite_id}",
    alternatives: term("checks", "read"),
    documentation: docs("checks/suites", "get-a-check-suite"),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/commits/{ref}/check-runs",
    alternatives: term("checks", "read"),
    documentation: docs(
      "checks/runs",
      "list-check-runs-for-a-git-reference",
    ),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/commits/{ref}/status",
    alternatives: term("statuses", "read"),
    documentation: docs(
      "commits/statuses",
      "get-the-combined-status-for-a-specific-reference",
    ),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/commits/{ref}/statuses",
    alternatives: term("statuses", "read"),
    documentation: docs(
      "commits/statuses",
      "list-commit-statuses-for-a-reference",
    ),
  },
  {
    method: "POST",
    template: "/repos/{owner}/{repo}/statuses/{sha}",
    alternatives: term("statuses", "write"),
    documentation: docs("commits/statuses", "create-a-commit-status"),
  },

  // Releases (GitHub documents these under the Contents permission).
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/releases",
    alternatives: term("contents", "read"),
    documentation: docs("releases/releases", "list-releases"),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/releases/latest",
    alternatives: term("contents", "read"),
    documentation: docs("releases/releases", "get-the-latest-release"),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/releases/tags/{tag}",
    alternatives: term("contents", "read"),
    documentation: docs("releases/releases", "get-a-release-by-tag-name"),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/releases/{release_id}",
    alternatives: term("contents", "read"),
    documentation: docs("releases/releases", "get-a-release"),
  },
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/releases/{release_id}/assets",
    alternatives: term("contents", "read"),
    documentation: docs("releases/assets", "list-release-assets"),
  },
  {
    method: "DELETE",
    template: "/repos/{owner}/{repo}/releases/{release_id}",
    alternatives: term("contents", "write"),
    documentation: docs("releases/releases", "delete-a-release"),
  },
] as const;

export class GitHubPermissionCatalog implements PermissionCatalog {
  readonly #requirements: ReadonlyMap<string, PermissionDNF>;
  public readonly identity: CatalogIdentity;

  public constructor(
    entries: readonly CatalogEntry[] = GITHUB_REST_CATALOG_ENTRIES,
    provenance?: Pick<CatalogIdentity, "source" | "version">,
  ) {
    const canonicalEntries = entries
      .map((entry) => ({
        method: entry.method.toUpperCase(),
        template: entry.template,
        alternatives: canonicalizeDNF(entry.alternatives),
        documentation: entry.documentation,
      }))
      .sort((left, right) => compareAscii(routeKey(left), routeKey(right)));

    if (
      new Set(canonicalEntries.map((entry) => routeKey(entry))).size !==
      canonicalEntries.length
    ) {
      throw new Error("The permission catalog contains a duplicate route.");
    }
    if (
      entries !== GITHUB_REST_CATALOG_ENTRIES &&
      provenance === undefined
    ) {
      throw new Error(
        "Custom permission catalogs require explicit source and version provenance.",
      );
    }
    if (
      provenance !== undefined &&
      (!/^[a-z0-9_-]{1,64}$/u.test(provenance.source) ||
        !/^[A-Za-z0-9._-]{1,80}$/u.test(provenance.version))
    ) {
      throw new Error("Permission catalog provenance is invalid.");
    }

    this.#requirements = new Map(
      canonicalEntries.map((entry) => [
        routeKey(entry),
        entry.alternatives,
      ]),
    );

    const catalogPayload = canonicalEntries
      .map(
        (entry) =>
          `${entry.method} ${entry.template} ${canonicalDNFKey(entry.alternatives)} ${entry.documentation}`,
      )
      .join("\n");
    const checksum = createHash("sha256")
      .update(catalogPayload, "utf8")
      .digest("hex");

    this.identity = {
      source: provenance?.source ?? "github-docs",
      version: provenance?.version ?? "2026-03-10.20260723.1",
      checksum: `sha256:${checksum}`,
    };
  }

  public has(route: CanonicalRoute): boolean {
    return this.#requirements.has(routeKey(route));
  }

  public lookup(route: CanonicalRoute): PermissionDNF | null {
    const requirement = this.#requirements.get(routeKey(route));
    return requirement === undefined ? null : canonicalizeDNF(requirement);
  }
}

/** @deprecated Use GitHubPermissionCatalog. Kept for API compatibility. */
export class FixturePermissionCatalog extends GitHubPermissionCatalog {}

export const githubPermissionCatalog = new GitHubPermissionCatalog();
/** @deprecated Use githubPermissionCatalog. */
export const fixtureCatalog = githubPermissionCatalog;

function routeKey(route: Pick<CanonicalRoute, "method" | "template">): string {
  return `${route.method.toUpperCase()} ${route.template}`;
}

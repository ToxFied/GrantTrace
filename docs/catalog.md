---
title: REST coverage
description: See the 49 pinned GitHub REST routes GrantTrace can resolve.
---

GrantTrace ships a curated offline catalog of **49** GitHub REST route
templates for API version `2026-03-10`, reviewed against official GitHub
documentation on 2026-07-23.

Every entry records canonical permission DNF and an official GitHub
documentation URL. The catalog is sorted and hashed; its source, version, and
SHA-256 identity are embedded in every contract. Runtime evidence must agree
with the catalog when both exist.

The catalog is intentionally not generated from
`@octokit/app-permissions`. That package's flattened schema cannot preserve
GitHub's AND/OR alternatives and its published data is stale.

## Included routes

| Area | Count | Routes | Requirement |
| --- | ---: | --- | --- |
| Repository metadata | 5 | `GET /repos/{owner}/{repo}`; contributors; languages; tags; topics | `metadata:read` |
| Issues and comments | 9 | list/create/get issues; repository, item, and per-issue comment reads; update/delete/create comment | `issues:read/write`; comment routes allow `issues` **or** `pull_requests` |
| Pull requests and reviews | 9 | list/create/update pull requests; list/create review comments; list/create/get/submit reviews | `pull_requests:read/write` |
| Repository contents | 6 | contents; README; list/get commits; tree; branches | `contents:read` |
| Actions and workflows | 6 | list/get workflows; dispatch; list/get/rerun workflow runs | `actions:read/write` |
| Checks and statuses | 8 | create/get/update check runs; get check suite; list check runs; combined/list/create statuses | `checks:read/write` or `statuses:read/write` |
| Releases | 6 | list/latest/by-tag/get; list assets; delete release | `contents:read/write` |

The exact canonical templates are:

```text
GET    /repos/{owner}/{repo}
GET    /repos/{owner}/{repo}/contributors
GET    /repos/{owner}/{repo}/languages
GET    /repos/{owner}/{repo}/tags
GET    /repos/{owner}/{repo}/topics

GET    /repos/{owner}/{repo}/issues
POST   /repos/{owner}/{repo}/issues
GET    /repos/{owner}/{repo}/issues/{issue_number}
GET    /repos/{owner}/{repo}/issues/comments
GET    /repos/{owner}/{repo}/issues/comments/{comment_id}
PATCH  /repos/{owner}/{repo}/issues/comments/{comment_id}
DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}
GET    /repos/{owner}/{repo}/issues/{issue_number}/comments
POST   /repos/{owner}/{repo}/issues/{issue_number}/comments

GET    /repos/{owner}/{repo}/pulls
POST   /repos/{owner}/{repo}/pulls
PATCH  /repos/{owner}/{repo}/pulls/{pull_number}
GET    /repos/{owner}/{repo}/pulls/comments
POST   /repos/{owner}/{repo}/pulls/{pull_number}/comments
GET    /repos/{owner}/{repo}/pulls/{pull_number}/reviews
POST   /repos/{owner}/{repo}/pulls/{pull_number}/reviews
GET    /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}
POST   /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/events

GET    /repos/{owner}/{repo}/contents/{path}
GET    /repos/{owner}/{repo}/readme
GET    /repos/{owner}/{repo}/commits
GET    /repos/{owner}/{repo}/commits/{ref}
GET    /repos/{owner}/{repo}/git/trees/{tree_sha}
GET    /repos/{owner}/{repo}/branches

GET    /repos/{owner}/{repo}/actions/workflows
GET    /repos/{owner}/{repo}/actions/workflows/{workflow_id}
POST   /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches
GET    /repos/{owner}/{repo}/actions/runs
GET    /repos/{owner}/{repo}/actions/runs/{run_id}
POST   /repos/{owner}/{repo}/actions/runs/{run_id}/rerun

POST   /repos/{owner}/{repo}/check-runs
GET    /repos/{owner}/{repo}/check-runs/{check_run_id}
PATCH  /repos/{owner}/{repo}/check-runs/{check_run_id}
GET    /repos/{owner}/{repo}/check-suites/{check_suite_id}
GET    /repos/{owner}/{repo}/commits/{ref}/check-runs
GET    /repos/{owner}/{repo}/commits/{ref}/status
GET    /repos/{owner}/{repo}/commits/{ref}/statuses
POST   /repos/{owner}/{repo}/statuses/{sha}

GET    /repos/{owner}/{repo}/releases
GET    /repos/{owner}/{repo}/releases/latest
GET    /repos/{owner}/{repo}/releases/tags/{tag}
GET    /repos/{owner}/{repo}/releases/{release_id}
GET    /repos/{owner}/{repo}/releases/{release_id}/assets
DELETE /repos/{owner}/{repo}/releases/{release_id}
```

## Conditional exclusions

GitHub's permission reference sometimes states that an endpoint may require
additional permissions depending on request fields, repository settings, or
resource state without documenting an unambiguous boolean relationship.
GrantTrace excludes those routes until official evidence supports an exact
AND/OR model.

The current catalog deliberately excludes these otherwise common routes:

```text
PUT   /repos/{owner}/{repo}/contents/{path}
DELETE /repos/{owner}/{repo}/contents/{path}
POST  /repos/{owner}/{repo}/releases
PATCH /repos/{owner}/{repo}/releases/{release_id}
```

GitHub documents ordinary `contents:write` access plus conditional
`workflows:write` when the operation affects `.github/workflows`. A
route-only DNF would collapse that request-dependent condition and overstate
what `contents:write` alone proves, so GrantTrace fails these routes closed.

Other exclusions include:

- endpoints requiring unsupported `admin` access;
- GraphQL and non-REST protocols;
- account, organization, enterprise, and installation-management operations;
- routes whose current Octokit template has not been independently reviewed;
- dangerous mutations added only to increase coverage count; and
- aliases or concrete URL forms that cannot be matched without retaining
  identity-bearing data.

An excluded route fails closed as unresolved. Runtime header evidence alone
does not permit an unknown template, because the safe persistence boundary
requires exact catalog recognition.

## Review workflow

Catalog changes should:

1. use the official endpoint page for API version `2026-03-10`;
2. preserve every documented AND/OR alternative exactly;
3. exclude conditional ambiguity rather than guess;
4. add the canonical Octokit method/template and documentation URL;
5. run `pnpm catalog:review`;
6. add focused evidence, solver, checksum, and contract tests;
7. reproduce the accepted contract twice and compare hashes; and
8. review the resulting catalog identity change like a permission change.

The source entry list is
[`src/evidence/catalog.ts`](../src/evidence/catalog.ts).

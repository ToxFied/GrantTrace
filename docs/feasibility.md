---
title: Platform evidence
description: External evidence behind GrantTrace's protocol constraints.
---

# Platform evidence

Reviewed on **2026-07-23** against GitHub REST API version `2026-03-10`.

This record captures the external platform evidence that shapes GrantTrace's
protocol. It is not a coverage inventory; see the [REST
catalog](/docs/catalog), [protocol](/docs/protocol), and
[limitations](/docs/limitations) for current product behavior.

## Evidence and design consequences

| Evidence | Official source | GrantTrace consequence |
| --- | --- | --- |
| `X-Accepted-GitHub-Permissions` uses commas for permissions required together and semicolons for alternatives. | [GitHub REST troubleshooting](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api?apiVersion=2026-03-10#resource-not-accessible) | Permission requirements are stored as disjunctive normal form. Missing evidence remains distinct from an empty requirement. |
| Installation access tokens can be limited to selected permissions and repositories. | [Generating an installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-an-app) and [REST endpoint reference](https://docs.github.com/en/rest/apps/apps?apiVersion=2026-03-10#create-an-installation-access-token-for-an-app) | Live proof requests a short-lived token for exactly one disposable repository and verifies the effective permission response. |
| GitHub App authentication uses a short-lived RS256 JWT. | [Generating a JSON Web Token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app) | The token broker retains the private key and App identity; the proof child receives only the restricted installation token. |
| REST API behavior is versioned. | [GitHub REST API versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions) | Requests, catalog entries, contracts, and proof reports pin API version `2026-03-10`. A version change requires contract review. |
| Node exposes standards-compatible global `fetch` backed by Undici. | [Node.js global `fetch`](https://nodejs.org/api/globals.html#fetch) | `record` can inject a preload and observe standard Node fetch traffic without requiring an application source edit. Requests are still accepted only after safe pinned-catalog resolution. |
| Octokit exposes request lifecycle hooks before URL expansion. | [`@octokit/core` hooks](https://github.com/octokit/core.js/blob/951bd353a4e31f7b8bf56245dcdd6631634b4765/README.md#hooks) and [`@octokit/request` merge path](https://github.com/octokit/request.js/blob/554e1029c40181a73939e6e9c265a72c7cf510ad/src/with-defaults.ts) | GrantTrace records only a validated canonical route template, method, status, and parsed permission evidence. Concrete URLs and rich request or response objects are never persisted. |
| GitHub permission data can contain alternatives and request-dependent conditions. | [Create an issue comment](https://docs.github.com/en/rest/issues/comments?apiVersion=2026-03-10#create-an-issue-comment) and [Create or update file contents](https://docs.github.com/en/rest/repos/contents?apiVersion=2026-03-10#create-or-update-file-contents) | The catalog models exact AND/OR alternatives and excludes routes whose conditional requirements cannot be represented safely from route identity alone. |

## Verified protocol boundaries

- Runtime evidence and the pinned catalog must agree when both are present.
- An unknown route, malformed header, unsupported access level, or evidence
  conflict blocks the contract.
- `metadata:read` is modeled separately as GitHub's mandatory installation
  baseline.
- Live proof requires the token response to report the requested permissions,
  mandatory baseline, one expected repository, and a plausible expiry.
- A failed or indeterminate scenario is never treated as evidence that a
  permission is unnecessary.
- Cleanup is reported independently and must succeed before a live proof can
  pass.

Authenticated validation used a dedicated disposable installation. This record
retains only identity-free conclusions; it contains no credential, repository,
resource identifier, raw URL, response body, or token.

# GrantTrace feasibility record

Access date for every source below: **2026-07-23**.

This is a historical research snapshot of the original fixture-backed
milestones, not the current product inventory. It preserves the platform
evidence and design decisions that the public-beta implementation builds on.
For current behavior, read the [protocol](protocol.md), [catalog
coverage](catalog.md), and [limitations](limitations.md).

Authenticated calls are described only as identity-free conclusions. No
credential, fixture coordinate, raw URL, token, or response body is retained.

## Conclusions at the snapshot date

| Assumption | Official source | Verified behavior | Remaining uncertainty |
| --- | --- | --- | --- |
| `X-Accepted-GitHub-Permissions` represents AND/OR permission requirements. | [GitHub REST troubleshooting: Resource not accessible](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api?apiVersion=2026-03-10#resource-not-accessible) | Commas join permissions that are all required. Semicolons separate alternative comma-separated permission sets. GitHub's examples cover one term, an AND conjunction, and OR-of-AND alternatives. | GitHub does not promise on this page that the header is present on every success and every error. Missing runtime evidence must therefore remain distinct from an empty requirement. |
| Installation tokens can be narrowed. | [Generating an installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app) and [Create an installation access token for an app](https://docs.github.com/en/rest/apps/apps?apiVersion=2026-03-10#create-an-installation-access-token-for-an-app) | A disposable installation accepted requests for `issues:write` and separately `contents:read`, each scoped to one repository. Raw responses reported the requested assignment plus mandatory `metadata:read`. | The platform proof remained fixture-bound. Current offline route coverage is documented separately and does not expand the scope of this live evidence. |
| Installation tokens are short-lived and disclose their effective scope. | [Generating an installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app) | The disposable broad and narrowed token responses included raw effective permissions, exactly one expected repository, and an approximately 60-minute lifetime. New token formats remain opaque; GrantTrace assumes no prefix or fixed length. | The REST schema still marks response `permissions` optional, so every proof must continue to require the raw field rather than treating absence as empty. |
| A GitHub App can authenticate the token request with a short-lived JWT. | [Generating a JSON Web Token (JWT) for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app) | GitHub requires RS256. The offline implementation's numeric-App-ID JWT successfully authenticated disposable token requests. | Client-ID migration remains optional follow-up work; it is not required for the fixture proof. |
| The REST API version should be pinned. | [GitHub REST API versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions) | The latest supported version is `2026-03-10`; `2022-11-28` remains supported until 2028-03-10 and is still the default when the header is omitted. GrantTrace explicitly pins `2026-03-10`. | Every catalog refresh remains tied to an explicit API-version and evidence review. |
| Octokit supports plugins and request lifecycle hooks. | [`@octokit/core` v7.0.6 hooks](https://github.com/octokit/core.js/blob/951bd353a4e31f7b8bf56245dcdd6631634b4765/README.md#hooks), [plugins](https://github.com/octokit/core.js/blob/951bd353a4e31f7b8bf56245dcdd6631634b4765/README.md#plugins), and [plugin types](https://github.com/octokit/core.js/blob/951bd353a4e31f7b8bf56245dcdd6631634b4765/src/types.ts) | The npm release reviewed at the access date was `@octokit/core@7.0.6`. `Octokit.plugin(plugin)` passes the instance and constructor options to a plugin. `octokit.hook.wrap("request", (request, options) => ...)` can observe the request and both its returned response and thrown error. | Hook behavior for every third-party Octokit wrapper remains outside scope. GrantTrace supports `@octokit/core`. |
| An unexpanded route template is available before request expansion. | [`@octokit/request` hook path](https://github.com/octokit/request.js/blob/554e1029c40181a73939e6e9c265a72c7cf510ad/src/with-defaults.ts), [`endpoint.merge`](https://github.com/octokit/endpoint.js/blob/7f97cd91409be64d2b75af807583a4fe18d33188/src/merge.ts), [`endpoint.parse`](https://github.com/octokit/endpoint.js/blob/7f97cd91409be64d2b75af807583a4fe18d33188/src/parse.ts), and a local experiment with `@octokit/core@7.0.6` | For `octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", params)`, a wrap hook receives merge output before parsing and URL expansion. Owner, repository, resource ID, body, query, and authorization remain separate rich fields. A concrete input stays concrete. | GrantTrace exact-matches a syntactically safe template to the pinned catalog. Concrete, absolute, query-bearing, and unmatched values are discarded and become unresolved. Other adapters require separate verification. |
| Accepted-permission headers are reachable on Octokit success and error results. | [`@octokit/request` fetch wrapper](https://github.com/octokit/request.js/blob/554e1029c40181a73939e6e9c265a72c7cf510ad/src/fetch-wrapper.ts) and a local experiment with `@octokit/core@7.0.6` | A controlled response exposed the lower-cased header through `response.headers`. A controlled 403 exposed it through `error.response.headers`; a network error has no response. | This verifies Octokit's transport behavior, not GitHub's consistency in emitting the header. Recorder logic handles absent and malformed headers on both paths. |
| `@octokit/app-permissions` can be used as a complete pinned fallback. | [Published `2.1.0` data](https://github.com/octokit/app-permissions/blob/98a600ce519f099d8f7fec12e01e48e033ea02d0/generated/api.github.com.json), [current updater](https://github.com/octokit/app-permissions/blob/33d11b33bc4aebec2186ebfa123963eda27458f1/scripts/update.mjs), [2026-07-23 failed update run](https://github.com/octokit/app-permissions/actions/runs/29996924108), and [GitHub's create-comment permissions](https://docs.github.com/en/rest/issues/comments?apiVersion=2026-03-10#create-an-issue-comment) | **Disproved.** The latest npm release is `2.1.0`, published 2024-04-03. Its one-pair path schema cannot represent AND/OR alternatives and reduces create-comment to only `pull_requests:write`, while GitHub documents `issues:write` **or** `pull_requests:write`. Its updater catches and prints errors without a nonzero exit; the access-date run logged `ERR_INVALID_URL`, changed nothing, and still concluded success. | This finding led to the versioned DNF-capable catalog. The early milestones used a two-entry fixture; public-beta coverage is the separately reviewed 49-route catalog. |
| Only `read` and `write` access levels need modeling. | [Create an installation access token for an app](https://docs.github.com/en/rest/apps/apps?apiVersion=2026-03-10#create-an-installation-access-token-for-an-app) | Most repository permissions use `read`/`write`, but the current schema includes at least one `admin` level for an enterprise permission. | GrantTrace intentionally supports only `read` and `write`. Any other runtime or catalog level fails closed as malformed/unsupported evidence; it is never coerced to `write`. |
| `@octokit/auth-app` can prove response permissions without inspecting the raw response. | [`@octokit/auth-app` v8.2.0 installation auth](https://github.com/octokit/auth-app.js/blob/6201580be6cc3f0967c7454d5de92db35e353041/README.md#installation-authentication) and [implementation](https://github.com/octokit/auth-app.js/blob/6201580be6cc3f0967c7454d5de92db35e353041/src/get-installation-authentication.ts) | **Not safely.** The helper returns permissions but normalizes an absent API `permissions` field to `{}`. | The implemented token broker validates the raw token-endpoint response so missing effective-permission evidence cannot masquerade as an empty grant. |

## Hook experiment

The smallest safe experiment used a custom in-memory `fetch` implementation—no
network request—to call:

```text
POST /repos/{owner}/{repo}/issues/{issue_number}/comments
```

The wrap hook observed only the template in `options.url` before calling the
transport. On a controlled `201` and `403`, the parsed Octokit response/error
made the accepted-permissions header available. The recorder implementation
therefore constructs persistence from this allowlist:

```text
method, validated route template, status, parsed permission DNF, finding
```

It does not copy the hook options, response, error, headers, body, URL, or
authentication object.

## Blueprint decisions from the snapshot

1. Pin GitHub REST API version `2026-03-10`.
2. Do not ingest `@octokit/app-permissions@2.1.0` as authoritative route
   evidence. Its model loses alternatives.
3. Encode the issue-comment fixture as
   `issues=write; pull_requests=write`. The deterministic policy still selects
   `issues:write`, preserving the intended first vertical slice without
   misrepresenting GitHub's current route documentation.
4. Fail closed on access levels other than `read` and `write`.
5. Treat the Octokit template as trusted only when it remains a relative,
   placeholder-bearing canonical route. Concrete paths and GraphQL are
   unresolved/unsupported and no raw URL is retained.

## Initial offline catalog identity (historical)

The initial milestone catalog was intentionally tiny and repository-owned. Its
exact version and SHA-256 checksum were embedded in the deterministic contract.
It existed to test resolver behavior, source agreement, contradiction
handling, and reproducibility—not to claim broad GitHub endpoint coverage.

That inventory has since been superseded by the checksummed, official-docs-
backed 49-route public-beta catalog. This section remains to explain the
original evidence path, not current coverage.

## Offline Milestone 4 safety foundation (historical)

Offline tests established the following before the disposable live spike:

- the fixture must be explicitly confirmed and its repository name must end
  in `-granttrace-fixture`;
- numeric App, installation, and issue identifiers and an RSA private key are
  validated without echoing rejected values;
- the App private key remains in the broker and only a short-lived App JWT
  crosses the token transport boundary;
- the raw installation-token response must contain selected permissions plus
  the explicit mandatory baseline, one matching repository, and an
  approximately one-hour future expiry;
- missing permissions, broader permissions, unsupported access levels,
  missing/broad repository scope, and implausible expiry all fail closed;
- secret values redact themselves during ordinary stringification and
  inspection;
- the proof child environment starts from a small allowlist and receives only
  the restricted installation token plus nonsecret recorder/fixture values;
- 401, authorization 403, rate limiting, hidden/not-found resources, expiry,
  GitHub unavailability, test indeterminacy, and cleanup failure remain
  distinct classifications;
- cleanup runs after either operation success or failure and is reported
  independently.

The token endpoint transport remains behind an injectable boundary and only
the guarded `prove` workflow invokes it. The disposable spike verified
authentication, raw response fields, one-repository selection, and the
mandatory metadata baseline.

The following offline layer added:

- a restricted proof-child runner using argv plus `shell: false`;
- streamed, uncaptured stdout/stderr;
- explicit outcomes for pass, spawn failure, test failure, missing
  instrumentation, analysis failure, and timeout;
- bounded termination for a hung child and cleanup only after process close;
- a strict `0600` ephemeral report that records scenario, source commit,
  catalog/contract identity, selected/effective permissions, safe child facts,
  proof state, negative-control state, and cleanup state—never repository
  identity or secrets.

## Disposable live spike result

On 2026-07-23, after the fixture repository was renamed to satisfy the
unchanged `-granttrace-fixture` guard, GrantTrace made its first authenticated
token requests:

1. A broad token response exactly matched the fixture's four effective grants:
   `actions:read`, `contents:write`, `issues:write`, and mandatory
   `metadata:read`. It reported one expected repository and an approximately
   60-minute lifetime.
2. A request narrowed to `issues:write` succeeded at GitHub, reported one
   expected repository and an approximately 60-minute lifetime, but disclosed
   `issues:write` plus mandatory `metadata:read`.
3. The initial exact-equality response validator rejected that second response
   as `effective_permission_mismatch`, exposing a platform/design
   contradiction rather than an authentication or scope failure.
4. GrantTrace was updated to represent mandatory permissions separately and
   compare:

```text
effective permissions
  = requested selected permissions
  + explicitly modeled mandatory permissions
```

5. The resumed spike minted a baseline-aware `issues:write` token, created one
   disposable issue comment, and deleted it successfully in `finally`.
6. A separately minted one-repository token without `issues:write` received a
   real non-rate-limited `403` on the same focused comment operation. No
   negative-control cleanup was needed.
7. The released `prove` path then reproduced the accepted issue-comment
   contract with a restricted child, deleted the child's comment, received the
   expected negative-control rejection, and wrote a passing strict report.

The live evidence therefore supports the implemented fixture workflow:
selected permissions remain reviewable contract output, mandatory
`metadata:read` remains explicit effective baseline, and any other effective
permission difference still blocks.

# GrantTrace

GrantTrace catches a specific GitHub App failure mode: integration tests pass
with an over-privileged token, while the code has quietly started depending on
a permission nobody intended to grant.

It records the GitHub REST operations exercised by a named, instrumented test
scenario, derives a deterministic permission contract sufficient for those
observed operations, and makes permission changes reviewable.

```text
GrantTrace check failed

New permission
  contents: read

Observed in
  Route     GET /repos/{owner}/{repo}/contents/{path}
  Evidence  runtime_header, pinned_catalog

Next
  Review the evidence, then run:
  granttrace check --accept
```

GrantTrace does **not** claim whole-application least privilege. Its contract
describes only REST operations observed in the selected scenarios.

## What works now

The current vertical slice includes:

- strict parsing of GitHub's `X-Accepted-GitHub-Permissions` header;
- correct AND/OR permission alternatives;
- a deterministic global permission solver and reviewable frontier;
- a checksummed, deliberately tiny fixture catalog;
- an opt-in `@octokit/core` recorder;
- safe observations that omit URLs, request/response bodies, headers, tokens,
  and resource identities;
- `record`, `check`, `prove`, and the lower-level `analyze` command;
- contract diffs and explicit blocking for unknown or contradictory evidence;
- local-stub integration tests, concurrency tests, and artifact-wide secret
  canary tests;
- a disposable-fixture guard, redacting secret wrappers,
  restricted child-environment builder, raw installation-token validator, and
  independently reported cleanup semantics;
- a proof-child runner with bounded timeouts, streamed output,
  instrumentation checks, exact accepted-contract reproduction, and an
  allowlisted ephemeral report;
- live-verified one-repository token downscoping, mandatory
  `metadata:read` baseline handling, reversible comment cleanup, and a real
  authorization negative control.

## Development setup

Requirements: Node.js 22 and pnpm.

```bash
pnpm install
pnpm verify
```

Run the fully local example:

```bash
pnpm granttrace record --scenario disposable-comment -- \
  node --import tsx examples/triage-bot/scenario.ts

pnpm granttrace check
pnpm granttrace check --accept
pnpm granttrace check
```

The repository includes the accepted disposable-comment contract, so the first
check should pass unchanged. `--accept` is the only mode that writes
`granttrace.lock.json` after an intentional review.

With the explicitly disposable live fixture configured through the environment,
prove that accepted contract end to end:

```bash
pnpm granttrace prove --scenario disposable-comment -- \
  node --import tsx examples/live-issue-comment/scenario.ts
```

`prove` never accepts credentials as arguments. It mints a one-repository
installation token for the accepted selected permissions, adds GitHub's
mandatory `metadata:read` baseline only when validating the raw response,
runs the command in the restricted proof environment, requires its observations
to reproduce the accepted contract exactly, and runs a focused negative
control when the issue-comment route makes that valid. The strict result is
written to `.granttrace/report.json`.

For the lower-level engine:

```bash
pnpm granttrace analyze test/fixtures/observations/triage.ndjson
```

## Instrumenting Octokit

The test process must opt in:

```ts
import { Octokit } from "@octokit/core";
import { grantTrace } from "granttrace/octokit";

const TracedOctokit = Octokit.plugin(grantTrace);

export const octokit = new TracedOctokit({
  auth: process.env.GITHUB_TOKEN,
});
```

The plugin is inert outside a `granttrace record` or `granttrace prove`
session. During recording it pins GitHub REST API version `2026-03-10`. A
conflicting explicit API version
fails clearly instead of producing a contract against the wrong catalog.

The CLI cannot observe arbitrary child-process network traffic. Every GitHub
REST request in the selected scenario must use an instrumented Octokit
instance.

## Evidence and contract semantics

GrantTrace uses runtime permission headers first and a pinned catalog fallback:

- agreeing sources retain both evidence labels;
- disagreement is a blocking contradiction;
- malformed runtime evidence never silently falls back;
- an unclassified route fails closed;
- `write` satisfies `read` only for the same permission;
- incomparable solutions remain in `permissionFrontier`;
- the selected solution uses the documented deterministic tie-break policy.

The current fixture catalog intentionally knows only:

- `POST /repos/{owner}/{repo}/issues/{issue_number}/comments`;
- `GET /repos/{owner}/{repo}/contents/{path}`.

An unmatched template is unresolved. This is an honest safety boundary, not a
claim of broad endpoint coverage.

## Security behavior

- Recorder persistence is constructed from an allowlist.
- Raw URLs, queries, bodies, headers, errors, and response data are never
  serialized.
- Concrete or absolute routes are not redacted or guessed; they are discarded
  and reported as unresolved.
- Session directories use mode `0700`; observation files use `0600`.
- Child commands are argument arrays launched with `shell: false`.
- Child stdout/stderr is streamed and not retained by GrantTrace.
- Tokens and private keys are not accepted as GrantTrace CLI arguments.

The test process is trusted code. It receives the user's ordinary test
environment during `record` and can print or exfiltrate its own secrets.
GrantTrace cannot make arbitrary test code safe. The proof boundary
builds a fresh allowlisted environment that removes broker credentials and
passes only a restricted, short-lived installation token plus the focused
fixture/recorder values.

The current proof MVP accepts one scenario per contract and refuses contracts
with manual keeps. That keeps exact live reproduction honest until the contract
schema can attribute routes to individual scenarios and define how manual keeps
participate in token grants.

## Unsupported

GraphQL, Actions `GITHUB_TOKEN`, OAuth Apps, user-to-server tokens, PATs, Git
transport, GHES, webhook inference, static whole-program analysis, and
unpublished adapters are outside the current scope.

See [the protocol](docs/protocol.md), [threat model](docs/threat-model.md),
[limitations](docs/limitations.md), and
[platform feasibility record](docs/feasibility.md). The exact, intentionally
manual prerequisites for live proof are in
[disposable live fixture setup](docs/live-setup.md).

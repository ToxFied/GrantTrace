# GrantTrace

GrantTrace makes GitHub App REST permission changes reproducible and
reviewable. It is for teams that exercise their GitHub App through repeatable
integration scenarios and want permission changes to become explicit code
review.

Its exact guarantee is deliberately narrow:

> For the GitHub REST operations exercised by these named, instrumented
> scenarios, these are the permissions the scenarios demonstrably require.

GrantTrace does not claim whole-application least privilege. Untested paths,
GraphQL calls, uninstrumented clients, and behavior outside the recorded
scenarios are outside the result.

The workflow is:

```text
instrument test scenarios
  -> record safe route evidence
  -> review a deterministic contract diff
  -> accept granttrace.lock.json
  -> fail CI on future permission or coverage changes
  -> optionally prove one scenario with a restricted live token
```

## Status and requirements

GrantTrace is prepared as `granttrace@0.1.0-beta.1` for Node.js 22 or newer.
The package has not been published yet. Until it is, use a repository checkout
or a locally packed tarball. After publication, the intended install command
is:

```bash
pnpm add --save-dev granttrace@beta
```

The GitHub REST API version is explicitly pinned to `2026-03-10`.

To install the exact pre-publication tarball from a checkout:

```bash
pnpm install --frozen-lockfile
mkdir -p /tmp/granttrace-pack
npm pack --pack-destination /tmp/granttrace-pack

# Run this in the consuming project:
pnpm add --save-dev /tmp/granttrace-pack/granttrace-0.1.0-beta.1.tgz
```

`pnpm package:smoke` performs a stricter temporary clean-install check without
leaving the tarball or consumer project behind.

## Quickstart: first contract in 10–15 minutes

### 1. Initialize local state

From the project whose GitHub App tests you want to trace:

```bash
pnpm exec granttrace init
pnpm exec granttrace doctor
```

`init` creates private `.granttrace/` state and adds it to `.gitignore`. It
does not create credentials or change GitHub settings. `doctor` checks Node,
local file modes, the accepted contract, and optional live-proof
configuration without printing credential values or fixture identities.

When working from this repository before publication, substitute
`pnpm granttrace` for `pnpm exec granttrace`.

### 2. Instrument the Octokit instance used by a test

```ts
import { Octokit } from "@octokit/core";
import { grantTrace } from "granttrace/octokit";

const TracedOctokit = Octokit.plugin(grantTrace);

export const octokit = new TracedOctokit({
  auth: process.env.GITHUB_TOKEN,
});
```

The plugin is inert unless the process is launched by `granttrace record` or
`granttrace prove`. During those sessions it pins API version `2026-03-10`.
An explicitly conflicting version fails instead of producing evidence against
the wrong catalog.

Every GitHub REST request covered by the scenario must use this instrumented
instance. GrantTrace cannot observe arbitrary network traffic.

### 3. Record one named scenario

```bash
pnpm exec granttrace record --scenario issue-triage -- \
  pnpm test -- issue-triage
```

The command after `--` is passed as argv with `shell: false`. Output is
streamed to the terminal and not retained. The default timeout is 15 minutes;
use `--timeout 30s`, `--timeout 5m`, or another value from one second through
one hour when needed.

Successful recording writes
`.granttrace/observations/issue-triage.ndjson`. Recording the same scenario
again atomically replaces that scenario's prior observations.

### 4. Review and accept

```bash
pnpm exec granttrace check
```

On a new or changed contract, `check` explains permission additions,
escalations, reductions, removals, route changes, evidence changes, and
route-to-scenario attribution changes, then exits `6`. Nothing is accepted
automatically.

After reviewing the evidence:

```bash
pnpm exec granttrace check --accept
pnpm exec granttrace check
```

`--accept` is the only recording workflow that writes
`granttrace.lock.json`. Commit that identity-free file. A subsequent unchanged
check exits `0`.

The repository includes a fully local example:

```bash
pnpm granttrace record --scenario disposable-comment -- \
  node --import tsx examples/triage-bot/scenario.ts
pnpm granttrace check
```

## Multiple scenarios

Record each scenario independently. `check` reads all sorted `.ndjson` files
under `.granttrace/observations/`, attributes each canonical route to the
scenario names that exercised it, and solves one deterministic aggregate
contract.

```bash
pnpm exec granttrace record --scenario issue-triage -- pnpm test -- issue-triage
pnpm exec granttrace record --scenario release-read -- pnpm test -- release-read
pnpm exec granttrace scenario list
pnpm exec granttrace check
```

To retire a scenario:

```bash
pnpm exec granttrace scenario remove release-read
pnpm exec granttrace check
```

Removing local observations never edits the accepted contract. Review the
coverage removal first, then use `check --accept`.

Live proof is also scenario-scoped:

```bash
pnpm exec granttrace prove --scenario issue-triage -- \
  pnpm test -- issue-triage
```

For that run GrantTrace selects only routes attributed to `issue-triage`,
recomputes its permission solution, and requires the live observations to
reproduce that scenario slice exactly.

## Evidence and solving

GrantTrace reads GitHub's `X-Accepted-GitHub-Permissions` response header and
checks it against a pinned offline catalog:

- agreeing sources retain both provenance labels;
- runtime/catalog disagreement blocks;
- malformed runtime evidence cannot fall back silently;
- a missing runtime header may use a known catalog entry;
- an unknown route fails closed;
- commas in GitHub's header are AND and semicolons are OR;
- `write` satisfies `read` only for the same permission;
- all nondominated solutions remain in `permissionFrontier`;
- one selected solution is chosen by a documented deterministic risk policy.

The catalog contains 49 curated route templates for common repository
metadata, Issues and comments, pull requests and reviews, contents, Actions,
checks and statuses, and releases. Every entry links to official GitHub
documentation. Ambiguous conditional requirements are excluded instead of
guessed. See [catalog coverage](docs/catalog.md).

The stale flattened `@octokit/app-permissions` package is not treated as
authoritative evidence because it cannot represent GitHub's AND/OR
alternatives accurately.

## Schema v2 and v1 migration

Schema v2 stores stable route-to-scenario attribution. Contracts contain no
timestamp, command, local path, machine value, repository identity, resource
identity, token, or private key.

Schema v1 remains readable. Because v1 did not say which scenario exercised
which route, the reader conservatively attributes every legacy route to every
declared scenario for review. It never invents narrower attribution and never
rewrites the file silently. Record the current scenarios, run `check`, review
the attribution diff, and run `check --accept` to write v2. `prove` blocks a
contract that was only conservatively migrated in memory.

## Manual keeps

Sometimes an operator must retain access that the recorded scenarios do not
exercise. Make that exception explicit:

```bash
pnpm exec granttrace keep add contents:read \
  --reason "Required by a separately reviewed webhook recovery path"
pnpm exec granttrace keep list
pnpm exec granttrace keep remove contents
```

Every keep needs a human reason of at most 240 characters. It is stored
separately from observed `selectedPermissions`; GrantTrace never calls it
observed or proven necessary. A keep cannot duplicate selected access or the
mandatory `metadata:read` baseline.

During every scenario proof:

```text
requested = scenario-selected permissions + all manual keeps
effective = requested + mandatory metadata:read
```

The raw token response must equal that effective assignment exactly. Any
additional or missing access blocks proof. Keeps therefore participate in
token minting and exact effective-permission accounting, but not in the
necessity claim.

`keep add` and `keep remove` intentionally update the accepted lock directly.
Review and commit that diff. Later `check` runs preserve validated keeps.

## Live proof

`prove` is optional. Use it only with a dedicated disposable GitHub App
installation and repository:

```bash
pnpm exec granttrace doctor
pnpm exec granttrace prove --scenario issue-triage -- \
  pnpm test -- issue-triage
```

GrantTrace:

1. loads the accepted schema-v2 contract;
2. requests a one-repository installation token for the scenario-selected
   permissions plus manual keeps;
3. requires the raw response to report exactly that request plus GitHub's
   mandatory `metadata:read`;
4. verifies one expected repository and a fresh, approximately one-hour
   expiry;
5. launches the child with the restricted token, never the App private key or
   App/installation broker identifiers;
6. reproduces the accepted scenario contract exactly;
7. runs applicable safe negative controls; and
8. reports cleanup independently.

The built-in framework currently has a read-only issue-comments control and a
reversible comment-creation control. A control removes `issues` only when the
target route would become unsatisfied. Unsupported controls are
`not_applicable`; unexpected success fails. A mutating unexpected success is
cleaned up with the positive token, and cleanup failure prevents a pass.

Authentication, authorization, rate limiting, token expiry, hidden resources,
GitHub outages, test failure, indeterminate timeout, and cleanup failure remain
separate classifications. A generic nonzero child exit is never interpreted
as a permission rejection.

See [safe live setup](docs/live-setup.md) before configuring credentials.

## CI

CI should record the same deterministic, offline-backed scenarios and then
check the committed contract:

```bash
pnpm install --frozen-lockfile
pnpm exec granttrace record --scenario issue-triage -- \
  pnpm test -- issue-triage
pnpm exec granttrace record --scenario release-read -- \
  pnpm test -- release-read
pnpm exec granttrace check
```

Do not use `--accept` in CI. Exit `6` means the contract needs human review;
exit `7` means evidence is unknown, malformed, unsupported, or contradictory.

GrantTrace's own workflow runs typechecking, tests, build, production audit,
deterministic contract reproduction, package smoke tests, CI-policy
validation, and leakage scans. Third-party Actions are pinned to full commit
SHAs with minimal permissions. Live proof is deliberately absent from
untrusted pull-request workflows and requires no fixture secrets.

## Stored data and privacy

Commit:

- `granttrace.lock.json`: deterministic schema/API/catalog identity, named
  scenarios, canonical templates, safe permission evidence, route
  attribution, selected/frontier assignments, and reasoned manual keeps.

Keep local and ignored:

- `.granttrace/observations/*.ndjson`: safe per-scenario observations;
- `.granttrace/sessions/`: temporary recorder sessions;
- `.granttrace/proof-sessions/`: temporary restricted proof sessions;
- `.granttrace/reports/<scenario>.json`: strict ephemeral proof results.

Observations and contracts never store raw URLs, query strings, request or
response bodies, headers, errors, commands, tokens, private keys, owner/repo
names, or resource IDs. Report files use mode `0600`; report/session
directories use `0700`. Rich unknown fields are rejected rather than copied
or redacted.

The test process is trusted code. `record` inherits its ordinary environment,
and test code can print or exfiltrate its own secrets. `prove` constructs a
fresh allowlisted environment that isolates broker credentials, but it is not
an OS sandbox.

## Commands and exit behavior

| Command | Purpose |
| --- | --- |
| `granttrace init` | Create private ignored local state |
| `granttrace doctor` | Diagnose local and optional live prerequisites safely |
| `granttrace record --scenario NAME -- COMMAND` | Record one instrumented scenario |
| `granttrace scenario list` | List local scenario recordings |
| `granttrace scenario remove NAME` | Remove one local recording |
| `granttrace check` | Compare all recordings with the accepted contract |
| `granttrace check --accept` | Atomically accept the reviewed contract |
| `granttrace keep add/remove/list` | Manage reasoned, unproven access |
| `granttrace prove --scenario NAME -- COMMAND` | Prove one accepted scenario live |
| `granttrace analyze OBSERVATIONS` | Inspect one lower-level NDJSON file |

| Exit | Meaning |
| ---: | --- |
| `0` | Success |
| `2` | Invalid command usage |
| `3` | No instrumentation or no safe observations |
| `4` | Child test failed or could not start |
| `5` | Invalid/unsafe artifact, configuration failure, or analysis failure |
| `6` | Contract review or schema migration required |
| `7` | Unknown, unsupported, malformed, or contradictory evidence |
| `8` | Live proof, negative-control, or cleanup failure |
| `130` | Child interrupted by a terminal signal |

The CLI emits plain text without ANSI color, so output is stable under
`NO_COLOR` and in noninteractive CI. `record` and `prove` accept bounded
timeouts and terminate a timed-out child before cleaning its session.

## Troubleshooting

`record` says no operation was observed:

- confirm the child imports `granttrace/octokit`;
- confirm the scenario uses the instrumented Octokit class, not another
  client instance; and
- confirm it executes at least one supported REST template.

`check` exits `6`:

- this is the expected review state, not corrupted evidence;
- inspect permission, route, evidence, and attribution changes; and
- run `check --accept` only after deciding the new coverage is intentional.

`check` exits `7`:

- do not accept or add a permission by guess;
- inspect whether the route is absent from [catalog coverage](docs/catalog.md),
  the runtime header is malformed, or runtime and catalog evidence disagree;
- update the scenario or submit an official-docs-backed catalog change.

`prove` reports configuration failure:

- run `granttrace doctor`;
- configure exactly one private-key provider; and
- verify the disposable suffix, explicit confirmation, and all nonsecret
  selectors described in [safe live setup](docs/live-setup.md).

`prove` times out or a child fails:

- treat it as test/indeterminate evidence, not a permission rejection;
- stabilize the same scenario or choose a bounded `--timeout`; and
- inspect the fixture for residue before retrying after any cleanup failure.

## Package development

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm audit --prod
pnpm catalog:review
pnpm package:smoke
pnpm leakage:scan
```

`pnpm pack` runs a clean production build. Apart from npm's required
`package.json`, the package allowlist contains only `dist`, `LICENSE`, and this
README. Package smoke testing installs the tarball into a clean temporary
project and exercises the installed executable and offline workflow.

Contributions that alter catalog evidence, contract serialization, proof
accounting, or credential boundaries need focused tests and documentation.
See [CONTRIBUTING.md](CONTRIBUTING.md).

## Public-beta readiness

- [x] Honest coverage-bound guarantee
- [x] Deterministic schema-v2 multi-scenario contracts
- [x] Explicit manual keeps with human reasons
- [x] Fail-closed runtime/catalog evidence
- [x] 49 official-docs-backed route templates
- [x] Restricted scenario proof and exact effective-permission accounting
- [x] Read-only and reversible mutating negative controls
- [x] Environment, private-file, and macOS Keychain key providers
- [x] Least-privileged offline CI and package/leakage smoke tests
- [ ] Repository owner makes the repository public
- [ ] Package owner publishes `granttrace@0.1.0-beta.1` with the beta tag

Neither of the final two release actions is performed by the build or test
workflow.

## Scope

Unsupported: GraphQL, Actions `GITHUB_TOKEN`, OAuth Apps, user-to-server
tokens, personal access tokens, Git transport, GHES, webhook inference,
static whole-program analysis, arbitrary HTTP interception, and access levels
beyond `read`/`write`.

Read the [protocol](docs/protocol.md), [threat model](docs/threat-model.md),
[limitations](docs/limitations.md), [catalog coverage](docs/catalog.md), and
[platform feasibility record](docs/feasibility.md) for the exact boundaries.

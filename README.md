<h1 align="center">
  <picture>
    <source
      media="(prefers-color-scheme: dark)"
      srcset=".github/assets/granttrace-hero-dark.svg"
    >
    <img
      src=".github/assets/granttrace-hero-light.svg"
      width="760"
      alt="GrantTrace — Scenario-bound GitHub App REST permission contracts"
    >
  </picture>
</h1>

<p align="center">
  <a href="https://toxfied.github.io/GrantTrace/docs/"><strong>Documentation</strong></a>
  &nbsp;·&nbsp;
  <a href="#quick-start">Quickstart</a>
  &nbsp;·&nbsp;
  <a href="#workflow">Workflow</a>
  &nbsp;·&nbsp;
  <a href="#cli-reference">CLI</a>
  &nbsp;·&nbsp;
  <a href="docs/threat-model.md">Security</a>
</p>

<p align="center">
  <code>Node.js 22+</code>
  &nbsp;
  <code>GitHub REST 2026-03-10</code>
  &nbsp;
  <code>MIT</code>
</p>

GrantTrace turns the GitHub REST operations exercised by named test scenarios
into a deterministic permission contract you can review in Git.

> **Guarantee boundary**
>
> GrantTrace reports the permissions those scenarios demonstrably require. It
> does not claim whole-application least privilege; untested paths, GraphQL,
> clients outside the supported recording path, and behavior outside recorded
> scenarios stay outside the result.

## Workflow

```text
run a scenario through GrantTrace → review its permission diff
→ commit granttrace.lock.json → check it in CI → optionally prove live
```

```text
$ granttrace check

GrantTrace contract review required

New permission
  issues: write

Observed in
  Route     POST /repos/{owner}/{repo}/issues/{issue_number}/comments
  Scenarios triage-integration
  Evidence  Runtime response header, Pinned permission catalog
```

Contracts are deterministic and identity-free. They contain no repository
names, resource IDs, commands, tokens, private keys, local paths, or timestamps.

## Quick start

### Requirements

- Node.js 22 or newer
- A repeatable Node.js test or integration scenario
- GitHub REST API version `2026-03-10` (pinned by GrantTrace)

### Install

Once the beta is published:

```bash
pnpm add --save-dev granttrace@beta
```

Until then, install GrantTrace `0.1.0-beta.1` from a package archive built from
source:

```bash
git clone https://github.com/ToxFied/GrantTrace.git
cd GrantTrace
corepack enable
pnpm install --frozen-lockfile
mkdir -p /tmp/granttrace-pack
npm pack --pack-destination /tmp/granttrace-pack
```

Install the resulting archive in your project:

```bash
pnpm add --save-dev /tmp/granttrace-pack/granttrace-0.1.0-beta.1.tgz
```

The source-packaging block is temporary release plumbing, not the intended
consumer onboarding. When developing GrantTrace itself, substitute
`pnpm granttrace` for `pnpm exec granttrace`.

### 1. Record a scenario

```bash
pnpm exec granttrace record issue-triage -- \
  pnpm test -- issue-triage
```

That is the complete standard setup. GrantTrace injects its recorder into the
Node child, observes supported GitHub REST calls made through global `fetch`
(including standard Octokit clients), creates private `.granttrace/` state,
and adds that directory to `.gitignore`. You do not need to replace your
Octokit constructor or run `init`.

The command after `--` runs directly without a shell. Output is streamed to the
terminal and not retained. The default timeout is 15 minutes;
use `--timeout 30s`, `--timeout 5m`, or another value from one second through
one hour when needed. Terminal interrupts are remembered even if the child
handles the signal and exits `0`; partial observations are discarded, and an
unresponsive child is force-killed after a bounded grace period.

Successful recording writes
`.granttrace/observations/issue-triage.ndjson`, then calculates and displays the
contract diff in the same flow. Recording the same scenario again atomically
replaces that scenario's prior observations.

On the first recording, GrantTrace creates nonsymlink `.granttrace/` state with
private modes and ownership checks, then adds it to `.gitignore` before the
test process can start. Existing unsafe or stale state blocks execution.
`granttrace init` remains available for explicit setup and `granttrace doctor`
for optional diagnostics.

### 2. Review and accept

In an interactive terminal, `record` explains permission additions,
escalations, reductions, removals, route changes, evidence changes, and
route-to-scenario attribution changes, then asks whether to accept the exact
diff. Acceptance is always explicit.

In CI or any noninteractive terminal, GrantTrace never accepts. A changed
contract exits `6`; review it locally. You can also separate recording from
review with `granttrace check` and explicitly write the reviewed contract with
`granttrace check --accept`.

Commit the resulting identity-free `granttrace.lock.json`. CI can then run
`granttrace check`; an unchanged contract exits `0`.

If your project uses a custom fetch implementation, transport, unusual runtime,
or advanced Octokit plugin composition, use the explicit adapter documented in
[Octokit and custom transports](docs/instrument-octokit.mdx). GrantTrace never
claims to observe requests outside its supported automatic or explicit
instrumentation paths.

The repository includes a fully local example:

```bash
pnpm granttrace record disposable-comment -- \
  node --import tsx examples/triage-bot/scenario.ts
```

## Working with multiple scenarios

Record each scenario independently. `check` reads all sorted `.ndjson` files
under `.granttrace/observations/`, attributes each canonical route to the
scenario names that exercised it, and solves one deterministic aggregate
contract.

```bash
pnpm exec granttrace record issue-triage -- pnpm test -- issue-triage
pnpm exec granttrace record release-read -- pnpm test -- release-read
pnpm exec granttrace scenario list
pnpm exec granttrace check
```

To retire a scenario:

```bash
pnpm exec granttrace scenario remove release-read
pnpm exec granttrace check
```

Removing local observations never edits the accepted contract. Review the
coverage removal first, then use `check --accept`. Retiring the final scenario
is also reviewable: acceptance writes a deterministic schema-v2 contract with
zero scenarios, routes, selected permissions, and unknowns rather than
silently deleting the lock. Validated manual keeps remain until explicitly
removed; they remain retained, unproven access.

Live proof is also scenario-scoped:

```bash
pnpm exec granttrace prove issue-triage -- \
  pnpm test -- issue-triage
```

For that run GrantTrace selects only routes attributed to `issue-triage`,
recomputes its permission solution, and requires the live observations to
reproduce that scenario slice exactly. Standard Node global-`fetch` and Octokit
traffic is observed automatically here too; custom transports and runtimes use
the same [explicit fallback](docs/instrument-octokit.mdx).

## Evidence model

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

## Contract format and migration

Schema v2 stores stable route-to-scenario attribution and the exact evidence
provenance used by each scenario on a shared route. A reviewed zero-scenario v2
contract represents an explicit retirement of all recorded coverage. Contracts
contain no timestamp, command, local path, machine value, repository identity,
resource identity, token, or private key.

Schema v1 remains readable. Because v1 did not say which scenario exercised
which route, the reader conservatively attributes every legacy route to every
declared scenario for review. It never invents narrower attribution and never
rewrites the file silently. Record the current scenarios, run `check`, review
the attribution diff, and run `check --accept` to write v2. `prove` blocks a
contract that was only conservatively migrated in memory.

Legacy schema-v2 contracts without per-scenario provenance remain readable.
`check` requires an explicit review and acceptance to write scenario-specific
provenance, while `prove` and `keep` remain blocked.

## Manual keeps

Sometimes an operator must retain access that the recorded scenarios do not
exercise. Make that exception explicit:

```bash
pnpm exec granttrace keep add contents:read \
  --reason "Required by a separately reviewed webhook recovery path"
pnpm exec granttrace keep list
pnpm exec granttrace keep remove contents
```

Every keep needs a human reason of at most 240 characters. Reasons are
committed in `granttrace.lock.json`, so they must contain no credential,
identity, URL, or other sensitive value. Control, formatting, invisible, URL,
and obvious private-key/token-shaped text is rejected rather than echoed or
stored. A reason is stored separately from observed `selectedPermissions`;
GrantTrace never calls the keep observed or proven necessary. A keep cannot
duplicate selected access or the mandatory `metadata:read` baseline.

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
pnpm exec granttrace prove issue-triage -- \
  pnpm test -- issue-triage
```

GrantTrace:

1. loads the accepted schema-v2 contract;
2. rebinds every accepted route and permission DNF to the exact pinned catalog;
3. requests a one-repository installation token for the scenario-selected
   permissions plus manual keeps;
4. requires the raw response to report exactly that request plus GitHub's
   mandatory `metadata:read`;
5. verifies one expected repository and a fresh, approximately one-hour
   expiry;
6. launches the child with the restricted token, never the App private key or
   App/installation broker identifiers;
7. reproduces the accepted scenario contract exactly;
8. runs applicable safe negative controls; and
9. reports cleanup independently.

Catalog rebinding happens before any token is minted. Production proof has no
broad-token discovery or feasibility preflight: it mints only the restricted
positive and applicable negative-control tokens described by the accepted
contract. The proof-child timeout defaults to 15 minutes and is bounded from
one second through 30 minutes.

Live proof currently runs only on Unix-like systems, where GrantTrace can
terminate and verify the managed child process group. Windows remains supported
for installation, recording, checking, analysis, and contract review.

The built-in framework currently has a read-only issue-comments control and a
reversible comment-creation control. A control removes `issues` only when the
target route would become unsatisfied. Unsupported controls are marked not
applicable; unexpected success fails. A mutating unexpected success is cleaned
up with the positive token, and cleanup failure prevents a pass.

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
pnpm exec granttrace record --no-review issue-triage -- \
  pnpm test -- issue-triage
pnpm exec granttrace record --no-review release-read -- \
  pnpm test -- release-read
pnpm exec granttrace check
```

`--no-review` defers the aggregate comparison until every scenario has been
recorded. Use it only when a final `granttrace check` is guaranteed, as above.
Do not use `--accept` in CI. Exit `6` means the contract needs human review;
exit `7` means evidence is unknown, malformed, unsupported, or contradictory.

GrantTrace's own workflow runs typechecking, tests, build, production audit,
deterministic contract reproduction, package smoke tests, CI-policy
validation, and leakage scans. Package smoke covers npm and strict pnpm
consumers; macOS and Windows portability jobs repeat it in addition to the
Linux verification job. Third-party Actions are pinned to full commit SHAs
with minimal permissions. Live proof is deliberately absent from untrusted
pull-request workflows and requires no fixture secrets.

## Privacy and local state

Commit:

- `granttrace.lock.json`: deterministic schema/API/catalog identity, named
  scenarios, canonical templates, safe permission evidence, route
  attribution, selected/frontier assignments, and documented manual keeps.

Keep local and ignored:

- `.granttrace/observations/*.ndjson`: safe per-scenario observations;
- `.granttrace/sessions/`: temporary recorder sessions;
- `.granttrace/proof-sessions/`: temporary restricted proof sessions;
- `.granttrace/reports/<scenario>.json`: strict ephemeral proof results.

Observations and contracts never store raw URLs, query strings, request or
response bodies, headers, errors, commands, tokens, private keys, owner/repo
names, or resource IDs. Report files use mode `0600`; report/session
directories use `0700`. Rich unknown fields are rejected rather than copied
or redacted. Local state directories and managed artifacts must be regular
files/directories rather than symlinks, with ownership enforced where the
platform exposes it. Observation and contract reads
are size-bounded, reject nonregular files, use no-follow opens where the
platform provides them, and verify that the opened file is the one inspected.

The test process is trusted code. `record` inherits its ordinary environment,
and test code can print or exfiltrate its own secrets. `prove` constructs a
fresh allowlisted environment that isolates broker credentials, but it is not
an OS sandbox.

## CLI reference

| Command | Purpose |
| --- | --- |
| `granttrace init` | Explicitly create private ignored local state |
| `granttrace doctor` | Diagnose local and optional live prerequisites safely |
| `granttrace record NAME -- COMMAND` | Auto-initialize, record one scenario, and review its diff |
| `granttrace scenario list` | List local scenario recordings |
| `granttrace scenario remove NAME` | Remove one local recording |
| `granttrace check` | Compare all recordings with the accepted contract |
| `granttrace check --accept` | Atomically accept the reviewed contract |
| `granttrace keep add/remove/list` | Manage reasoned, unproven access |
| `granttrace prove NAME -- COMMAND` | Prove one accepted scenario live |
| `granttrace analyze OBSERVATIONS` | Inspect one lower-level NDJSON file |

| Exit | Meaning |
| ---: | --- |
| `0` | Success |
| `2` | Invalid command usage |
| `3` | No supported operation was observed |
| `4` | Child test failed or could not start |
| `5` | Invalid/unsafe artifact, configuration failure, or analysis failure |
| `6` | Contract review or schema migration required |
| `7` | Unknown, unsupported, malformed, or contradictory evidence |
| `8` | Live proof, negative-control, or cleanup failure |
| `130` | Child interrupted by a terminal signal |

The CLI emits plain text without ANSI color, so output is stable under
`NO_COLOR` and in noninteractive CI. `record` and `prove` accept bounded
timeouts and terminate a timed-out child before cleaning its session. Record
allows at most one hour; proof allows at most 30 minutes. A terminal interrupt
is remembered independently of the child's exit code, escalates to a bounded
force-kill when necessary, and exits `130` without accepting partial evidence.

## Troubleshooting

`record` says no operation was observed:

- confirm the command starts a Node.js process and makes at least one GitHub
  REST request through global `fetch` or a standard Octokit client;
- check whether the client replaces global `fetch`, uses a custom transport,
  starts a worker or subprocess that discards the injected Node options, or
  runs in a different runtime; and
- use the explicit GrantTrace Octokit adapter for those advanced cases.

An unsupported route is recorded as a safe blocking finding, and `record`
exits `7` before offering acceptance.

`record` or `prove` says local state is blocked:

- run `granttrace init`, then `granttrace doctor`;
- do not replace `.granttrace/` or its managed subdirectories with symlinks;
- if doctor reports stale session artifacts, inspect them and any possible
  fixture mutation residue before removing the stale artifacts; and
- retry only after doctor has no `FAIL` result.

`record` or `check` exits `6`:

- this is the expected review state, not corrupted evidence;
- inspect permission, route, evidence, and attribution changes; and
- accept at the interactive prompt, or run `check --accept`, only after
  deciding the new coverage is intentional.

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

## Development

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm audit --prod
pnpm catalog:review
pnpm package:smoke
pnpm leakage:scan
```

`npm pack` runs the package's clean production prepack build. Apart from npm's required
`package.json`, the package allowlist contains only `dist`, `LICENSE`, and this
README. Package smoke testing checks the tarball with clean npm and strict
pnpm consumers, including public imports and TypeScript resolution, installed
CLI behavior, and an offline record/check/accept workflow.

Contributions that alter catalog evidence, contract serialization, proof
accounting, or credential boundaries need focused tests and documentation.
See [CONTRIBUTING.md](CONTRIBUTING.md).

## Limitations

Unsupported: GraphQL, Actions `GITHUB_TOKEN`, OAuth Apps, user-to-server
tokens, personal access tokens, Git transport, GHES, webhook inference,
static whole-program analysis, arbitrary HTTP interception, and access levels
beyond `read`/`write`.

## Documentation

| Document | What it covers |
| --- | --- |
| [Protocol](docs/protocol.md) | Contract semantics, evidence resolution, and proof behavior |
| [Threat model](docs/threat-model.md) | Trust boundaries, protected assets, and mitigations |
| [Live setup](docs/live-setup.md) | Disposable fixture and credential-provider configuration |
| [Catalog coverage](docs/catalog.md) | Supported REST route templates and official sources |
| [Limitations](docs/limitations.md) | Exact product boundaries and unsupported cases |
| [Platform evidence](docs/feasibility.md) | External evidence behind the protocol's design constraints |
| [Contributing](CONTRIBUTING.md) | Local development, tests, and catalog-change policy |

## License

[MIT](LICENSE) © 2026 Anestis

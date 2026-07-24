---
title: Protocol
description: The normative evidence, solving, contract, and proof protocol.
---

This document defines the deterministic local contract and guarded live-proof
protocol implemented by GrantTrace.

## Versions

- Observation schema: `1`
- Contract schema: `2`
- Proof-report schema: `2`
- Tool version: `0.1.0-beta.1`
- Pinned GitHub REST API: `2026-03-10`
- Offline catalog source: `github-docs`
- Offline catalog version: `2026-03-10.20260723.1`
- Catalog identity: SHA-256 over sorted canonical entries, permission DNF, and
  official documentation URL

Contract, observation, and report objects are strict. Unknown schema versions
and unrecognized fields fail validation.

## Guarantee

The protocol supports one claim:

> For the GitHub REST operations exercised by these named, recorded
> scenarios, these are the permissions the scenarios demonstrably require.

The claim is bounded by dynamic scenario coverage and the supported recorder
paths. The injected Node preload observes global-`fetch` traffic, including
standard Octokit requests. The explicit Octokit adapter covers compatible
custom transports. The claim does not extend to unexecuted code, unsupported
runtimes or endpoints, or traffic that bypasses both paths.

## Accepted-permissions grammar

GitHub defines commas as conjunction and semicolons as alternatives:

```text
header       = conjunction (";" conjunction)*
conjunction  = term ("," term)*
term         = permission "=" level
permission   = lowercase snake case identifier
level        = "read" | "write"
```

GrantTrace trims separator-adjacent whitespace, sorts and deduplicates exact
terms and alternatives, and rejects:

- empty headers, alternatives, or terms;
- missing or repeated `=`;
- malformed permission names;
- levels other than `read` or `write`; and
- the same permission at conflicting levels within one conjunction.

Input header text is never copied into an error.

For example:

```text
pull_requests=read,contents=read; issues=read,contents=read
```

canonicalizes to:

```json
[
  [
    { "permission": "contents", "level": "read" },
    { "permission": "issues", "level": "read" }
  ],
  [
    { "permission": "contents", "level": "read" },
    { "permission": "pull_requests", "level": "read" }
  ]
]
```

Missing evidence is not an empty requirement.

## Permission lattice

For one permission:

```text
absent < read < write
```

Different permission names are incomparable. A route requirement is
disjunctive normal form: an OR of one or more AND conjunctions.

GitHub currently models `admin` for at least one permission. GrantTrace does
not. Any unsupported level fails closed.

## Observation

Every NDJSON line is a strict safe object:

```ts
type Observation = {
  schemaVersion: 1;
  scenario: string;
  method: "DELETE" | "GET" | "HEAD" | "PATCH" | "POST" | "PUT" | "UNKNOWN";
  routeTemplate: string | null;
  status: number | null;
  requirements: PermissionDNF | null;
  evidenceSource: "runtime_header" | "pinned_catalog" | "none";
  finding:
    | null
    | "unresolved_route"
    | "missing_evidence"
    | "malformed_header"
    | "evidence_contradiction"
    | "unsupported_api";
};
```

The recorder accepts route identity only when it can resolve method and path to
exactly one canonical template in the pinned catalog. The injected fetch path
matches the supported GitHub REST origin and path against that catalog without
persisting the concrete URL. The explicit Octokit adapter can supply its
pre-expansion relative canonical template. Unrelated origins are ignored.
GraphQL, unsupported API versions, ambiguous or unmatched GitHub paths, and
unsafe candidates never undergo generic redaction: the candidate is discarded
and a safe finding blocks.

No raw header, URL, query, body, response, error, authentication value, owner,
repository, or resource identifier is stored.

## Recorder session

`record [--no-review] NAME -- COMMAND ARGS` (with legacy `--scenario NAME`
compatibility):

1. creates ignored, nonsymlink local state with private modes and ownership
   checks where the platform exposes them when state is absent;
2. validates a lowercase safe scenario name;
3. creates a `0700` temporary session;
4. injects the Node preload and launches argv with `shell: false` and the
   user's ordinary test environment plus recorder variables;
5. streams child stdout/stderr without retaining it;
6. enforces a default 15-minute timeout, bounded to one hour;
7. remembers a terminal interrupt independently of the child's eventual exit;
8. requires a recorder marker and at least one safe observation;
9. requires every observation to carry the requested scenario;
10. validates all observations in memory;
11. removes the session successfully;
12. only then atomically replaces the `0600` per-scenario NDJSON file;
13. unless review was explicitly deferred, builds and displays the aggregate
    contract diff; and
14. only in an interactive terminal, asks for explicit acceptance with a
    default of no.

A failed, interrupted, timed-out, unobserved, or empty child never replaces the
prior successful recording. An unresponsive child receives a bounded
force-kill escalation. A cleanup failure also prevents persistence.
Noninteractive recording never accepts a contract; a semantic diff exits `6`.
`--no-review` omits steps 13–14 so multi-scenario automation can finish every
recording before one required aggregate `check`.

## Evidence resolution

For each canonical route:

1. malformed runtime evidence blocks;
2. valid runtime and catalog DNF are canonicalized independently;
3. equal sources retain both provenance labels;
4. unequal sources become `evidence_contradiction`;
5. absent runtime evidence may use a known catalog requirement;
6. no usable source becomes `missing_evidence`; and
7. unknown routes and unsupported APIs remain blocking unknowns.

No source silently wins a disagreement.

Observations for the same route are merged deterministically. The route stores
the sorted unique set of scenario names that exercised it. A contradiction in
any scenario blocks the aggregate contract.

## Global solver

Routes are processed by canonical method/template order:

1. start with the empty assignment;
2. join every frontier candidate with every route alternative;
3. use the maximum level for repeated permission names;
4. deduplicate assignments;
5. remove assignments dominated in every permission dimension; and
6. fail if combination or frontier resource bounds are exceeded.

GitHub's mandatory `metadata:read` is supplied to the solver as a baseline.
Routes satisfied entirely by that baseline do not add `metadata` to
`selectedPermissions`.

The default selected sufficient contract uses:

1. fewest write permissions;
2. lowest total weight (`read = 1`, `write = 4`);
3. fewest distinct permissions; and
4. lexicographically smallest canonical assignment.

This is a deterministic risk policy, not universal optimality. Every
nondominated choice remains in `permissionFrontier`.

## Contract schema v2

`granttrace.lock.json` stores:

- schema, tool, API, and checksummed catalog identity;
- sorted unique scenario names;
- sorted canonical route templates;
- canonical DNF requirements and evidence provenance;
- sorted unique scenario attribution for every route;
- exact evidence provenance used by each scenario on a shared route;
- observed selected permissions;
- the nondominated permission frontier;
- separately documented manual keeps; and
- safe unknown findings.

Unless the contract intentionally contains zero scenarios, every declared
scenario must appear in route or unknown attribution. A zero-scenario v2
contract must also contain zero routes, selected permissions, and unknowns,
with the single empty assignment in its frontier. It is the explicit reviewed
representation of retiring all observed coverage. Validated manual keeps remain
until explicitly removed and remain unproven retained access. Routes must be
unique. Selected/frontier assignments are recomputed from the stored routes
during validation and must match exactly.

Serialization uses stable object construction, two-space JSON indentation, and
one trailing newline. It contains no timestamp, command, test path, working
directory, commit, machine value, proof result, raw URL, owner, repository,
resource ID, token, JWT, or private key.

Atomic writes create a sibling temporary file and rename it only after strict
serialization succeeds.

## Schema-v1 migration

A valid v1 contract remains readable. V1 routes have no scenario attribution,
so the reader conservatively attaches every declared scenario to every route.
This is intentionally broad and is exposed as `migratedFromV1`.

The migration:

- never guesses narrower route ownership;
- never silently writes the converted object;
- causes `check` to show a v1-to-v2 migration review;
- preserves validated manual keeps; and
- blocks `prove` until current observations are accepted as v2.

The deterministic migration path is:

```text
record current named scenarios
  -> granttrace check
  -> review permission, route, and attribution changes
  -> granttrace check --accept
```

Legacy schema-v2 contracts without per-scenario provenance remain readable.
They are conservatively expanded in memory, exposed as a migration review, and
blocked from `keep` and `prove` until current recordings are explicitly
accepted with per-scenario provenance.

## Multi-scenario operations

Local observation files are bounded to 128 files, 10,000 observations, and
10 MiB aggregate input. Files are loaded in ASCII filename order.

An atomic `.granttrace/active-operation` lock prevents overlapping write
operations from racing contract, observation, report, or session updates. A
stale lock is a doctor failure that must be inspected before it is removed.

`scenario list` reads and validates every recording. `scenario remove NAME`
removes only `.granttrace/observations/NAME.ndjson`; it does not edit the
accepted contract. The next check exposes the scenario, route, attribution,
and permission contraction for review. Removing the final recording is also a
reviewable change: acceptance writes the deterministic zero-scenario form while
preserving validated manual keeps.

For live proof, the accepted aggregate contract is sliced to the named
scenario:

- only routes attributed to that scenario remain;
- each retained route is attributed only to that scenario;
- selected/frontier permissions are solved again; and
- only unknowns belonging to that scenario remain.

Live observations must serialize exactly as that scenario slice after
validated manual keeps are applied.

## Manual keeps

A manual keep is:

```ts
type ManualKeep = {
  level: "read" | "write";
  reason: string; // trimmed, 1–240 plain-text characters
};
```

Keeps are canonicalized by permission name. A keep cannot duplicate access
already satisfied by selected permissions and cannot duplicate the mandatory
baseline. `metadata` is rejected by the CLI for that reason.

Reasons are committed review text: 1–240 plain-text characters without
secrets, URLs, or personal identifiers. Control, format, or invisible
characters and obvious token or private-key shapes are rejected before a
reason can be displayed or stored.

Manual keeps are global to the contract and participate in every scenario's
live token:

```text
requested = max(scenario selected, manual keeps)
effective = max(requested, mandatory baseline)
```

They do not participate in route solving and are never labeled observed or
proven necessary. Proof reports include the reasoned keep map and separate
selected, requested, mandatory, and effective assignments.

`keep add` and `keep remove` are explicit human mutations of the accepted
contract. `check` preserves valid existing keeps while rebuilding observed
evidence.

## Contract diff and acceptance

Without `--accept`, every semantic contract difference exits `6`. The review
includes:

- permission additions, escalations, reductions, and removals;
- scenario and route additions/removals;
- attribution additions/removals;
- DNF or evidence-provenance changes;
- manual-keep additions/removals/updates;
- tool, API, or catalog identity changes; and
- schema-v1 migration.

Unknown, malformed, unsupported, or contradictory evidence exits `7` before
acceptance. `check --accept`, or an explicit yes to the interactive `record`
prompt, writes the exact reviewed v2 contract atomically. There is no
interactive CI prompt and no noninteractive auto-acceptance.

## Live proof state machine

`prove NAME -- COMMAND ARGS` (with legacy `--scenario NAME` compatibility)
implements:

```text
strict accepted v2 contract validated
  -> named scenario slice solved
  -> every route and DNF rebound to the exact pinned catalog
  -> guarded fixture configuration validated
  -> requested = selected + manual keeps
  -> one-repository token minted
  -> effective = requested + mandatory baseline verified
  -> automatic recorder preload injected into restricted child
  -> restricted child run
  -> scenario observations reproduced exactly
  -> applicable negative controls run
  -> cleanup reported independently
  -> strict ephemeral report written
```

Catalog rebinding completes before GrantTrace loads credentials or mints a
token. The proof child runs directly without a shell, streams output, receives
the automatic Node recorder preload, requires valid observations, and has a
default 15-minute timeout bounded to 30 minutes. A timeout is indeterminate
evidence, never a permission result. A terminal interrupt is remembered
independently of the child's exit code and cannot become a pass if the child
handles the signal and exits zero.

Its environment starts from an operating-system allowlist. Broker credentials,
existing GitHub tokens, `HOME`, `NODE_OPTIONS`, and arbitrary environment
variables are absent. The child receives only the restricted installation
token, recorder/session values, focused fixture coordinates, and allowed
system values. This is credential isolation, not an OS sandbox.

The raw token response is conclusive only if it reports:

```text
effective permissions
  = scenario-selected permissions
  + manual keeps
  + mandatory metadata:read
```

It must also report exactly one expected repository and an expiry 45–65
minutes in the future. Missing effective-permission evidence and every other
difference block.

## Negative controls

The framework currently defines:

| ID | Mode | Target | Removed permission |
| --- | --- | --- | --- |
| `issue-comments-read` | read-only | list issue comments | `issues` |
| `issue-comment-create` | mutating | create an issue comment | `issues` |

A control is applicable only when:

- its exact route is present in the scenario contract;
- the selected assignment includes `issues`;
- no `issues` manual keep requires retention; and
- removing `issues` makes the target route's DNF unsatisfied.

The negative token is minted with that permission removed and the same strict
one-repository/effective-scope validation.

Only an authorization failure counts as expected rejection. `401`, `404`,
`429`, rate-limit `403`, `5xx`, network failure, expiry, and indeterminate
errors retain distinct classes. Unexpected success always fails. For the
mutating control, an unexpected created comment is deleted with the positive
token; cleanup failure is reported separately and blocks success. Read-only
controls never require cleanup. Unsupported controls are marked not applicable.

## Ephemeral proof report

`.granttrace/reports/<scenario>.json` uses strict schema v2 and stores only:

- schema/tool/API/catalog identity and source commit or `null`;
- scenario and deterministic aggregate contract hash;
- scenario-selected permissions;
- documented manual keeps;
- requested, mandatory, and effective assignments;
- repository-scope and exact-contract booleans;
- safe child exit/signal/observation counts;
- positive-proof state;
- negative-control IDs, modes, removed permissions, states, and cleanup; and
- aggregate cleanup state.

It cannot contain credentials, commands, raw URLs, identities, responses, or
rich errors. Unknown fields fail validation. The report directory is `0700`;
the file is `0600`.

Contract and observation inputs are size-bounded regular files. GrantTrace
rejects symlinks and other nonregular types, uses a no-follow open where the
platform supports it, and verifies that the file opened is the file that was
inspected. Proof reports are validated, atomically written outputs.

## Failure classes

```text
unknown_route
unsupported_api
missing_permission_evidence
malformed_permission_evidence
evidence_contradiction
authentication_failure
authorization_failure
resource_not_found_or_hidden
rate_limited
github_unavailable
token_expired
instrumentation_failure
test_failure
test_flake_or_indeterminate
cleanup_failure
invalid_token_response
missing_effective_permissions
effective_permission_mismatch
unverified_repository_scope
configuration_failure
contract_mismatch
```

A generic nonzero child exit is `test_failure`, never an inferred permission
rejection.

## CLI exit codes

| Code | Meaning |
| ---: | --- |
| `0` | Success |
| `2` | Invalid usage |
| `3` | Missing instrumentation or observations |
| `4` | Record-child test failure, timeout, or spawn failure |
| `5` | Invalid artifact, analysis, or live configuration |
| `6` | Contract review or migration required |
| `7` | Unknown, unsupported, malformed, or contradictory evidence |
| `8` | Proof, negative-control, or cleanup failure |
| `130` | Child interrupted by a terminal signal |

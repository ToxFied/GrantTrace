# GrantTrace protocol

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

> For the GitHub REST operations exercised by these named, instrumented
> scenarios, these are the permissions the scenarios demonstrably require.

The claim is bounded by dynamic scenario coverage and explicit Octokit
instrumentation. It does not extend to unexecuted code or unobserved traffic.

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

The recorder accepts route identity only when the pre-expansion Octokit
template is a relative canonical template that exactly matches the pinned
catalog. Absolute URLs, concrete paths, queries, GraphQL, and unmatched values
never undergo heuristic redaction: the candidate is discarded and the safe
finding blocks.

No raw header, URL, query, body, response, error, authentication value, owner,
repository, or resource identifier is stored.

## Recorder session

`record --scenario NAME -- COMMAND ARGS`:

1. validates a lowercase safe scenario name;
2. creates a `0700` temporary session;
3. launches argv with `shell: false` and the user's ordinary test environment
   plus recorder variables;
4. streams child stdout/stderr without retaining it;
5. enforces a default 15-minute bounded timeout;
6. requires an instrumentation marker and at least one safe observation;
7. requires every observation to carry the requested scenario; and
8. writes a `0600` per-scenario NDJSON file before removing the session.

A failed, interrupted, timed-out, uninstrumented, or empty child never replaces
the prior successful recording.

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
- observed selected permissions;
- the nondominated permission frontier;
- separately reasoned manual keeps; and
- safe unknown findings.

Every declared scenario must appear in route or unknown attribution. Routes
must be unique. Selected/frontier assignments are recomputed from the stored
routes during validation and must match exactly.

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

## Multi-scenario operations

Local observation files are bounded to 128 files, 10,000 observations, and
10 MiB aggregate input. Files are loaded in ASCII filename order.

`scenario list` reads and validates every recording. `scenario remove NAME`
removes only `.granttrace/observations/NAME.ndjson`; it does not edit the
accepted contract. The next check exposes the scenario, route, attribution,
and permission contraction for review.

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
  reason: string; // trimmed, 1–240 visible characters
};
```

Keeps are canonicalized by permission name. A keep cannot duplicate access
already satisfied by selected permissions and cannot duplicate the mandatory
baseline. `metadata` is rejected by the CLI for that reason.

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
acceptance. `check --accept` writes the exact reviewed v2 contract atomically.
There is no interactive CI prompt.

## Live proof state machine

`prove --scenario NAME -- COMMAND ARGS` implements:

```text
strict accepted v2 contract validated
  -> named scenario slice solved
  -> guarded fixture configuration validated
  -> requested = selected + manual keeps
  -> one-repository token minted
  -> effective = requested + mandatory baseline verified
  -> restricted child run
  -> scenario observations reproduced exactly
  -> applicable negative controls run
  -> cleanup reported independently
  -> strict ephemeral report written
```

The proof child uses argv plus `shell: false`, streams output, requires
instrumentation and safe observations, and has a bounded timeout. A timeout is
indeterminate evidence, never a permission result.

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
controls never require cleanup. Unsupported controls report
`not_applicable`.

## Ephemeral proof report

`.granttrace/reports/<scenario>.json` uses strict schema v2 and stores only:

- schema/tool/API/catalog identity and source commit or `null`;
- scenario and deterministic aggregate contract hash;
- scenario-selected permissions;
- reasoned manual keeps;
- requested, mandatory, and effective assignments;
- repository-scope and exact-contract booleans;
- safe child exit/signal/observation counts;
- positive-proof state;
- negative-control IDs, modes, removed permissions, states, and cleanup; and
- aggregate cleanup state.

It cannot contain credentials, commands, raw URLs, identities, responses, or
rich errors. Unknown fields fail validation. The report directory is `0700`;
the file is `0600`.

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
| `4` | Child test failure, interruption, or spawn failure |
| `5` | Invalid artifact, analysis, or live configuration |
| `6` | Contract review or migration required |
| `7` | Unknown, unsupported, malformed, or contradictory evidence |
| `8` | Proof, negative-control, or cleanup failure |
| `130` | Child interrupted by a terminal signal |

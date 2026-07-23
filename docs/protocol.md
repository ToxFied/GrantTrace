# GrantTrace protocol

## Versioning

- Observation schema: `1`
- Contract schema: `1`
- Pinned GitHub REST API: `2026-03-10`
- Offline catalog: `granttrace-fixture`, version
  `2026-03-10.fixture.1`, with a SHA-256 content identity

Unknown schema versions or additional unrecognized fields fail validation.

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
- access levels other than `read` or `write`;
- the same permission repeated at conflicting levels inside a conjunction.

Input text is never copied into an error.

For example:

```text
pull_requests=read,contents=read; issues=read,contents=read
```

becomes:

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

There is no ordering between different permission names. Current GitHub
schemas contain an `admin` value for at least one permission. Schema version 1
does not model it and fails closed.

## Observation

Each NDJSON line is a strict object:

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

No raw headers are stored. Recorder route identity is accepted only when the
pre-expansion Octokit template exactly matches the pinned catalog. Absolute,
concrete, query-bearing, and unmatched values produce `routeTemplate: null`.

## Evidence resolution

For each canonical route:

1. A malformed runtime header blocks.
2. Valid runtime DNF and pinned catalog DNF are canonicalized independently.
3. Equal sources retain both labels.
4. Unequal sources become `evidence_contradiction`.
5. Missing runtime evidence may use a known catalog route.
6. No usable source becomes `missing_evidence`.
7. Unknown routes and unsupported APIs remain blocking unknowns.

No source silently wins a disagreement.

## Global solver

Routes are processed by canonical method/template order.

1. Begin with the empty permission assignment.
2. Join every frontier candidate with every route alternative.
3. Use the maximum level for repeated permission names.
4. Deduplicate assignments.
5. Remove assignments dominated in every permission dimension.
6. Fail if the combination or frontier bound is exceeded.

The selected sufficient contract is chosen by:

1. fewest write permissions;
2. lowest total weight (`read = 1`, `write = 4`);
3. fewest distinct permissions;
4. lexicographically smallest canonical assignment.

This is a deterministic default risk policy, not universal optimality.
Nondominated choices remain in `permissionFrontier`.

## Contract

`granttrace.lock.json` contains, in stable order:

- schema, tool, API, and catalog identity;
- sorted scenario identifiers;
- sorted canonical routes and DNF requirements;
- evidence labels;
- selected permissions;
- nondominated frontier assignments;
- manual keeps (currently empty);
- safe unknown findings.

It contains no timestamp, commit, command, proof result, URL, owner,
repository, resource ID, token, or private key. Serialization uses two-space
JSON indentation and exactly one trailing newline.

## Ephemeral proof report

`.granttrace/report.json` is separate from the deterministic contract. Its
strict schema permits only:

- schema, tool, API, and catalog identity;
- a validated scenario and source commit, or `null` when unavailable;
- the contract SHA-256 hash;
- selected, mandatory-baseline, and effective permission assignments;
- a boolean repository-scope verification result;
- a boolean exact-contract reproduction result;
- allowlisted child exit status, signal, and observed-operation count;
- positive-proof, negative-control, and cleanup states.

It cannot contain a token, JWT, private key, command, raw URL, owner,
repository, resource ID, response, or error. Unknown fields fail validation
instead of being redacted. The report directory uses mode `0700` and the file
uses `0600`.

## Diff policy

| Finding | Result |
| --- | --- |
| New permission | fail |
| `read` to `write` | fail prominently |
| New unknown | fail |
| Malformed evidence | fail |
| Runtime/catalog contradiction | fail |
| Unsupported GraphQL | fail |
| No longer observed in a pure coverage contraction | warn; exit successfully |
| `write` to `read` | show explicitly |
| Unchanged byte-stable contract | pass |

Only `check --accept` writes the contract. There is no interactive CI prompt.
Validated manual keeps already present in the contract are preserved and shown
separately with their human-written reason; they are never folded into the
observed selected contract.

## CLI exit codes

| Code | Meaning |
| ---: | --- |
| 0 | success |
| 2 | invalid command usage |
| 3 | missing instrumentation or no observations |
| 4 | instrumented child-test failure/interruption |
| 5 | unsafe or invalid artifact / analysis failure |
| 6 | contract review required |
| 7 | unknown, unsupported, malformed, or contradictory evidence |
| 8 | live proof or negative-control failure |

## Proof state machine

`granttrace prove --scenario <safe-name> -- <argv...>` implements:

```text
configuration validated
  -> accepted single-scenario contract validated
  -> token minted
  -> selected + mandatory effective permissions verified
  -> restricted child run
  -> observations resolved
  -> accepted contract reproduced exactly
  -> optional valid negative control
  -> cleanup reported independently
  -> strict ephemeral report written
```

Authentication, authorization, rate limiting, GitHub availability, expiry,
test failure, indeterminate flakes, and cleanup failure are separate terminal
classifications. A generic nonzero child exit is not a permission rejection.

The proof-child runner launches an argv array with `shell: false`, streams
rather than captures output, requires the recorder marker and at least one safe
observation for success, and terminates a hung child after a bounded timeout.
A timeout is indeterminate evidence, never a permission result.

The proof child environment is constructed from a small operating-system
allowlist. It does not inherit `HOME`, `NODE_OPTIONS`, existing GitHub tokens,
the App private key, App/installation broker variables, the disposable
confirmation, or arbitrary environment variables. It receives:

- the restricted installation token as `GITHUB_TOKEN`;
- recorder mode, scenario, and session-directory values;
- the disposable owner, repository, and issue coordinates required by the
  focused fixture.

The raw token response is conclusive only when it reports:

```text
effective permissions
  = selected requested permissions
  + mandatory metadata:read
```

It must also report exactly one expected repository and a fresh expiry
consistent with GitHub's one-hour lifetime. The token string is opaque.
Missing mandatory access or any additional effective access is a blocking
mismatch.

The current proof MVP requires the accepted contract to contain exactly the
named scenario, no unknowns, and no manual keeps. Live observations must
reproduce the full serialized contract, including route alternatives and
evidence labels. These restrictions avoid claiming scenario attribution or
manual-keep enforcement that schema version 1 cannot prove.

For the issue-comment route selected as `issues:write`, the negative control
mints a one-repository token without `issues:write` and executes that exact
comment operation. Only a non-rate-limited `403` counts as the expected
authorization rejection. `401`, `404`, `429`, rate-limit `403`, `5xx`, network
failure, expiry, test failure, and an unexpected success stay distinct. If the
unexpected request creates a comment, deletion runs before the failure is
reported.

Current proof-related failure classes are:

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

A plain `403` is `authorization_failure`; it is never, by itself, called a
missing-permission rejection.

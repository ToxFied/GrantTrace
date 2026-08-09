---
title: Threat model
description: Assets, trust boundaries, controls, and residual risks.
---

## Security objective

GrantTrace is designed to make scenario-bound GitHub App REST permission
evidence deterministic, reviewable, identity-free, and safe to prove against a
disposable one-repository installation.

It is not designed to sandbox arbitrary test code, protect a compromised
developer machine, or establish whole-application least privilege.

## Assets

- GitHub App private key and short-lived JWT
- installation access tokens
- repository and account identities
- concrete resource identifiers and paths
- integrity of observations and the accepted contract
- integrity and provenance of the pinned catalog
- ephemeral proof reports and cleanup state
- package and CI supply chain

## Trust boundaries

GrantTrace trusts:

- its installed code and resolved dependency graph;
- the local operating system's file and process primitives;
- explicitly chosen test code to behave as ordinary trusted project code; and
- a human reviewer to decide whether contract changes are acceptable.

GrantTrace does not trust:

- observation and contract files loaded from disk;
- proof-report objects before strict allowlisted serialization;
- GitHub response headers or token responses;
- catalog entries before canonicalization and identity calculation;
- rich Octokit request, response, and error objects;
- CLI text as structured data;
- an arbitrary child command as a source of permission conclusions; or
- live failures to mean “missing permission” without focused classification.

`record` runs the user's normal test process and inherits its ordinary
environment. A malicious test can read that environment, forge local marker
files, print credentials, or exfiltrate data. GrantTrace does not claim to
contain it.

`prove` uses a narrower boundary: a broker holds App credentials and creates a
fresh allowlisted child environment containing one restricted installation
token and GrantTrace's recorder preload. Parent `NODE_OPTIONS` is not inherited.
This isolates broker credentials; it is still not an OS sandbox.

## Threats and controls

### Overclaiming coverage

The terminal, README, contract semantics, and reports consistently bind the
claim to named, recorded scenarios. Routes carry deterministic scenario
attribution and per-scenario evidence provenance in schema v3. Proving one
scenario slices and resolves only its attributed routes and exact provenance.
Unknown and unobserved behavior never becomes an empty requirement. Automatic
recording is limited to supported Node global-`fetch` traffic targeting exactly
`https://api.github.com`. Off-origin responses cannot manufacture automatic
runtime-header evidence. A custom transport, different runtime, or child that
drops the injected preload is outside the result unless it uses the explicit
GrantTrace adapter.

### Forged or malformed local artifacts

Observation and contract input schemas are strict and resource-bounded;
proof-report objects are strictly validated before serialization.
Semantic contract validation recomputes the permission frontier from routes,
requires the selected permissions to equal one complete frontier assignment,
and verifies scenario attribution. Unknown fields fail instead of being spread,
preserved, or redacted.

Contracts are written through a sibling temporary file and rename. Local
observations and proof reports use allowlisted serialization. Contract and
observation reads are size-bounded and accept only regular files; symlinks and
other special files are rejected. GrantTrace uses no-follow opens where
available and compares the opened file with the inspected file before reading.

### App private-key leakage

GrantTrace accepts no credentials through CLI arguments.

Exactly one key provider is required:

- an injected environment value;
- an absolute private-key file with an owned nonsymlink `0700` parent and
  owned regular `0600` file; or
- macOS Keychain lookup through `/usr/bin/security` with validated argv.

The key is validated as RSA, bounded in size, wrapped in a redacting value, and
retained by the token broker. It never enters the proof child, observation,
contract, report, command, or terminal output. Provider failures never echo
rejected values.

### Installation-token leakage

Tokens are opaque; no prefix or fixed length is assumed. A redacting wrapper
protects ordinary stringification and inspection. Only the proof child
environment receives the short-lived restricted token as `GITHUB_TOKEN`.
GrantTrace does not persist authorization headers or rich errors.

The proof child can deliberately print or exfiltrate its token. Isolation
limits its privilege and lifetime; it does not make malicious code safe.

### Recorder input leakage

Fetch and Octokit request options, response bodies, errors, and headers can
contain credentials, concrete URLs, and private data. The recorder reads only
the minimum fields required to resolve a catalog route and permission evidence:

- method;
- a supported GitHub REST path for catalog matching, or the explicit adapter's
  pre-expansion candidate template;
- numeric status; and
- one lower-cased accepted-permissions header.

It resolves a catalog template and constructs a new strict observation. It
never serializes or spreads the source object or persists the concrete URL.

### Concrete URL, query, and identity leakage

Only a supported GitHub REST request that resolves uniquely to the pinned
catalog, or an explicit relative canonical template that exactly matches it,
is accepted. GrantTrace does not attempt generic ID redaction. Unrelated
origins are ignored. Ambiguous or unmatched GitHub paths and unsafe candidates
are discarded; only method plus a safe finding remains. Query values are never
persisted.

Contracts contain no commands, local paths, owners, repositories, resource
IDs, timestamps, or machine values. Proof reports omit fixture coordinates and
raw responses.

### Runtime/catalog contradiction

Runtime DNF and catalog DNF are canonicalized independently. Valid
disagreement blocks. Malformed runtime evidence cannot fall back. Missing
runtime evidence can use only a known catalog entry.

Catalog identity covers sorted method/template, canonical DNF, and official
documentation URL. A catalog or API identity change becomes a contract review.
Resource bounds prevent adversarial solver explosion.

### Stale or ambiguous catalog evidence

The catalog is curated from official GitHub documentation for pinned API
version `2026-03-10`. The review workflow checks duplicate routes, safe
templates, documentation URLs, deterministic checksum, and exact entry count.
Conditional requirements without authoritative AND/OR semantics are excluded.

The stale flattened `@octokit/app-permissions` data is not imported as truth.

### Broader-than-requested live tokens

Before credentials are loaded, proof requires exact tool, API, and catalog
identity and rebinds every accepted route DNF to the current pinned catalog.
Production proof has no broad-token discovery or feasibility path: it mints
only the restricted positive and applicable negative-control tokens after that
validation succeeds.

The raw token endpoint response is mandatory. GrantTrace independently
requires:

```text
effective
  = scenario-selected
  + global manual keeps
  + mandatory metadata:read
```

Missing permissions, additional permissions, unsupported levels, omitted raw
scope, broad repository selection, wrong repository, and implausible expiry
all block. Every token must report exactly one expected repository.

Manual keeps remain separate from observed evidence and include a human
reason. They are requested and verified but never called proven necessity.

### Accidental production targeting

Live configuration requires:

- explicit disposable confirmation equal to `1`;
- a repository name ending in `-granttrace-fixture`;
- numeric App, installation, and issue identifiers;
- a valid RSA private key; and
- a manually created one-repository installation.

GrantTrace never changes App settings or repository selection. These controls
reduce accidents; operators must still verify the fixture contains no real
data.

### Command and shell injection

Commands after `--` are passed as an argv array with `shell: false`.
GrantTrace never evaluates a command string. The macOS Keychain command also
uses a fixed executable and validated argv.

Record and proof children have bounded timeouts, receive termination followed
by a bounded force-kill path, and are cleaned only after process close.
Output is streamed rather than captured. A parent terminal interrupt is
tracked independently, so a child that handles the signal and exits zero
cannot turn an interrupted session into accepted evidence.

### Misclassifying failures as permission evidence

Positive child failure is a test result, never negative permission evidence.
Negative controls run only when removing the target permission makes the
specific route unsatisfied.

Authentication, authorization, hidden/not-found resources, rate limits,
expiry, GitHub availability, test failure, timeout/indeterminacy, and cleanup
failure remain distinct. Unexpected control success fails.

### Mutation residue

The positive example deletes its disposable comment in `finally`. The
mutating negative control normally expects rejection and creates nothing. If
it unexpectedly succeeds, cleanup uses the positive token before reporting
failure.

Cleanup is modeled independently. Any local session or live mutation cleanup
failure prevents an unqualified pass and remains visible in the strict report.

### Unsafe or stale local state

Managed `.granttrace/` directories must be owned, nonsymlink directories with
mode `0700`; managed observations and reports are regular `0600` files.
`record` initializes ignored state when it is absent. `record` and `prove`
refuse to start when existing state is unsafe or stale. The operator must
inspect possible live residue before removing a stale proof session.

### CI and artifact leakage

`.granttrace/` is private ignored state. Reports are `0600` within `0700`
directories and are not uploaded. The package allowlist includes production
`dist`, `LICENSE`, and `README.md`, excluding tests, observations, reports,
caches, and development residue.

Leakage checks scan the repository and packed artifact for credential shapes,
fixture-identity canaries, private material, and forbidden state. These are
defense in depth, not a substitute for secret revocation after exposure.

### Supply-chain compromise

The project is one package with a committed pnpm lockfile, Node 22 floor, two
runtime dependencies, a production audit gate, and a clean build before
packing. CI uses minimal permissions and pins third-party Actions to full
commit SHAs. Live fixture secrets are absent from offline pull-request jobs.

Dependency, registry, runner, operating-system, and maintainer-account
compromise remain outside what repository checks can fully prevent.

## Residual risks

- Trusted project tests can expose their environment during `record`.
- Proof tests can misuse their restricted installation token.
- Dynamic tests can miss production behavior.
- GitHub documentation or platform behavior can change after the catalog
  review date.
- File modes do not provide equivalent protection on every filesystem.
- A compromised machine can observe process memory, Keychain access, and file
  reads.
- Reviewers can accept an unsafe permission or coverage change.

These risks are why GrantTrace's claim stays scenario-bound and why live proof
requires a disposable one-repository fixture.

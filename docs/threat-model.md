# Threat model

## Assets

- GitHub App private key and JWT
- installation access tokens
- repository and organization identities
- concrete resource IDs and paths
- deterministic permission contract
- ephemeral observations and proof reports
- integrity of the pinned route catalog

## Trust boundaries

GrantTrace trusts its local code and package lock. It does not trust:

- observation or contract files loaded from disk;
- GitHub response headers;
- catalog data before schema/checksum validation;
- CLI arguments as structured data;
- arbitrary test code;
- rich Octokit request, response, and error objects.

The current `record` command runs the user's normal test process and inherits
its normal environment. A malicious or compromised test can read that
environment, forge the plugin marker, print tokens, or exfiltrate data.
GrantTrace does not claim to sandbox tests.

The `prove` path uses a different boundary: it builds a new child environment
from a small allowlist and adds only a restricted installation token and the
nonsecret values needed by the focused fixture.

## Threats and controls

### Malicious or compromised test code

The recorder observes only opted-in Octokit calls and cannot contain arbitrary
code. It never captures child stdout/stderr. The proof environment builder
starts fresh, omits every App/broker credential and existing GitHub token, and
adds only the short-lived restricted token plus nonsecret recorder/fixture
configuration. This is credential isolation, not a sandbox for malicious test
code.

### App private-key leakage

The broker keeps the private key behind a redacting wrapper, creates the App
JWT in memory, and sends only that JWT to the token transport. The private key
never enters the child environment, arguments, observations, reports, or logs.
This boundary has been exercised against the disposable fixture.

### Installation-token leakage

Tokens are treated as opaque. No prefix or fixed length is assumed. The
recorder never persists authorization headers or rich errors. Redacting
wrappers make ordinary stringification/inspection safe, and secret-canary
tests cover installation- and user-token-like values. A proof token lives in
memory and the restricted child environment only.

### Rich Octokit error leakage

The error object can contain request headers, concrete URL, body, response
body, and authentication material. Recorder code reads only:

- numeric status;
- one lower-cased accepted-permissions header.

It constructs a new observation and never serializes or spreads the error.

### Concrete URL and query leakage

The recorder accepts only a relative, pre-expansion template that exactly
matches the pinned catalog. It never attempts generic ID redaction. Absolute,
concrete, query-bearing, or unmatched routes persist only method and a reason
code; the candidate URL is discarded.

### Request/response body and cookie leakage

Bodies and headers are never members of the observation schema. Tests inject
body, PEM, cookie, UUID, numeric-ID, query, owner, and repository canaries and
scan every produced artifact and terminal report.

### Malicious or stale catalog data

The catalog boundary canonicalizes and validates DNF. Contracts record catalog
source, version, and SHA-256 checksum. Solver combination/frontier bounds stop
adversarial explosion. Runtime/catalog disagreement blocks. The current tiny
fixture is intentionally not broad coverage.

### GitHub response disagreement

Runtime evidence never silently overrides the catalog and the catalog never
silently overrides valid runtime evidence. Contradiction is a release-blocking
finding.

Token responses are independently strict. GrantTrace distinguishes the
selected contract from GitHub's unavoidable `metadata:read` baseline and
requires the effective assignment to equal exactly their union. Missing
metadata, omitted permission evidence, or any other additional permission
blocks proof.

### Child-process command injection

Commands after `--` are passed as an argv array with `shell: false`.
GrantTrace does not evaluate a command string. An integration test passes shell
metacharacters and verifies that no sentinel file is created.

The proof runner applies the same rule, streams child output without retaining
it, and has a bounded timeout with termination and post-close session cleanup.

### CI artifact leakage

The deterministic contract is allowlisted and identity-free. `.granttrace/`
is ignored. The proof report uses a separate strict allowlist, mode `0600`,
and omits secrets, commands, raw URLs, rich errors, and concrete resource
identities. Unknown report fields are rejected rather than redacted.

### Supply-chain compromise

The project is a single package with a committed pnpm lockfile and few runtime
dependencies. A future GitHub Action must pin third-party Actions to full
commit SHAs. Dependency review remains an operator responsibility.

### Accidental production targeting

Live configuration requires exact confirmation, numeric fixture identifiers,
a valid RSA App key, and a repository name ending in
`-granttrace-fixture`. Live proof requires an explicitly user-created
disposable App installation restricted to one repository. GrantTrace does not
modify App permissions or broaden installation scope. Every raw token response
must independently prove that one-repository scope.

### Cleanup failure

Local recorder and proof-session cleanup runs after process close. The live
fixture scenario deletes its positive comment in `finally`; a deletion failure
makes the child fail. An unexpected negative-control success is also deleted
with the positive restricted token before the control fails. Cleanup failure
is reported separately, and no run with failed cleanup is an unqualified pass.

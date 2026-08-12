# Contributing to GrantTrace

GrantTrace is a security-sensitive CLI. Prefer small, reviewable changes with
explicit evidence over broad abstractions.

Use the matching issue template for reproducible bugs, product proposals, or
catalog routes. Suspected vulnerabilities belong in the private process in
[SECURITY.md](SECURITY.md), never a public issue.

## Local setup

Requirements: Node.js 22 and the pnpm version pinned in `package.json`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
pnpm audit --prod
```

Before sending a change:

```bash
pnpm catalog:review
pnpm package:smoke
pnpm leakage:scan
git diff --check
```

`pnpm verify` covers typechecking, tests, production build, deterministic
contract reproduction, and CI-policy validation.

Describe the user-visible outcome in the pull request, call out any trust-
boundary change, and list the focused verification you ran. Update
[CHANGELOG.md](CHANGELOG.md) when the change affects beta users.

## Design boundaries

Preserve these unless authoritative GitHub evidence requires a documented
change:

- GitHub REST API version `2026-03-10` is explicit.
- The claim is bound to named, instrumented scenarios.
- Unknown routes and malformed or contradictory evidence fail closed.
- AND/OR permission alternatives remain exact.
- `metadata:read` is a mandatory baseline, not selected evidence.
- Manual keeps use validated identity-free, secret-free committed reasons and
  are requested but never called observed or proven necessity.
- Effective live access must equal selected plus manual keeps plus the
  mandatory baseline.
- Credentials never enter CLI arguments, contracts, observations, reports, or
  proof-child broker state.
- Children use argv and `shell: false`; output is streamed, not retained.
- Cleanup failure prevents an unqualified pass.
- Authentication, authorization, hidden resources, rate limits, expiry,
  outages, test failures, and cleanup remain distinct.

## Tests

Add focused tests for changed behavior. Security and serialization changes
usually need:

- malformed and boundary inputs;
- deterministic or golden output;
- concurrency and atomic-write behavior;
- interruption, timeout, and cleanup failure;
- shell metacharacters;
- secret and identity canaries; and
- proof/report fail-closed cases.

Tests must not make unguarded live GitHub calls. Use injected transports and
local fixtures.

The deterministic oracle suite, per-file coverage floors, and opt-in benchmark
workflow are documented in [docs/assurance.mdx](docs/assurance.mdx). Run
`pnpm test:assurance` for the focused correctness checks. Performance
measurements are intentionally separate from `pnpm test` and CI.

## Catalog changes

Read [docs/catalog.md](docs/catalog.md). Use official GitHub documentation for
the pinned API version, retain its URL in the entry, model DNF exactly, and
exclude ambiguous conditional requirements. Do not use the flattened
`@octokit/app-permissions` package as authoritative truth.

## Package inspection

Apart from npm's required `package.json`, the package tarball must contain only
production `dist`, `LICENSE`, and `README.md`. Never include tests, local
observations, proof reports, credentials, fixture identities, caches, or
development residue.

`pnpm package:smoke` creates one fresh npm tarball, compares npm's returned
manifest with that archive, and installs the same package into both an npm
consumer and a strict isolated, non-hoisting pnpm consumer. It checks public
exports and types plus the installed CLI and offline record/check workflow. CI
repeats the smoke test on Linux, macOS, and Windows.

The protected release workflow runs `pnpm package:artifact` once, then passes
`.release/granttrace.tgz` explicitly to package smoke, leakage scan, and npm
publish. Those release gates must consume that exact artifact; the no-argument
commands remain the local fresh-pack checks.

Do not publish npm packages, create releases/tags, deploy, change repository
visibility, expose secrets, or run a live fixture proof as part of a normal
contribution.

# Contributing to GrantTrace

GrantTrace is a security-sensitive CLI. Prefer small, reviewable changes with
explicit evidence over broad abstractions.

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

## Design boundaries

Preserve these unless authoritative GitHub evidence requires a documented
change:

- GitHub REST API version `2026-03-10` is explicit.
- The claim is bound to named, instrumented scenarios.
- Unknown routes and malformed or contradictory evidence fail closed.
- AND/OR permission alternatives remain exact.
- `metadata:read` is a mandatory baseline, not selected evidence.
- Manual keeps are reasoned and requested but never called proven necessity.
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

## Catalog changes

Read [docs/catalog.md](docs/catalog.md). Use official GitHub documentation for
the pinned API version, retain its URL in the entry, model DNF exactly, and
exclude ambiguous conditional requirements. Do not use the flattened
`@octokit/app-permissions` package as authoritative truth.

## Package inspection

Apart from npm's required `package.json`, `pnpm pack` must contain only
production `dist`, `LICENSE`, and `README.md`. Never include tests, local
observations, proof reports, credentials, fixture identities, caches, or
development residue.

Do not publish npm packages, create releases/tags, deploy, change repository
visibility, expose secrets, or run a live fixture proof as part of a normal
contribution.

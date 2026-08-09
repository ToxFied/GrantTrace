---
title: Limitations
description: Exact boundaries and unsupported cases in GrantTrace's guarantee.
---

GrantTrace is dynamic, scenario-bound, and REST-only. These boundaries are
part of the result, not footnotes.

## Coverage

- A contract describes only GitHub REST operations exercised by the named,
  recorded scenarios.
- A passing check or proof does not certify untested code paths, missing test
  cases, webhook handling, background jobs, or production-only behavior.
- A permission absent from the contract is not automatically safe to remove
  from an existing App installation.
- Automatic recording and proof observe supported requests through Node's
  global `fetch` only when they target exactly `https://api.github.com`,
  including standard Octokit clients. Off-origin responses are ignored even
  when they include a permission-like header. Custom fetch
  implementations, custom transports, workers or subprocesses that discard the
  injected Node options, non-Node runtimes, and unsupported GitHub Enterprise
  endpoints are outside automatic coverage. The explicit
  `GrantTraceOctokit` constructor or exact-version plugin composition is the
  fallback for compatible advanced Octokit setups. GrantTrace does not
  intercept arbitrary network traffic.
- Re-recording a scenario replaces its prior local evidence. It does not
  combine multiple historical executions or measure test coverage.
- The pinned catalog covers 49 route templates, not the whole GitHub REST API.
  Unknown templates fail closed. Exact coverage is in
  [REST catalog](/docs/catalog).

## APIs and permission modeling

- GitHub REST API `2026-03-10` is the only supported API version.
- GraphQL is unsupported and blocks coverage.
- GrantTrace models `read` and `write`. Any other access level, including
  `admin`, fails closed rather than being coerced to `write`.
- Runtime accepted-permission headers are not documented as universally
  present. Missing runtime evidence uses the pinned catalog only for a known
  route; otherwise it blocks.
- A change in runtime header availability can change evidence provenance and
  therefore block exact reproduction even when selected permissions stay the
  same.
- GitHub's route documentation sometimes lists conditional “additional
  permissions” without an unambiguous AND/OR relationship. Those routes are
  excluded until authoritative evidence supports a precise DNF requirement.
- `@octokit/app-permissions` is not authoritative. Its published data is stale
  and its flattened model loses alternatives.

## Contracts and migration

- Schema v2 attributes routes to scenario names, not commands, test files, or
  source-code locations.
- A schema-v1 contract is read conservatively by attributing every route to
  every declared scenario. `prove` blocks until current recordings are
  reviewed and accepted as v2.
- Contract acceptance is a human decision. An interactive `record` prompt or
  `check --accept` can accept a coverage contraction just as it can accept an
  addition; review removals carefully. Noninteractive recording never accepts.
- The deterministic selected solution is one risk-policy choice among the
  nondominated frontier, not proof that every alternative is worse.
- Manual keeps are global to the accepted contract and therefore requested in
  every scenario proof. They are explicitly retained access, never observed
  or proven necessity. Retiring the final scenario preserves validated keeps
  until they are explicitly removed.

## Live proof

- Live proof depends on the reliability and coverage of the user's test,
  GitHub's availability, and a correctly configured disposable fixture.
- Proof is scenario-scoped. It reproduces the accepted route/evidence slice
  for one scenario and does not execute every scenario automatically.
- Before loading credentials, proof requires exact tool/API/catalog identity
  and rebinds every accepted route DNF to the current pinned catalog.
- Production proof has no broad-token discovery path. It mints only restricted
  positive and applicable negative-control tokens after validation succeeds.
- GitHub adds mandatory `metadata:read` to repository installation tokens.
  GrantTrace reports it separately and requires effective permissions to
  equal scenario-selected permissions plus all manual keeps plus that
  baseline.
- A raw token response that omits effective permissions, reports additional
  access, reports missing access, cannot prove exactly one expected
  repository, or has an implausible expiry blocks proof.
- Built-in negative controls currently cover only issue-comment reads and
  issue-comment creation. A control is not applicable when the route is
  absent, removing `issues` would leave another valid alternative, or an
  `issues` manual keep prevents removal.
- Proof strength is calculated only from those built-in controls. A successful
  reproduction with no applicable control says `restricted_scope_reproduced`;
  coverage of only some selected permissions says
  `necessity_partially_tested`. `necessity_tested` requires coverage of every
  selected permission, but remains limited to the named scenario and does not
  claim that manual keeps or mandatory access are necessary.
- An authorization-shaped `403` is accepted only in the focused negative
  control. Authentication failures, rate limits, hidden resources, expiry,
  outages, test failures, and generic nonzero exits remain distinct.
- Mutating controls are reversible but still make a live request. Unexpected
  success fails; cleanup failure prevents an unqualified pass.
- The restricted proof environment isolates App broker credentials but is not
  an OS sandbox. The proof child receives a short-lived installation token and
  can use or print it.
- `sourceCommit` in a proof report is HEAD only for a clean Git index and
  worktree. Dirty, untracked, unavailable, and non-Git states produce `null`;
  this field is provenance context, not a signed attestation.

## Privacy and operations

- GrantTrace streams child stdout/stderr. It does not retain output, but it
  cannot stop user test code from printing secrets.
- `record` inherits the ordinary test environment. Treat the scenario as
  trusted code.
- Local `.granttrace/` data is automatically ignored by the first recording,
  not encrypted. `init` remains an optional explicit setup command.
- macOS Keychain support shells out to `/usr/bin/security`; other platforms
  must use an environment secret or an absolute private-key file.
- Private-key file validation requires an owned, nonsymlink parent directory
  with exact mode `0700` and an owned regular file with exact mode `0600`.
- On Unix-like systems, managed children run in their own process group so
  timeout and interrupt escalation reaches descendants. Live proof is blocked
  on Windows because equivalent arbitrary descendant cleanup cannot be
  verified. Recording, checking, analysis, and contract review remain
  supported there.
- The package and CI checks reduce accidental leakage and supply-chain risk;
  they cannot eliminate compromise of Node, pnpm, GitHub Actions, dependencies,
  or the operator's machine.

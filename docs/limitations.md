# Limitations

GrantTrace is dynamic, scenario-bound, and REST-only. These boundaries are
part of the result, not footnotes.

## Coverage

- A contract describes only GitHub REST operations exercised by the named,
  instrumented scenarios.
- A passing check or proof does not certify untested code paths, missing test
  cases, webhook handling, background jobs, or production-only behavior.
- A permission absent from the contract is not automatically safe to remove
  from an existing App installation.
- Instrumentation is explicit. Only requests made through the supported
  `@octokit/core` plugin are observable; GrantTrace does not intercept
  arbitrary network traffic.
- Re-recording a scenario replaces its prior local evidence. It does not
  combine multiple historical executions or measure test coverage.
- The pinned catalog covers 49 route templates, not the whole GitHub REST API.
  Unknown templates fail closed. Exact coverage is in
  [catalog.md](catalog.md).

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
- Contract acceptance is a human decision. `check --accept` can accept a
  coverage contraction just as it can accept an addition; review removals
  carefully.
- The deterministic selected solution is one risk-policy choice among the
  nondominated frontier, not proof that every alternative is worse.
- Manual keeps are global to the accepted contract and therefore requested in
  every scenario proof. They are explicitly retained access, never observed
  or proven necessity.

## Live proof

- Live proof depends on the reliability and coverage of the user's test,
  GitHub's availability, and a correctly configured disposable fixture.
- Proof is scenario-scoped. It reproduces the accepted route/evidence slice
  for one scenario and does not execute every scenario automatically.
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
- An authorization-shaped `403` is accepted only in the focused negative
  control. Authentication failures, rate limits, hidden resources, expiry,
  outages, test failures, and generic nonzero exits remain distinct.
- Mutating controls are reversible but still make a live request. Unexpected
  success fails; cleanup failure prevents an unqualified pass.
- The restricted proof environment isolates App broker credentials but is not
  an OS sandbox. The proof child receives a short-lived installation token and
  can use or print it.

## Privacy and operations

- GrantTrace streams child stdout/stderr. It does not retain output, but it
  cannot stop user test code from printing secrets.
- `record` inherits the ordinary test environment. Treat the scenario as
  trusted code.
- Local `.granttrace/` data is ignored by `init`, not encrypted.
- macOS Keychain support shells out to `/usr/bin/security`; other platforms
  must use an environment secret or an absolute private-key file.
- Private-key file validation requires an owned, nonsymlink parent directory
  with exact mode `0700` and an owned regular file with exact mode `0600`.
- The package and CI checks reduce accidental leakage and supply-chain risk;
  they cannot eliminate compromise of Node, pnpm, GitHub Actions, dependencies,
  or the operator's machine.

# Limitations

GrantTrace is dynamic and coverage-bound.

- A contract describes only GitHub REST operations exercised by the named,
  instrumented scenarios.
- A passing check does not certify untested code paths.
- A permission that was not observed is not necessarily safe to remove from a
  real installation.
- Plugin opt-in is required. GrantTrace cannot inspect arbitrary child-process
  traffic.
- Only `@octokit/core` is supported in the current slice.
- Only REST is supported. GraphQL is reported as unsupported and blocks proof
  coverage.
- The fixture catalog covers two routes. Unknown routes fail closed.
- `read` and `write` are modeled. Current GitHub schemas also contain `admin`;
  it is deliberately rejected until its lattice and proof behavior are
  explicitly implemented.
- Runtime permission headers are not documented as universally present.
  Missing evidence uses the pinned fallback when available and otherwise
  blocks.
- `@octokit/app-permissions` is not a trusted fallback because its schema
  flattens alternatives and its published package is stale.
- Negative controls are not universally automatable. Another alternative may
  still satisfy a route.
- Live proof inherits the reliability of the user's tests and GitHub.
- GitHub adds mandatory `metadata:read` to repository installation tokens.
  GrantTrace reports it separately from the selected contract and requires the
  effective assignment to equal exactly their union.
- Schema version 1 does not attribute individual routes to scenarios.
  `prove` therefore requires one named scenario per accepted contract.
- `prove` refuses manual keeps because the current contract separates them
  from selected permissions and cannot yet prove that they were intentionally
  included in the live grant.
- Exact proof includes evidence labels. If GitHub omits a runtime permission
  header that was present when the accepted contract was recorded, proof
  blocks even if the pinned catalog implies the same selected permissions.
- The built-in negative control applies only when removing `issues:write`
  makes the focused issue-comment route unsatisfied. Other contracts report
  the control as not applicable.
- The proof environment isolates credentials but is not an OS sandbox.
- The recorder does not retain stdout/stderr. User test code can still print a
  token itself.

These boundaries are part of the product result and must remain visible in
human and machine-readable reports.

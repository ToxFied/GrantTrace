# GrantTrace agent instructions

## Verification before shipping

- A request that includes both changes and shipping authorizes the relevant
  verification commands below, including builds, before the final Git
  operation.
- After the last source, test, configuration, or workflow change, run
  `pnpm verify` on Node 22 or Node 24 before invoking the fast `$ship` step.
- When `docs/**` or `website/**` changes, also run `pnpm docs:typecheck`,
  `pnpm docs:build`, and `pnpm docs:validate`.
- When package contents or package-consumer behavior changes, also run
  `pnpm package:smoke` and `pnpm leakage:scan`.
- Do not claim a change is ready to ship from partial checks.
- Keep `main` protected by required pull requests and required CI checks. Do
  not weaken or bypass those protections to ship a change.

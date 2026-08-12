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

## Automated review before shipping

- Every pull request opened or reused by `$ship` is expected to receive reviews
  from GitHub Copilot (`copilot-pull-request-reviewer[bot]`) and Codex
  (`chatgpt-codex-connector[bot]`).
- Do not merge until both bots have emitted terminal evidence for the latest
  revision. Copilot completes with a submitted review tied to the head commit.
  Codex completes with either a review tied to the head commit or a `+1`
  reaction created after the latest push to indicate no findings.
- A requested review, work-started event, empty requested-reviewer list, green
  CI, or absence of comments is not terminal evidence.
- After pushing a review fix, re-request or retrigger both reviews as needed.
  If either expected reviewer cannot be verified, leave the pull request open
  and report the blocker.

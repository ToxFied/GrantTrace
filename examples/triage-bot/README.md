# Triage bot example

This small consumer shows the complete GrantTrace loop for a bot that posts a
standard acknowledgement when an issue enters triage.

It includes:

- [`src/triage.ts`](src/triage.ts), the application behavior;
- [`triage.test.ts`](triage.test.ts), a focused unit test;
- [`scenario.ts`](scenario.ts), a hermetic integration scenario;
- [`expected-output.txt`](expected-output.txt), the review a maintainer sees;
  and
- [`granttrace.lock.json`](granttrace.lock.json), the accepted contract that
  belongs in Git.

No GitHub account or credential is needed. The scenario uses GrantTrace's
explicit Octokit adapter because it intentionally replaces GitHub with a local
HTTP fixture. The fixture does not imitate GitHub's permission header, so the
contract uses only the pinned official-docs catalog.

In a normal application that calls `https://api.github.com` through standard
Octokit, the automatic recorder needs no source change.

## Run the test

From the repository root:

```bash
node --import tsx --test examples/triage-bot/triage.test.ts
```

## Reproduce the contract

Build GrantTrace once, then run the CLI with the example as the working
directory:

```bash
pnpm build
cd examples/triage-bot
node ../../dist/cli/bin.js record triage-comment -- \
  node --import tsx scenario.ts
```

Because the reviewed contract is already committed, this ends with
`GrantTrace check passed`. It proves that the scenario still reproduces the
checked-in artifact. [`expected-output.txt`](expected-output.txt) captures the
first-adoption diff that was reviewed before that lock existed.

The reproduced lock matches the committed file byte-for-byte. The concrete
owner, repository, issue number, local port, response body, and synthetic token
do not appear in it. In a new consumer project, the initial noninteractive run
would print the review diff and exit `6`; acceptance remains a separate local
decision.

## Add the check to CI

In a consumer project, install the published beta once:

```bash
pnpm add --save-dev granttrace@beta
```

Then record the scenario and verify its accepted contract in CI:

```bash
pnpm exec granttrace record --no-review triage-comment -- \
  pnpm test -- triage
pnpm exec granttrace check
```

CI detects a permission or coverage change but never accepts one.

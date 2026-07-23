# Disposable live fixture setup

Do not perform this setup for a production App or repository. These are the
exact prerequisites for the deliberately fixture-only `prove` workflow.

## 1. Create a dedicated GitHub App manually

Use a name that clearly says it is a GrantTrace test fixture.

- Homepage URL: any non-sensitive local/project URL GitHub accepts.
- Webhook: disabled.
- Repository permissions:
  - Issues: **Read and write**
  - Contents: **Read and write**
  - Actions: **Read-only**
- Organization and account permissions: none.
- Installation availability: only the fixture owner/account.

The broader grants are deliberate test data. The first restricted token will
request only `issues:write`; later, `contents:read` supplies a visible
permission-contract change.

GitHub's mandatory `metadata:read` grant does not belong in the selected
contract. GrantTrace validates and reports it as a separate unavoidable
effective baseline.

Generate one private key for this disposable App. Store it outside the
repository with mode `0600`. Never paste the key, JWT, or token into chat.

## 2. Create a private disposable repository manually

- Use an unmistakable name ending in `-granttrace-fixture`.
- Put no real source code or sensitive data in it.
- Install the test App with **Only select repositories** and select this one
  repository.
- Create one issue manually. The live fixture will create a comment and delete
  that comment in `finally`; it will not create or delete repositories.

## 3. Prepare local environment-backed secrets

Use these reserved names:

```text
GRANTTRACE_APP_ID
GRANTTRACE_INSTALLATION_ID
GRANTTRACE_APP_PRIVATE_KEY
GRANTTRACE_LIVE_OWNER
GRANTTRACE_LIVE_REPOSITORY
GRANTTRACE_LIVE_ISSUE_NUMBER
GRANTTRACE_LIVE_CONFIRM_DISPOSABLE=1
```

The private key should enter the process through a secret environment
provider. `.env.example` documents names only; a populated `.env` is ignored
and should still be avoided when a shell keychain or CI secret is available.

The live guard refuses:

- missing values;
- a repository name without the `-granttrace-fixture` suffix;
- confirmation other than `1`;
- a non-numeric App, installation, or issue identifier;
- any attempt to pass credentials as CLI arguments.

Never send the values in chat. Once an identity-free accepted contract exists,
run:

```bash
granttrace prove --scenario <safe-name> -- <command> [args...]
```

The accepted contract must currently contain exactly that scenario, no
unknowns, and no manual keeps. The command must use the GrantTrace Octokit
plugin and clean up every resource it creates. The included
`examples/live-issue-comment/scenario.ts` demonstrates reversible comment
cleanup.

The command mints only one-repository tokens, validates raw effective scope,
passes no App credential to the child, reproduces the accepted contract, runs
the valid issue-comment negative control when applicable, and writes the
identity-free `.granttrace/report.json`.

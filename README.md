<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/granttrace-hero-dark.svg">
    <img src=".github/assets/granttrace-hero-light.svg" width="760" alt="GrantTrace — Scenario-bound GitHub App REST permission contracts">
  </picture>
</h1>

<p align="center">
  <a href="https://toxfied.github.io/GrantTrace/docs/"><strong>Documentation</strong></a>
  · <a href="#see-it-work">Demo</a>
  · <a href="#quickstart">Quickstart</a>
  · <a href="https://toxfied.github.io/GrantTrace/docs/case-study/">Case study</a>
  · <a href="https://github.com/ToxFied/GrantTrace/blob/main/SECURITY.md">Security</a>
</p>

<p align="center">
  <code>Node.js 22+</code> <code>Beta candidate</code> <code>MIT</code>
</p>

GitHub Apps often accumulate broad permissions because the team cannot answer
a simple review question: **which permissions does this behavior actually
exercise?**

GrantTrace runs a named test scenario, observes its supported GitHub REST
operations, and turns them into a deterministic permission contract:

```text
scenario behavior → canonical REST routes → permission requirements
                  → reviewable granttrace.lock.json
```

Commit that contract. On the next pull request, GrantTrace shows whether the
application added access, removed coverage, changed evidence, or moved a route
between scenarios. Permission drift becomes a code-review decision instead of
a settings-page guess.

> [!IMPORTANT]
> GrantTrace proves a narrow claim: the permissions demonstrated by the named,
> recorded scenarios. It does not certify untested paths or whole-application
> least privilege.

## See it work

```bash
pnpm exec granttrace record issue-triage -- \
  pnpm test -- issue-triage
```

```text
GrantTrace contract review required

New permission
  issues: write

Observed in
  Route      POST /repos/{owner}/{repo}/issues/{issue_number}/comments
  Scenarios  issue-triage
  Evidence   Pinned permission catalog
```

Review the diff, accept it locally, and commit `granttrace.lock.json`.
CI re-records the scenario and runs `granttrace check`. An intentional change
gets a normal Git review; an unexplained change blocks.

The [complete triage-bot example](https://github.com/ToxFied/GrantTrace/tree/main/examples/triage-bot) includes its
application code, test, scenario, expected output, and committed contract.

## Why it is different

- **Behavior-backed:** contracts come from named scenarios, not a static guess
  about every path the program might take.
- **Reviewable:** routes retain scenario attribution and evidence provenance,
  so a coverage change cannot masquerade as a permission change.
- **Deterministic:** the lock contains no timestamps, commands, local paths,
  repository names, resource IDs, or credentials.
- **Exact alternatives:** GitHub permission AND/OR requirements remain intact;
  they are not flattened into an overbroad list.
- **Fail-closed:** unknown routes, malformed evidence, API mismatches, and
  runtime/catalog contradictions block acceptance.
- **Proof-capable:** an optional live mode can rerun one accepted scenario with
  an exactly scoped installation token against a disposable repository.

## Quickstart

### Requirements

- Node.js 22 or newer
- pnpm
- a repeatable Node.js scenario that exercises GitHub REST behavior

### Install the beta candidate from source

GrantTrace is not published to npm yet. Build its package archive from source:

```bash
checkout="$(mktemp -d)/GrantTrace"
git clone https://github.com/ToxFied/GrantTrace.git "$checkout"
corepack enable
pnpm --dir "$checkout" install --frozen-lockfile
npm --prefix "$checkout" pack --pack-destination "$checkout"
pnpm add --save-dev "$checkout/granttrace-0.1.0-beta.1.tgz"
```

After the first public package is published, the intended install will be:

```bash
pnpm add --save-dev granttrace@beta
```

When working inside this repository, use `pnpm granttrace` instead of
`pnpm exec granttrace`.

### 1. Record

```bash
pnpm exec granttrace record issue-triage -- \
  pnpm test -- issue-triage
```

For the standard path, GrantTrace injects its recorder into the Node child. It
observes supported requests through global `fetch`, including standard Octokit
clients. Responses are eligible for automatic runtime-header evidence only
when the request targets exactly `https://api.github.com`; off-origin traffic
is ignored. A known GitHub route without that header can still use the pinned
official-docs catalog.

Custom transports and advanced Octokit composition use the
[explicit adapter](https://toxfied.github.io/GrantTrace/docs/instrument-octokit/).

### 2. Review and accept

Interactive recording explains the exact contract diff and asks before
accepting. The default is no. You can also separate the steps:

```bash
pnpm exec granttrace check
pnpm exec granttrace check --accept
```

Noninteractive runs never accept. Commit `granttrace.lock.json`; keep
`.granttrace/` local and ignored.

### 3. Check in CI

```bash
pnpm exec granttrace record --no-review issue-triage -- \
  pnpm test -- issue-triage
pnpm exec granttrace check
```

Use `--no-review` only when a final aggregate `check` is guaranteed. Never put
`--accept` in CI.

## How the contract is built

1. The managed child records safe route templates, never concrete URLs.
2. GrantTrace compares eligible runtime evidence with a versioned 49-route
   catalog reviewed against GitHub's REST documentation.
3. It retains every nondominated sufficient permission assignment.
4. A documented risk policy selects one stable assignment for the lock.
5. Later recordings produce permission, route, evidence, and attribution
   diffs against that accepted state.

GitHub's mandatory `metadata:read` is reported separately from access selected
by a scenario. Intentional unobserved access can be retained as a
[manual keep](https://toxfied.github.io/GrantTrace/docs/manual-keeps/) with a committed human reason; GrantTrace
never labels a keep as observed or necessary.

## Optional live proof

`prove` is deliberately separate from the normal offline workflow:

```bash
pnpm exec granttrace doctor
pnpm exec granttrace prove issue-triage -- \
  pnpm test -- issue-triage
```

Use only a dedicated disposable GitHub App installation and repository.
GrantTrace requests the scenario permissions plus documented keeps, verifies
the effective token scope, reproduces the accepted scenario, runs applicable
negative controls, and reports cleanup separately.

Proof reports identify a clean checkout by its HEAD commit. If the index or
worktree is dirty—or Git provenance is unavailable—`sourceCommit` is `null`;
the report never attributes modified source to the last commit.

Read [safe live setup](https://toxfied.github.io/GrantTrace/docs/live-setup/) before configuring credentials.

## Boundaries

GrantTrace currently supports GitHub.com REST API `2026-03-10` and a curated
49-route catalog. It does not support GraphQL, GitHub Enterprise Server,
Actions `GITHUB_TOKEN`, OAuth Apps, personal access tokens, Git transport,
webhook inference, or static whole-program analysis.

Automatic recording covers Node global-`fetch` traffic only. A passing check
does not say unexecuted code is safe, and a permission absent from the contract
is not automatically safe to remove from an existing production App.

Live proof is Unix-only because GrantTrace must verify descendant-process
cleanup. Recording, checking, analysis, and contract review remain supported
on Windows.

## Security and privacy

Contracts and observations intentionally exclude raw URLs, query strings,
bodies, headers, errors, commands, tokens, keys, owners, repositories, and
resource IDs. Local state uses bounded reads, strict schemas, private modes,
ownership checks where available, atomic writes, and symlink defenses.

The scenario itself is trusted code. Recording is instrumentation, not an OS
sandbox. Live proof isolates broker credentials but gives the child a
short-lived installation token it can use or print.

## Documentation

| Guide                                                                           | Use it for                                    |
| ------------------------------------------------------------------------------- | --------------------------------------------- |
| [Getting started](https://toxfied.github.io/GrantTrace/docs/getting-started/)   | First contract from install to commit         |
| [How it works](https://toxfied.github.io/GrantTrace/docs/how-it-works/)         | Evidence, solving, and claim boundary         |
| [Engineering case study](https://toxfied.github.io/GrantTrace/docs/case-study/) | Architecture and design tradeoffs             |
| [CI](https://toxfied.github.io/GrantTrace/docs/ci/)                             | Reproducing scenarios without auto-acceptance |
| [Live proof](https://toxfied.github.io/GrantTrace/docs/live-proof/)             | Optional restricted-token verification        |
| [Protocol](https://toxfied.github.io/GrantTrace/docs/protocol/)                 | Normative contract semantics                  |
| [Threat model](https://toxfied.github.io/GrantTrace/docs/threat-model/)         | Assets, trust boundaries, and residual risk   |
| [Limitations](https://toxfied.github.io/GrantTrace/docs/limitations/)           | Exact unsupported behavior                    |

## Contributing

Small, evidence-backed contributions are welcome. Start with
[CONTRIBUTING.md](https://github.com/ToxFied/GrantTrace/blob/main/CONTRIBUTING.md). Catalog changes require official GitHub
documentation for the pinned API version. The repository verifies strict
types, deterministic output, security tests, package contents, leakage, and
clean package consumers across Linux, macOS, and Windows.

## License

[MIT](LICENSE)

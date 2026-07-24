# Safe disposable live setup

Live proof is optional. Do not target a production App, a production
repository, or an installation spanning real repositories.

GrantTrace never creates an App, changes App permissions, broadens an
installation, or creates a repository. Complete setup manually, then use
`granttrace doctor` before any authenticated run.

## 1. Create a dedicated GitHub App

Use an unmistakable fixture-only name.

- Disable webhooks.
- Grant only the repository permissions required by the scenarios and
  controls you intend to prove.
- Grant no organization or account permissions.
- Limit installation availability to the fixture owner/account.
- Generate one private key and keep it outside the repository.

The App's configured permissions may be broader than a particular scenario.
`prove` requests a narrower installation token and verifies the raw response.
GitHub's mandatory `metadata:read` is modeled separately from the selected
contract.

## 2. Create and isolate a disposable repository

- Use a private repository whose name ends in `-granttrace-fixture`.
- Store no real source, customer data, or secrets in it.
- Install the App with **Only select repositories** and select exactly this
  repository.
- Create one disposable issue if using the built-in issue-comment scenarios.

The positive example creates a comment and deletes it in `finally`. The
mutating negative control creates nothing on the expected path; if a removed
permission unexpectedly succeeds, it attempts deletion with the positive
restricted token before reporting failure.

## 3. Configure nonsecret fixture values

Supply these values transiently through the process environment:

```text
GRANTTRACE_APP_ID
GRANTTRACE_INSTALLATION_ID
GRANTTRACE_LIVE_OWNER
GRANTTRACE_LIVE_REPOSITORY
GRANTTRACE_LIVE_ISSUE_NUMBER
GRANTTRACE_LIVE_CONFIRM_DISPOSABLE=1
```

The guard requires decimal identifiers, a repository name ending in
`-granttrace-fixture`, and explicit confirmation equal to `1`. Rejected values
are not echoed.

Do not commit a populated `.env`, paste values into issue reports, or pass any
credential as a CLI argument.

## 4. Choose exactly one private-key provider

GrantTrace refuses missing or multiple providers.

### Private-key file (recommended locally)

Set an absolute path:

```bash
export GRANTTRACE_APP_PRIVATE_KEY_FILE="/absolute/path/to/app.private-key.pem"
```

The immediate parent directory must:

- be a real directory, not a symlink;
- be owned by the current user where ownership checks are available; and
- have exact mode `0700`.

The key must:

- be a regular nonsymlink file;
- be owned by the current user where ownership checks are available;
- have exact mode `0600`;
- be between 1 and 32,768 bytes; and
- contain a valid RSA private key.

Set modes before running `doctor`:

```bash
chmod 700 "/absolute/path/to/private-directory"
chmod 600 "/absolute/path/to/private-directory/app.private-key.pem"
```

### macOS Keychain

Store the PEM as a generic password using labels you control, then configure
both selectors:

```bash
export GRANTTRACE_APP_PRIVATE_KEY_KEYCHAIN_SERVICE="granttrace-fixture"
export GRANTTRACE_APP_PRIVATE_KEY_KEYCHAIN_ACCOUNT="github-app-private-key"
```

GrantTrace invokes `/usr/bin/security find-generic-password` directly with an
argv array, suppresses diagnostic output, enforces safe label characters, and
bounds the lookup. Keychain support is available only on macOS.

One way to add the item interactively is:

```bash
security add-generic-password \
  -s "granttrace-fixture" \
  -a "github-app-private-key" \
  -w
```

Enter the PEM when prompted. Do not place it on the command line or in shell
history.

### Secret environment value

For a protected CI environment or an existing secret manager that injects
multiline values:

```text
GRANTTRACE_APP_PRIVATE_KEY
```

This is supported but is easier to leak through process configuration than a
private file or Keychain. Never print the environment or enable shell tracing
around setup.

## 5. Diagnose without using GitHub

```bash
granttrace doctor
```

`doctor` checks:

- Node 22 or newer;
- private ignored local state;
- whether `granttrace.lock.json` is valid schema v2 or needs migration; and
- whether exactly one private-key provider and all live fields form a valid
  configuration.

It does not mint a JWT or token, contact GitHub, or print provider values or
fixture identities. “Optional live proof is not configured” is informational;
local record/check workflows remain available.

## 6. Prove one accepted scenario

First make sure current recordings have an accepted schema-v2 contract:

```bash
granttrace check
granttrace prove --scenario <safe-name> -- <command> [args...]
```

The command must use the GrantTrace Octokit plugin and clean up every resource
it intentionally creates. `examples/live-issue-comment/scenario.ts` shows the
reversible comment pattern.

The broker retains the App ID, installation ID, and private key. The child
gets only:

- a restricted, short-lived installation token as `GITHUB_TOKEN`;
- recorder mode, scenario, and private session path;
- the focused fixture coordinates; and
- a small allowlist of operating-system environment variables.

It does not inherit `HOME`, `NODE_OPTIONS`, existing GitHub tokens, private-key
provider settings, broker identifiers, disposable confirmation, or arbitrary
environment variables.

The raw token response must prove:

```text
requested permissions
  = selected permissions for this scenario
  + all manual keeps

effective permissions
  = requested permissions
  + mandatory metadata:read
```

It must also identify exactly one expected repository and a fresh expiry
consistent with GitHub's one-hour token lifetime. Every other
effective-permission difference blocks.

## Results and cleanup

Each run writes an identity-free report to:

```text
.granttrace/reports/<scenario>.json
```

The reports directory is `0700`; the report is `0600`. It records only
allowlisted contract, permission, child-status, negative-control, and cleanup
facts. It does not record the command, token, JWT, key, raw URL, owner,
repository, issue number, response body, or rich error.

After any failure:

1. read the terminal's safe failure class and report state;
2. inspect the disposable fixture manually for mutation residue;
3. resolve any residue before another proof;
4. fix the distinct cause—configuration, authentication, authorization,
   hidden resource, rate limit, expiry, outage, test, timeout, contract
   mismatch, or cleanup; and
5. rerun `granttrace doctor` before retrying.

A cleanup failure is never an unqualified pass.

## CI secrets

Do not run live proof on untrusted pull requests or forked code. If a trusted,
manual workflow is added later:

- use a protected environment;
- expose nonsecret fixture selectors and one private-key secret only to that
  job;
- use minimal workflow permissions;
- disable command tracing;
- never upload `.granttrace/` as an artifact; and
- retain the fixture-only repository and exact one-repository validation.

GrantTrace's production CI is intentionally offline and requires no fixture
credentials.

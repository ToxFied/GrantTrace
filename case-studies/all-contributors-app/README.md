# All Contributors Bot case-study assets

These files support GrantTrace's independent integration case study against
the public, MIT-licensed
[`all-contributors/app`](https://github.com/all-contributors/app) GitHub App.
The upstream source is pinned to commit
[`00f6362`](https://github.com/all-contributors/app/commit/00f6362ffcc927a2d05fec27f42c3d09e4b03adb).

The assets contain two deliberately separate evidence layers:

- `reply-only.observations.ndjson` and
  `new-branch-pr.observations.ndjson` are **source-derived, credential-free
  analysis fixtures**. They are not runtime observations. `case-study.json`
  links their routes to pinned source and hashes the reviewed files.
- `runtime.observations.ndjson` is a **credential-free mocked runtime
  recording** produced by GrantTrace's real Octokit recorder while the pinned
  App handled an `issue_comment.created` payload through Probot. The upstream
  `nock` boundary disabled all network connections and supplied the upstream
  fixtures, so this is not live GitHub behavior. The separate
  `runtime-emitted-requests.json` preserves only the exact method and
  normalized Octokit template observed after each mocked request completed;
  `runtime-case-study.json` records provenance, timings, route coverage,
  permission findings, and limitations.

Unknown-route recorder records omit the route template, matching GrantTrace's
identity-safe output. The runtime request-hook artifact retains canonical,
parameterized templates for those same catalog gaps so an evaluator can
review exactly which normalized routes the running App emitted. No concrete
owner, repository, username, ref, path, request body, token, or response body
is retained.

Reproduce the offline contract behavior:

```bash
pnpm granttrace analyze \
  case-studies/all-contributors-app/reply-only.observations.ndjson

# Expected to exit 7 because the source-derived route set has catalog gaps.
pnpm granttrace analyze \
  case-studies/all-contributors-app/new-branch-pr.observations.ndjson
```

Verify the pinned source hashes over the network:

```bash
node scripts/verify-external-case-study.mjs
```

Run the offline assertions:

```bash
pnpm vitest run test/integration/external-case-study.test.ts
```

Reproduce the real credential-free mocked runtime from a fresh disposable
clone. This verifies the exact commit and package-lock checksum, installs the
upstream lockfile with lifecycle scripts disabled, runs the Probot handler in a
credential-scrubbed child process, compares both runtime artifacts byte for
byte, and deletes the temporary clone:

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm case-study:runtime
```

To reuse an already installed, clean checkout at the exact commit:

```bash
pnpm case-study:runtime \
  --upstream /absolute/path/to/all-contributors-app
```

The reusable checkout must have clean tracked files, the exact pinned `HEAD`,
the pinned `package-lock.json`, and its frozen dependencies already installed.
The harness composes GrantTrace's Octokit hook with upstream Probot 12.2.8 and
uses only the literal dummy token `test`; it does not forward credential
environment variables into the runtime child.

See `docs/external-case-study.mdx` for the findings and limits.

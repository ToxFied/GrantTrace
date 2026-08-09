# All Contributors Bot case-study assets

These files support GrantTrace's independent integration case study against
the public, MIT-licensed
[`all-contributors/app`](https://github.com/all-contributors/app) GitHub App.
The upstream source is pinned to commit
[`00f6362`](https://github.com/all-contributors/app/commit/00f6362ffcc927a2d05fec27f42c3d09e4b03adb).

The NDJSON files are **source-derived, credential-free replay fixtures**. They
are not recordings from a live installation and are not presented as upstream
maintainer adoption. The full inventory in `case-study.json` links every route
to the exact pinned source that motivated it. Unknown-route observations omit
the route template, matching GrantTrace's identity-safe recorder output; the
manifest retains only canonical, parameterized templates for reviewing catalog
coverage.

Reproduce the offline contract behavior:

```bash
pnpm granttrace analyze \
  case-studies/all-contributors-app/reply-only.observations.ndjson

# Expected to exit 7 because the source-derived full path reaches catalog gaps.
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

See `docs/external-case-study.mdx` for the findings and limits.

# GrantTrace documentation site

The Fumadocs app renders the Markdown and MDX files in `../docs`.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

From the repository root, the equivalent command is `pnpm docs:dev`.

Create a production export with:

```bash
pnpm build
```

The export is configured for the repository base path when
`GITHUB_ACTIONS=true`. It is intentionally not deployed by this repository
before the public release. The repository owner must choose and configure
hosting separately.

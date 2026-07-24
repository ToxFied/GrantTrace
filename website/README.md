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

The production site is deployed through `.github/workflows/docs-pages.yml`:

- Documentation: <https://toxfied.github.io/GrantTrace/docs/>
- Repository root: <https://toxfied.github.io/GrantTrace/> (redirects to the
  documentation)

The static export uses the `/GrantTrace` repository base path whenever
`GITHUB_ACTIONS=true`.

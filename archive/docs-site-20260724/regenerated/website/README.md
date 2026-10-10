# GrantTrace documentation

The Fumadocs site renders the Markdown and MDX files in the repository-level
`docs/` directory.

```bash
pnpm --dir website install --frozen-lockfile
pnpm docs:dev
pnpm docs:typecheck
pnpm docs:build
```

Production URLs:

- Site: <https://toxfied.github.io/GrantTrace/>
- Documentation: <https://toxfied.github.io/GrantTrace/docs/>

GitHub Pages builds with the `/GrantTrace` base path. The site root immediately
forwards to the documentation; there is no separate landing page.

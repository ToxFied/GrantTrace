## What changed

Describe the user-visible outcome and why the change is needed.

## Security boundary

Explain any change to observed traffic, evidence, permissions, stored data,
credentials, child processes, cleanup, or GrantTrace's published claim. Write
“No boundary change” when none applies.

## Verification

List the focused checks you ran and the behavior they cover.

## Checklist

- [ ] The change is small enough to review and contains no unrelated cleanup.
- [ ] Tests cover the changed behavior, including failure paths where relevant.
- [ ] User-facing behavior and limitations are documented.
- [ ] Contract, catalog, or golden-output changes are intentional and reviewed.
- [ ] No credentials, fixture identities, `.granttrace/` data, or sensitive output are included.
- [ ] I did not add automatic acceptance, unguarded live calls, or unpinned third-party Actions.

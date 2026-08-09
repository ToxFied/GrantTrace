# Changelog

Notable user-facing changes to GrantTrace are documented here.

GrantTrace follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and intends to use [Semantic Versioning](https://semver.org/) after the public
beta.

## [Unreleased]

### Added

- An explicit `frontier list/select` workflow for choosing and retaining any
  complete nondominated permission assignment in the committed contract.
- Stable, versioned JSON and PR-ready Markdown output for `granttrace check`,
  plus explicit safe append support for GitHub Actions step summaries.

### Changed

- Clarified the npm package summary and quickstart for both pnpm and npm users.
- Live-proof reports and CLI output now state whether restricted scope was
  reproduced, permission-name necessity was partially tested, permission-name
  necessity was tested, or no strength was established, without claiming
  write-vs-read access-level minimality.
- Contract schema v3 permits any explicitly selected exact frontier member;
  released v2 forms migrate only after their deterministic default is
  validated. Proof-report schema v3 makes `proofStrength` required.
- Every accepted-contract mutation is refused when CI is enabled.
- GitHub summary output accepts the runner's absolute file-command path even
  when it is outside `RUNNER_TEMP`, while retaining link, inode, size, and
  append-only safeguards.
- The All Contributors artifact is titled an offline compatibility study, and
  its bounded verifier now binds every route call to a hashed pinned line range.

## [0.1.0-beta.1] - 2026-07-25

This is the first public beta release.

### Changed

- Automatic capture accepts runtime permission-header evidence only from
  requests to exactly `https://api.github.com`; off-origin responses are
  ignored.
- Live proof reports set `sourceCommit` only for a clean Git checkout. Dirty or
  unavailable Git state is represented as `null`.
- Public documentation now leads with the permission-review workflow, includes
  a complete consumer example, and documents the architecture and tradeoffs.

### Added

- A security reporting policy and GitHub contribution templates.
- Scenario-bound recording for supported GitHub REST calls through Node global
  `fetch` and the explicit Octokit adapter.
- Deterministic schema-v2 contracts with route-to-scenario attribution,
  per-scenario evidence provenance, full nondominated permission frontiers,
  and reasoned manual keeps.
- Human-reviewed contract acceptance and noninteractive CI checks.
- Optional restricted-token live proof with exact effective-permission
  accounting, built-in issue-comment negative controls, and cleanup reporting.
- A pinned 49-route GitHub REST permission catalog for API version
  `2026-03-10`.
- Strict local-state, credential-provider, package, portability, leakage, and
  deterministic-reproduction checks.

[Unreleased]: https://github.com/ToxFied/GrantTrace/commits/main
[0.1.0-beta.1]: https://github.com/ToxFied/GrantTrace/releases/tag/v0.1.0-beta.1

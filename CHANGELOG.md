# Changelog

Notable user-facing changes to GrantTrace are documented here.

GrantTrace follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and intends to use [Semantic Versioning](https://semver.org/) after the public
beta.

## [Unreleased]

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

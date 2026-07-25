# Security policy

GrantTrace handles permission evidence and, in optional live proof, GitHub App
credentials. Please report suspected vulnerabilities privately.

## Report a vulnerability

Use GitHub's private vulnerability reporting for this repository:

<https://github.com/ToxFied/GrantTrace/security/advisories/new>

Include:

- the affected GrantTrace version or commit;
- the command or library surface involved;
- the security impact and required preconditions;
- a minimal reproduction or proof of concept, if safe to share; and
- whether you believe credentials or a live fixture were exposed.

Do not open a public issue for an unpatched vulnerability. Do not include real
tokens, private keys, repository identities, or other people's data. Use
synthetic values and a disposable fixture.

If private vulnerability reporting is unavailable, open a public issue that
contains no vulnerability details and asks the maintainer to provide a private
contact path.

## What to expect

The maintainer will assess the report, ask for clarification when necessary,
and coordinate disclosure after a fix is available. Response and remediation
times depend on severity and reproducibility; this beta does not promise a
fixed service-level agreement.

Good-faith research that avoids privacy violations, data destruction,
production targets, denial of service, and credential exposure is welcome.
Please stop and report if testing could affect anyone beyond your own
disposable environment.

## Supported versions

GrantTrace is currently a pre-release project. Security fixes target the latest
beta and the `main` branch. Older commits and locally modified builds are not
maintained as separate supported releases.

## Security boundary

GrantTrace produces scenario-bound evidence, not a whole-application security
certification. The test process is trusted code, recording is not a network or
OS sandbox, and live proof must use a dedicated disposable GitHub App
installation and repository.

Read the [threat model](docs/threat-model.md) and
[limitations](docs/limitations.md) before evaluating impact.

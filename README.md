# LockGate Lite — GitHub Action

[![CI](https://github.com/ESS2292/lockgate-action/actions/workflows/test.yml/badge.svg)](https://github.com/ESS2292/lockgate-action/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/ESS2292/lockgate-action)](https://github.com/ESS2292/lockgate-action/releases/latest)

Fail a GitHub Actions job when the lockfile and the install command cannot produce a frozen, repeatable install.

A repository can commit both `package-lock.json` and `pnpm-lock.yaml`, or run `npm install` in CI instead of `npm ci`. Those are two ways the tree that CI installs drifts from the tree a teammate installed last week. This Action scans lockfiles and GitHub Actions install commands and fails the job when they disagree.

- **Zero dependencies.** Plain Node.js, nothing to install, nothing in `node_modules`.
- **A Lite subset.** npm manifest-vs-lockfile sync, Dockerfile `COPY` / `RUN` checks, `--json`, and a local CLI are described on the [LockGate site](https://ess2292.github.io/lockgate/).
- **Free and MIT-licensed.**

The scanner modules under `src/` (except `main.js`) are vendored from LockGate 0.1.0 and restricted to mixed or missing lockfiles, `packageManager` mismatches, and unfrozen CI installs by the Action wrapper.

The pre-launch product page (not indexed; checkout is not live) is at [ess2292.github.io/lockgate](https://ess2292.github.io/lockgate/).

## Usage

### Check the repository root

```yaml
name: CI
on: [push, pull_request]

jobs:
  lockfile:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - name: Check lockfiles and CI installs
        uses: ESS2292/lockgate-action@v1
```

### Check a subdirectory

```yaml
      - uses: ESS2292/lockgate-action@v1
        with:
          root: apps/web
```

## Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `root` | `.` | Project directory to scan, relative to the workspace |
| `ignore` | (empty) | Comma-separated relative path prefixes to skip |

## Outputs

| Output | Meaning |
| --- | --- |
| `ok` | `true` if the check passed, otherwise `false` |
| `errors` | Number of error findings |
| `warnings` | Number of warning findings (these do not fail the job) |
| `codes` | Comma-separated error codes, empty when there are no errors |

## What it looks at

npm, Yarn, pnpm, and bun lockfiles, each `package.json` (including the optional Corepack `packageManager` field), and `run:` steps in GitHub Actions workflows and composite actions.

Errors: two package managers' lockfiles in the same directory; a `package.json` with dependencies but no lockfile in that directory or above; a `packageManager` field that does not match the lockfile in scope; a CI step that runs `npm install` (or Yarn / bun without a frozen flag) instead of a lockfile-enforcing install. `package-lock.json` plus `npm-shrinkwrap.json` is valid npm, not mixed. `npm install some-package` (adding a dependency) is not flagged.

Warnings (do not fail the job): a `package.json` with no dependencies and no lockfile; bare `pnpm install` (pnpm already freezes when `CI=true`); bare `yarn install` when the repo's `yarn.lock` is Yarn Berry (immutable on CI by default). Make the flag explicit.

A workspace package may inherit a parent lockfile.

## Honest limits

- Lite does not compare `package.json` to `package-lock.json`. It does not read Dockerfiles or `.gitignore` / `.dockerignore`. Those checks, a JSON report, and a local CLI are described on the [LockGate site](https://ess2292.github.io/lockgate/). Checkout is not live.
- Yarn, pnpm, and bun lockfiles are detected, not fully parsed for manifest sync.
- Workflow parsing is best-effort, not a full YAML parser. Anchors and generated expressions can be missed. Inline comments on `run:` lines are ignored.
- pnpm's default `--frozen-lockfile` in CI is respected: a bare `pnpm install` in GitHub Actions is a warning, because GitHub sets `CI=true`.
- This is a consistency gate, not a reimplementation of `npm ci`. It does not call the network and does not install packages.

## Development

```bash
node --test
```

`.github/workflows/test.yml` runs the tests and self-tests the action with `uses: ./`, including a drift fixture that is expected to fail.

The action runs on the `node24` runtime, which GitHub-hosted runners require for JavaScript actions since Node 20 was removed in September 2026.

## Guides

- [Why npm ci fails when the lockfile is out of sync](https://ess2292.github.io/lockgate/guides/npm-ci-lockfile-out-of-sync.html)
- [Don't commit pnpm-lock.yaml and package-lock.json together](https://ess2292.github.io/lockgate/guides/pnpm-lock-and-package-lock-both-committed.html)
- [Copy the lockfile and run npm ci in Docker](https://ess2292.github.io/lockgate/guides/docker-copy-package-lock-npm-ci.html)

Questions and bug reports: [open an issue](https://github.com/ESS2292/lockgate-action/issues).

## Related

LockGate checks whether the dependency install is frozen and repeatable. For Node.js version pins that drift across `.nvmrc`, Docker, and `setup-node`, the free [RuntimeGate Lite Action](https://github.com/ESS2292/runtimegate-action) fails the job when those declarations disagree. For missing environment variables, use the free [EnvGate Lite Action](https://github.com/ESS2292/envgate-action).

## Changelog

### v1.0.0

- Initial public release of LockGate Lite.

## License

MIT. Copyright 2026 Emilio Straubel.

# M10 releases: first version 0.10.0, started by a tag or a manual run, comment script unchanged

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-23 01:53 UTC |
| **Summary** | The first release is `0.10.0`; a release starts from a pushed `api-diff-v*` tag or from a manual workflow run that creates the tag; the PR comment script stays a script in this repo, fetched from the release's tag. |
| **Milestone** | M10 |

## Background

M10 (PLAN.md section 6) publishes the bundled `api-diff.mjs` on GitHub releases ([Distribute as a single bundled release file](2026-11-21T0407-release-file-distribution.md)). Three choices change what gets built, so they were asked before building.

## Alternatives considered

### First version

- **✅ `0.10.0`:** pre-1.0, so the result JSON, the policy file and the CLI may still change, and numbered after the milestones so early adopters can tell how far along it is.
- **`0.1.0`** (the version in `package.json` until now): pre-1.0, but says less about how complete it is.
- **`1.0.0`:** would declare the CLI, policy file and result JSON stable now.

### How a release starts

- **✅ Both:** pushing the tag `api-diff-v<version>` publishes it, and a manual run in the Actions tab (on `main`, with the version) creates the tag and publishes in the same run. A tag pushed with the workflow's own token doesn't start workflows, so the manual run can't publish twice.
- **Tag push only:** simple, but needs git access to cut a release.
- **Manual run only:** easier from the GitHub UI, but a tag pushed by hand would do nothing.

### The PR comment script

- **✅ Leave it as it is:** `ci/github-comment.ts` stays a script in this repo; the release file only compares. [ci.md](../docs/ci.md) fetches it with a sparse checkout of the same release's tag, so one version pin covers both. It imports only Node built-ins, so it needs no `npm ci`.
- **A subcommand in the bundle:** one file for everything, but puts GitHub-specific code in the tool.
- **A second release file:** one more file and checksum per release.

## Decision

As chosen above.

## Impacts

- `package.json` and `src/version.ts` are `0.10.0`.
- `.github/workflows/api-diff-release.yml`, with `push: tags` and `workflow_dispatch`.
- `docs/ci.md` downloads a pinned release and sparse-checks-out `tools/api-diff/ci` at its tag.

## References

- PLAN.md sections 4 (*Using it in other repositories*) and 6
- [docs/releasing.md](../docs/releasing.md)

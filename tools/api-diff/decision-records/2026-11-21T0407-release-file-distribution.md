# Distribute as a single bundled release file

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 04:07 UTC |
| **Summary** | Publish `api-diff.mjs` (bundled, with a SHA-256 file) on GitHub releases of this repo; no package registry. |
| **Milestone** | M10 |
| **Supersedes** | [Distribute through an npm registry plus a release file](2026-11-21T0355-npm-and-release-distribution.md) |

## Background

Other repositories need a pinned version without copying the tool. This repo is public, so release downloads need no token.

## Alternatives considered

- **npm registry**: Needs a package name and publishing credentials.
- **GitHub Packages**: Needs a token in every consumer.
- **Second checkout in CI**: Couples repos to this layout.

## Decision

Release files tagged `api-diff-v<version>`. Before the first release, developers use a local clone with `npx`, and CI can use a second checkout.

## Impacts

- Consumers need Node ≥ 22.18.
- The same bundle can be published to npm later without other changes.

## References

- PLAN.md section 4, *Using it in other repositories*

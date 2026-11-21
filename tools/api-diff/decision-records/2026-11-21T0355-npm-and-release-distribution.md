# Distribute through an npm registry plus a release file

| | |
|---|---|
| **Status** | Superseded by [Distribute as a single bundled release file](2026-11-21T0407-release-file-distribution.md) |
| **Date** | 2026-11-21 03:55 UTC |
| **Summary** | Proposed: publish to an npm registry, plus a bundled file on GitHub releases. |
| **Milestone** | M10 |

## Background

Other repositories need to run the tool without copying it.

## Alternatives considered

- **Second checkout of this repo in CI**: Works without publishing, but couples repos to this layout.

## Decision

Proposed npm plus a release file.

## Impacts

- Needed a free package name and registry credentials.

## References

- PLAN.md section 4, *Using it in other repositories*

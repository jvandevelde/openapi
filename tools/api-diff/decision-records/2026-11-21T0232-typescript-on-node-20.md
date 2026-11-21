# TypeScript on Node 20

| | |
|---|---|
| **Status** | Superseded by [TypeScript on Node ≥ 22.18 with type stripping](2026-11-21T0407-typescript-on-node-22.md) |
| **Date** | 2026-11-21 02:32 UTC |
| **Summary** | Initial proposal: write the tool in TypeScript on Node ≥ 20. |
| **Milestone** | M0 |

## Background

The repo's existing tool (`operation-ids`) is Node-based, so Node keeps one ecosystem.

## Alternatives considered

- **Go**: Single binary, but we'd need our own position-aware YAML handling.

## Decision

Proposed TypeScript on Node ≥ 20.

## Impacts

- Node 20 reached end of life in April 2026, so the minimum version was raised when the language was confirmed.

## References

- PLAN.md section 7

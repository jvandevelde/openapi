# Load YAML with the `yaml` package

| | |
|---|---|
| **Status** | Superseded by [Use js-yaml and jsonc-parser for position-aware loading](2026-11-21T0236-fast-position-aware-parsers.md) |
| **Date** | 2026-11-21 02:32 UTC |
| **Summary** | Use the `yaml` package (already used by `operation-ids`) to load specs and get node positions. |
| **Milestone** | M2 |

## Background

The first plan reused the `yaml` package because it gives positions for every node, which we need for source locations.

## Alternatives considered

- **`js-yaml`**: Not measured at the time.

## Decision

Use the `yaml` package for loading.

## Impacts

- Measured later at 2.3–3.1 s per 8 MB spec, about 10× slower than alternatives.

## References

- PLAN.md section 4, *Performance (measured)*

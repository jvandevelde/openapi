# Use js-yaml and jsonc-parser for position-aware loading

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 02:36 UTC |
| **Summary** | Load YAML with `js-yaml` and JSON with `JSON.parse` + `jsonc-parser`, and get positions from their offsets. |
| **Milestone** | M2 |
| **Supersedes** | [Load YAML with the `yaml` package](2026-11-21T0232-yaml-package-for-loading.md) |

## Background

Large enterprise specs (8 MB) must load quickly. A benchmark on a generated 8 MB OpenAPI 3.1 spec (240k nodes, Node 22) measured: `JSON.parse` 42 ms, `jsonc-parser` parseTree 251 ms, `js-yaml` about 250 ms (about 200 ms with a position listener), and the `yaml` package 2.3–3.1 s.

## Alternatives considered

- **`yaml` package**: Full CST with comments; about 10× slower. Not needed because a diff tool doesn't write YAML back.
- **Hand-written YAML scanner for positions**: Fast, but fragile for flow style, anchors and multi-line scalars.

## Decision

`js-yaml` for YAML (positions recorded through its `listener` option), `JSON.parse` for JSON values and `jsonc-parser` for JSON positions.

## Impacts

- Two 8 MB specs parse in about 0.5 s, so the total budget of about 1 s is realistic.
- Positions must be mapped from parser events to JSON Pointers ourselves (M2).

## References

- PLAN.md section 4, *Performance (measured)*

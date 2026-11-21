# Which schema keywords are shape and which are annotations

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 05:51 UTC |
| **Summary** | `description`, `example(s)`, `externalDocs`, `$comment`, `deprecated`, `$id`/`$schema`/`$anchor`/`$dynamicAnchor` and `x-` extensions are annotations (full hash only); everything else, including `title`, `readOnly`/`writeOnly`, `default` and `xml`, is shape. |
| **Milestone** | M4 |

## Background

The shape hash decides what counts as a schema change (and so what `unclassified-change` reports); the full hash adds annotations. Each keyword had to go on one side. Not asked separately: this follows earlier decisions, and is listed here for review.

## Alternatives considered

- **`title` as an annotation**: but some SDK generators name types after it (`schema-title-changed` is an `sdk` rule).
- **`deprecated` as shape**: it has its own lifecycle rules (M6); as shape it would be reported as unclassified until then.

## Decision

- Annotations: `description`, `example`, `examples`, `externalDocs`, `$comment`, `deprecated`, `$id`, `$schema`, `$anchor`, `$dynamicAnchor`, and every `x-` extension (until the M6 policy can classify extensions as `wire` or `sdk`).
- `$defs`/`definitions` are in neither: referenced definitions become their own nodes.
- Shape: everything else.
- Before hashing, 3.0 keywords are normalised to 3.1 (`nullable`, boolean `exclusiveMinimum`/`exclusiveMaximum`), `type` arrays are sorted, `required` and `enum` are compared as sets, and keys are sorted, so cosmetic differences don't count.
- When two path templates clash (`/a/{x}` and `/a/{y}`), the alphabetically first is kept, so the result doesn't depend on key order.

## Impacts

- Annotation-only changes produce no finding until the M5 docs rules.
- A property test checks that hashes don't depend on key order, on random schema graphs with cycles.

## References

- `src/index/canonical.ts`, `src/model/model.ts`, test cases `schema-annotations-only`, `schema-nullable-3-0-vs-3-1`, `schema-required-and-enum-order`, `path-template-clash`
- [Report annotation changes as a docs kind](2026-11-21T0255-docs-kind-for-annotations.md)

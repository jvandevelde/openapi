# Shape and full content hashes, with an unclassified-change safety net

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 02:55 UTC |
| **Summary** | Hash every node twice (shape only, and shape plus annotations) to skip unchanged parts, detect annotation-only changes and catch changes no rule handled. |
| **Milestone** | M4 |

## Background

Large specs are mostly unchanged between versions, and a rule set can always have gaps.

## Alternatives considered

- **Walk everything every time**: Slower, and gaps in the rules stay silent.
- **A single hash**: Can't tell annotation-only changes apart.

## Decision

Two hashes per node after normalisation. Same/same: skip. Same shape, different full: annotations only. Different shape but no wire/sdk finding: `unclassified-change` (default `warn`). Counts by kind come from grouping findings.

## Impacts

- Every `unclassified-change` in the test corpus points at a missing rule.

## References

- PLAN.md section 4, *Content hashes*

# Reports by audience as views over one result

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 02:58 UTC |
| **Summary** | Produce one result object per comparison and render audience-specific reports (`ci`, `review`, `changelog`, `sdk`, `summary`, `audit`, `explore`) from it. |
| **Milestone** | M7–M9 |

## Background

Pipelines, reviewers, API consumers, SDK maintainers, release managers and governance need different subsets and wording of the same findings.

## Alternatives considered

- **One output format for everyone**: Too much for some readers, too little for others.
- **Separate commands per audience**: Duplicated parsing, and results could disagree.

## Decision

Every report is a preset (filter, grouping, format, template) over the same result. Reports can be customised or added in config. Several reports come from one run.

## Impacts

- Message text comes from templates per audience, not from the engine.

## References

- PLAN.md section 5

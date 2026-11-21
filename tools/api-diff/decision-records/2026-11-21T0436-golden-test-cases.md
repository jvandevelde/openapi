# Golden test cases define what each rule does

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 04:36 UTC |
| **Summary** | Each rule is defined by test cases (base, revision, expected findings); every implemented rule needs at least one. |
| **Milestone** | M1 |

## Background

Phase 0 of the plan said the expected results are where we settle what "breaking" means. They need a format that is easy to read and review, and the suite must catch rules that have no case.

## Alternatives considered

- **Unit tests in code per rule**: harder to review as API changes, and not reusable with other tools.
- **Snapshot files generated from output**: easy to create, but they record what the code does, not what we decided it should do.

## Decision

`test/cases/<name>/` holds the two documents and `expected.yaml` (description, milestone, optional profile, findings as rule + severity + subject). Matching is exact and order-insensitive. Cases for later milestones run as `todo`. A test fails if an implemented rule has no case. `UPDATE_CASES=1` rewrites expected findings only as a reviewed, deliberate step.

## Impacts

- 74 cases at M3, including 4 recursive-schema cases for M4/M5.
- The documents are plain OpenAPI, so other tools can be run on the same cases to compare.

## References

- `test/cases/README.md`, `test/cases.test.ts`

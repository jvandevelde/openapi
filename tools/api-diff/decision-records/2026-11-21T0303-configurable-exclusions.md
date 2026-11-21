# Exclusions are configurable named sets

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 03:03 UTC |
| **Summary** | Nothing is excluded by default; exclusions are named sets in the config, with `internal` only as an example. |
| **Milestone** | M6 |

## Background

Internal paths may need reporting, so hard-coding their removal is wrong.

## Alternatives considered

- **Hard-code `/internal/**` and `x-internal`**: Wrong for teams who need internal changes reported.

## Decision

Named sets (paths, extensions, tags, operationIds, components). `exclude` per report hides findings but still counts them; `ignore` skips comparison. Every report states what was hidden.

## Impacts

- `audit` always shows everything.

## References

- PLAN.md section 5, *Exclusions*
- POLICY.md section 8

# Build the ci and review reports first

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-11-21 04:05 UTC |
| **Summary** | Build the `ci` and `review` reports before the other reports. |
| **Milestone** | M7 |

## Background

The first reports decide who gets value first.

## Alternatives considered

- **`changelog` first**: Consumer-facing value first, but no PR gate.
- **`explore` first**: Best for investigation, but larger to build.

## Decision

Proposed: `ci` and `review` in M7, because they make the tool usable as a PR check.

## Impacts

- Not needed before M7.

## References

- PLAN.md section 7

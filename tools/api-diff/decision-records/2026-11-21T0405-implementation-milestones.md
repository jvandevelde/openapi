# Implementation milestones M0–M10

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 04:05 UTC |
| **Summary** | Build in eleven milestones, each ending with something that runs. |
| **Milestone** | — |

## Background

The design is large; it needs an order that produces a usable tool early.

## Alternatives considered

- **Build by pipeline stage, end to end at the end**: Nothing usable until late.

## Decision

M0 scaffold, M1 corpus, M2 inputs, M3 operation-level diff (first usable version), M4 schema index, M5 schema engine, M6 policy, M7 PR check, M8 presentation, M9 governance, M10 distribution. Golden cases per rule, unit and property tests, and a performance benchmark.

## Impacts

- M10 can move earlier if other repos want the tool sooner.

## References

- PLAN.md section 6

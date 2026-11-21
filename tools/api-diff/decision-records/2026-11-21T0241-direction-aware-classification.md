# Classify schema changes by variance and usage direction

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 02:41 UTC |
| **Summary** | Label each schema change as widened, narrowed or incompatible once, then decide severity per usage from whether the client sends (`in`) or receives (`out`) the data. |
| **Milestone** | M5 |

## Background

A shared component can be used in requests and responses at the same time. The same change (e.g. an enum value added) is safe in one direction and risky in the other, and per-keyword checks don't scale or stay consistent.

## Alternatives considered

- **Hand-written check per keyword and position**: What most tools do; large, uneven and easy to leave gaps.
- **Classify per component only**: Wrong for components used in both directions.

## Decision

Variance is computed once per change. Usages are found by walking `$ref`s from each operation, with direction set by position and by `readOnly`/`writeOnly`. Each usage is scored; the finding takes the worst usage and lists them all. Usages come from the base document.

## Impacts

- A shared-component change is reported once, with its usages.
- Schema rules come in request/response pairs (RULES.md section 7).

## References

- PLAN.md section 4, *Shared components used in both requests and responses*
- RULES.md section 7

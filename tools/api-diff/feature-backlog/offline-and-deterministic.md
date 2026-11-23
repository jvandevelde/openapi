# Offline and deterministic

| | |
|---|---|
| **Status** | Idea |
| **Summary** | No network calls or telemetry, and byte-identical output for the same inputs, so it works in air-gapped CI. |
| **Value / effort** | required / low |
| **Plan entry** | [PLAN.md section 8, *Enterprise operation*](../PLAN.md#enterprise-operation) |

Moved from the PLAN.md backlog table on 2026-11-23, unchanged apart from links. It hasn't been worked out in more detail yet; add background, options and open questions here when it is.

## What it does

No network calls, no telemetry, byte-identical output for the same inputs. Works in air-gapped CI.

## Related

- Rated "required": treat it as a constraint on every feature, and as a test to add, rather than a feature to schedule.

## Open questions

- Is it tested today (e.g. a byte-identical output check)? To confirm before marking it built.

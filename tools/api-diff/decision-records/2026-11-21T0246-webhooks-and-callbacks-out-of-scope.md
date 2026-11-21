# Leave webhooks and callbacks out of scope

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 02:46 UTC |
| **Summary** | Don't compare webhooks or callbacks at first, but say so in reports. |
| **Milestone** | M3 |

## Background

The user doesn't normally use webhooks or callbacks, and they reverse the request/response direction, which adds work to the usage model.

## Alternatives considered

- **Support them from the start**: More work for a feature that isn't needed yet.

## Decision

Webhooks and callbacks aren't compared. If a spec has them, one `not-compared` notice says so.

## Impacts

- The direction model can add them later by flipping direction.

## References

- PLAN.md section 6, *Out of scope*
- RULES.md section 11

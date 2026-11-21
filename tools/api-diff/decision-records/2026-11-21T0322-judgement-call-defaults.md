# Defaults for judgement-call rules

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 03:22 UTC |
| **Summary** | Keep the proposed defaults for the five rules where teams commonly disagree. |
| **Milestone** | M3, M5 |

## Background

Some changes might or might not break clients depending on how clients and servers are written.

## Alternatives considered

- **Stricter defaults (`error`)**: Noisy for tolerant clients.
- **Looser defaults (`info`)**: Misses real breakage for strict clients.

## Decision

`parameter-removed`: warn, servers assumed lenient (`strict-servers: false`). `enum-value-added-in-response`: warn. `property-added-optional-in-response`: info. `response-success-status-added`: warn. `request-body-removed`: warn.

## Impacts

- All five can be changed in the policy file.

## References

- RULES.md (rows marked **Decided**)

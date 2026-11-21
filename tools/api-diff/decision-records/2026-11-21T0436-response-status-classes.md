# Only 2xx responses count as success statuses

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 04:36 UTC |
| **Summary** | `response-success-status-*` rules apply to 2xx and `2XX`; every other status except `default` uses the `response-error-status-*` rules. |
| **Milestone** | M3 |

## Background

RULES.md names success (2xx) and error (4xx/5xx) status rules, but specs also document 1xx and 3xx responses, and status ranges (`2XX`).

## Alternatives considered

- **Treat 3xx as success**: clients must follow redirects, but a removed documented redirect rarely breaks a client that also handles 200.
- **Separate rules for 1xx/3xx**: more rules for rare cases.

## Decision

2xx and `2XX` are success statuses. 1xx, 3xx, 4xx, 5xx and their ranges use the error-status rules (`info` by default). `default` has its own rule. Status keys compare case-insensitively (`2xx` = `2XX`), but a range and a specific code (`2XX` vs `200`) are different keys for now.

## Impacts

- Replacing `200` with `2XX` is reported as removed + added; smarter range matching can come later.

## References

- `src/normalize/normalize.ts` (`isSuccessStatus`, `statusKey`), `src/diff/operations.ts`

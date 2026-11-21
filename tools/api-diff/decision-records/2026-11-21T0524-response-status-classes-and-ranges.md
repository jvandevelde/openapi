# 1xx/2xx/3xx are success statuses, and status ranges match their codes

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 05:24 UTC |
| **Summary** | 1xx, 2xx and 3xx use the success-status rules; a code and its range (`200` ↔ `2XX`) are matched and compared instead of reported as removed + added. |
| **Milestone** | M3 |
| **Supersedes** | [Only 2xx responses count as success statuses](2026-11-21T0436-response-status-classes.md) |

## Background

The first version treated only 2xx as success statuses and compared status keys literally, so `200` → `2XX` was reported as a removal plus an addition. The user reviewed both choices.

## Alternatives considered

- **3xx as error statuses (info)**: the first version; a removed documented redirect would never fail CI.
- **Separate rules for 3xx**: more rules for a rare case.
- **Literal status keys**: simple, but reports a removal for a change that doesn't remove anything.
- **Widening (`200` → `2XX`) as `warn` or no finding**: rejected in favour of `info`.
- **Narrowing (`2XX` → `200`) as `warn` or as a removal (`error`)**: rejected in favour of `info`.

## Decision

- 1xx, 2xx and 3xx (and `1XX`–`3XX`) use `response-success-status-added` (warn) and `response-success-status-removed` (error). 4xx and 5xx use the error-status rules (info).
- **Widening:** when specific codes disappear and the revision adds their range (and the base didn't have it), they are matched: one `response-status-range-widened` finding (info) per range, and each code's response is compared with the range's response.
- **Narrowing:** when a range disappears and the revision adds specific codes in it, one `response-status-range-narrowed` finding (info), and the range's response is compared with each code's.
- Other codes are unaffected: base `2XX` and revision `2XX` + new `200` still reports `200` as added.

## Impacts

- Two new rules in RULES.md section 6.
- Content, media type and header changes are still found when a range replaces a code, e.g. a lost body is `response-body-removed` (error).

## References

- `src/diff/operations.ts` (`diffResponses`), `src/normalize/normalize.ts`
- Test cases `response-redirect-status-*`, `response-status-range-*`

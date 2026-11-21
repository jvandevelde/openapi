# Split parameter rules by location

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 03:20 UTC |
| **Summary** | Parameter rules have location-specific IDs (`query-…`, `header-…`, `cookie-…`); path parameter changes are operation changes. |
| **Milestone** | M3 |

## Background

Removing a path parameter changes the URL, which makes it a different endpoint, while removing a query parameter usually just changes behaviour.

## Alternatives considered

- **One `parameter-removed` rule for every location**: Wrong for path parameters.

## Decision

Path parameter additions and removals are reported as `operation-path-changed` (or removed + added). Other locations use parameter rules with location-specific IDs; the generic ID sets all locations. Headers match case-insensitively; `Accept`, `Content-Type` and `Authorization` header parameters are skipped, as OpenAPI says.

## Impacts

- New rule `operation-path-changed`.

## References

- RULES.md section 4

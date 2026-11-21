# Severity precedence and configurable rules

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 02:37 UTC |
| **Summary** | Every rule's severity is configurable; when several settings apply, the most specific wins. |
| **Milestone** | M6 |

## Background

Teams disagree about changes such as new enum values in responses, so severity must be configurable per rule and per part of the spec, and it must always be clear why a finding got its severity.

## Alternatives considered

- **One level per rule for the whole spec**: Simple, but can't treat partner APIs differently from internal ones.
- **Last setting wins regardless of type**: Hard to reason about.

## Decision

Precedence, highest first: acknowledgement → in-spec hint (`x-api-diff`) → policy override (last match) → policy rule → profile default → built-in default. Every finding records where its severity came from.

## Impacts

- Reports show severity provenance, e.g. `warn ← policy override #2 (path /partner/**)`.

## References

- PLAN.md section 4
- POLICY.md section 12

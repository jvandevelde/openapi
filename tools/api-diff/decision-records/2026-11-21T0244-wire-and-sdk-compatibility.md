# Separate wire and SDK compatibility

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 02:44 UTC |
| **Summary** | Every rule declares whether it affects the wire (JSON) or generated SDKs; profiles set defaults for each. |
| **Milestone** | M3, M5 |

## Background

A `$ref` retargeted to an identical schema is harmless on the wire but breaks generated code that refers to the old type name. Mixing the two makes one audience's breaking changes noise for the other.

## Alternatives considered

- **Treat everything as wire**: Misses SDK breakage.
- **Treat SDK changes as breaking always**: Noisy for teams without generated clients.

## Decision

Each rule has a kind (`wire` or `sdk`). `--profile wire` (default) makes `sdk` rules `info`; `--profile sdk` raises them to `warn`/`error`. `$ref` changes are reported as a parent finding with field-level child findings.

## Impacts

- Rules such as `ref-target-changed`, `operation-id-changed` and `component-renamed` are `sdk` kind.

## References

- PLAN.md section 4, *Kinds of change*
- RULES.md section 8

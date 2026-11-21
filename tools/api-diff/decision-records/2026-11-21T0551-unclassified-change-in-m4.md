# Report schema changes as unclassified-change, per schema root, from M4

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 05:51 UTC |
| **Summary** | From M4, every schema whose shape changed is reported as `unclassified-change` (warn), one finding per schema root, until the M5 schema rules classify it. |
| **Milestone** | M4 |

## Background

M4 adds content hashes and the `unclassified-change` safety net, but the rules that classify property, type and enum changes arrive in M5. Without a decision, M4 would either report every schema change as unclassified or hide them until M5. The user chose both the behaviour and the granularity.

## Alternatives considered

- **Report them as info until M5**: no effect on `--fail-on warn`, but a change could still go unnoticed.
- **Turn the safety net on only in M5**: quieter, but schema changes are silent until then.
- **One finding per changed keyword**: precise, but a large schema change produces many findings.
- **One finding per operation**: shared components repeat for every operation that uses them.

## Decision

- `unclassified-change` is on from M4 with its default severity, `warn`.
- One finding per **schema root**: a component schema or other `$ref` target (matched by logical name, e.g. `#/components/schemas/Pet` or `schemas.yaml#/Pet`), or a schema written inline in an operation (matched through the operation, e.g. `query parameter 'limit'`).
- The finding lists the JSON Pointers that changed inside the root, and, for shared schemas, the operations that use it (from the base document).
- Only local changes count: `$ref`s are compared by target name, so a change inside `Address` is reported for `Address` only, not for `Pet` that references it.

## Impacts

- Until M5, schema changes appear as warnings with "no rule classifies this change yet".
- The cycle-not-productive test case also expects the unclassified change to `A`.

## References

- `src/diff/schemas.ts`, `src/index/schema-index.ts`, test cases `unclassified-change-*`
- [Shape and full content hashes, with an unclassified-change safety net](2026-11-21T0255-content-hashes-and-unclassified-change.md)

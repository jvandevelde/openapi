# Policy file validated strictly, rule docs generated from code

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 03:19 UTC |
| **Summary** | Unknown policy keys and rule IDs are errors, and rule documentation is generated from rule metadata in code. |
| **Milestone** | M0, M6 |

## Background

Silent typos in a policy file change CI outcomes without anyone noticing, and hand-written rule docs drift from the code.

## Alternatives considered

- **Ignore unknown keys**: Typos go unnoticed.
- **Hand-written rule docs**: Drift.

## Decision

Strict validation with suggestions (`did you mean …`). Rule metadata (ID, kind, defaults, options) lives in code; `api-diff rules` and the RULES.md tables come from it; a test fails if a rule has no description or test case.

## Impacts

- `api-diff schema policy` prints a JSON Schema for editor validation.

## References

- POLICY.md sections 1 and 13

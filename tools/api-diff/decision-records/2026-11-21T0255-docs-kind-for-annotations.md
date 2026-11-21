# Report annotation changes as a docs kind

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 02:55 UTC |
| **Summary** | Changes to descriptions, examples, titles and unclassified `x-` extensions are reported as kind `docs`, severity `info`. |
| **Milestone** | M5 |

## Background

Annotation changes aren't wire or SDK breaking, but reviewers still want to see them.

## Alternatives considered

- **Ignore annotation changes**: Hides real changes.
- **Report them as wire changes**: Noise in the breaking view.

## Decision

A third kind, `docs`, shown in the diff view and audit report, hidden from the breaking view. `deprecated`, `default` and policy-classified extensions get their own rules.

## Impacts

- The policy `extensions` section classifies extensions as `wire`, `sdk` or `docs`.

## References

- PLAN.md section 4
- RULES.md section 10

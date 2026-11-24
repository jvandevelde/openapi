# Findings record their usage direction in the result JSON

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-24 03:48 UTC |
| **Summary** | A finding whose rule has request and response variants gets a `direction` field, `in` or `out` (the policy's override values); other findings have none. The result schema change is additive (v0). |
| **Milestone** | — (after M10) |

## Background

Schema changes are judged once per direction ([decision record](2026-11-21T1539-schema-engine.md)), but the result JSON only showed the direction in the rule ID's `-in-request` / `-in-response` suffix. Scripts and the spec explorer had to compare `rule` with `baseRule` to recover it.

## Alternatives considered

- **✅ `in` / `out`**: the values the policy's `direction` override key and the internal `Direction` type already use, so a finding's `direction` can be copied into an override as is.
- **`request` / `response`**: matches the rule suffixes and report wording, but would give the same idea two spellings across the policy and the result.
- **✅ Only on rules with direction variants.** Parameter and response-status rules have a fixed direction, but their rule IDs carry none; leaving the field off keeps it equal to the suffix, so `direction` is present exactly when `rule` ends in `-in-request` or `-in-response`.
- **On every finding that has a direction**, including parameter rules (`in`) and response rules (`out`). Not chosen: the field would then disagree with the rule ID for those findings, and "direction" for a removed response status is less clear.

## Decision

`Finding.direction?: 'in' | 'out'`, set in the classify step from the change's direction when the rule has direction variants. Added to `schema/result-v0.schema.json` and to the template data shape. Finding IDs, report output and the merge of request and response entries are unchanged.

## Impacts

- `src/types.ts`, `src/classify/classify.ts`, `src/render/template.ts`, `schema/result-v0.schema.json`; tests in `test/unit/directions.test.ts`.
- JSON consumers and templates can read `direction`. The field is optional, so older consumers are unaffected.
- PLAN.md section 4 (*Shared components used in both requests and responses*, step 3) now describes one finding per direction, as built, instead of one finding at the worst severity; `docs/getting-started.md` mentions the field.

## References

- [Classify schema changes by variance and usage direction](2026-11-21T0241-direction-aware-classification.md)
- [Schema engine: one finding per direction](2026-11-21T1539-schema-engine.md)
- [Show a change's request and response findings as one entry in review and explore](2026-11-23T0348-merge-request-response-entries.md)
- POLICY.md section 5 (the `direction` override key)

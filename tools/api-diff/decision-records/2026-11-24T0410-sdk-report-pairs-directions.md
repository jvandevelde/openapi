# The sdk report pairs a change's request and response findings, as review does

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-24 04:10 UTC |
| **Summary** | The `sdk` report merges a change's `…-in-request` and `…-in-response` findings with the shared `mergeDirections` instead of by message text, shows the rule without direction and each direction's severity and ID, and counts the change once towards `breaking`. |
| **Milestone** | — (after M10) |

## Background

Since M8 the `sdk` report removed duplicate lines within each method or type group by message text, keeping the more severe line. For a schema change judged in both directions, that dropped the other direction's finding completely, from the text and from `sdk:json`:

- its finding ID was missing, so it couldn't be acknowledged from this report;
- the kept line showed the suffixed rule (`enum-value-added-in-response`), which reads as if only responses are affected;
- `breaking` was counted per finding before merging, so a change that is an error in both directions counted twice ("2 changes break generated code" for one type change).

[Show a change's request and response findings as one entry in review and explore](2026-11-23T0348-merge-request-response-entries.md) left `sdk` unchanged; this record changes that.

## Alternatives considered

- **✅ Pair like `review`**, with `mergeDirections` (same rule apart from the direction, subject, message and place), keeping both directions' IDs. Asked and chosen.
- **List both findings**, one line each. Not chosen: each shared-type change appears twice, which the merge was added to avoid.
- **Keep the text merge and document it.** Not chosen: the other direction's ID stays unavailable from this report.

## Decision

- The report merges findings once, over all the findings it shows, before grouping.
- An entry's severity is the worse of its directions' severities **under `--profile sdk`** (the report's own severities), and its `id` is that direction's. Its `rule` is the rule without direction, and `directions` lists each direction's `direction` (`request`/`response`), severity, rule and ID, request first.
- A merged change is listed under every method either direction reaches, and counts once towards `breaking` and the bump.
- Text: the change on one line as before, `[rule]` without direction, then `request INFO · id …   response WARN · id …` under it.
- Changes in one direction only are shown as before.

## Impacts

- `src/render/sdk.ts` (`SdkChange`, `SdkDirection`), `src/render/template.ts` (template data shape); tests in `test/unit/sdk.test.ts`.
- `sdk:json` consumers see `rule` without direction for merged changes and a new optional `directions` list; `breaking` can be lower than before.
- README, `docs/getting-started.md` and PLAN.md section 4 (step 3) say `sdk` pairs directions.

## References

- [Show a change's request and response findings as one entry in review and explore](2026-11-23T0348-merge-request-response-entries.md)
- [M8 reports and history](2026-11-22T1650-m8-reports-and-history.md) (the sdk report)
- [Findings record their usage direction in the result JSON](2026-11-24T0348-direction-field-on-findings.md)

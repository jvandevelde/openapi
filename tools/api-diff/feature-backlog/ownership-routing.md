# Ownership routing

| | |
|---|---|
| **Status** | Built (M9) |
| **Summary** | Owners from `x-owner` or the policy's `owners.assign` list, listed on each finding, with reports split per team. |
| **Value / effort** | high / medium |
| **Plan entry** | [PLAN.md section 8, *Ownership and governance*](../PLAN.md#ownership-and-governance) |

Moved from the PLAN.md backlog table on 2026-11-23, unchanged apart from links. Built in M9; the decision records below describe what was built.

Marked **★** in PLAN.md: one of the ideas to do first.

## What it does

Read owners from `x-owner` on operations, path items, tags, schemas or the document, or from the policy's `owners.assign` list (decided instead of a CODEOWNERS-style file). Each finding lists the owning teams, and reports can be split per team ("findings for @payments"). An acknowledgement can require an owner of the affected operations.

## Related

- Built in M9: [M9 governance choices](../decision-records/2026-11-22T2027-m9-governance-choices.md), [M9 reports, owners and templates](../decision-records/2026-11-22T2028-m9-reports-owners-and-templates.md).
- `acknowledgements.require-owner` covers the ack-owner check that [overlays and a review loop](overlays-and-review-loop.md) section 6 mentions.

## Open questions

- None recorded yet.

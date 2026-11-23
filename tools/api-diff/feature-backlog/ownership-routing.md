# Ownership routing

| | |
|---|---|
| **Status** | Planned |
| **Summary** | Read owners from `x-owner` or a CODEOWNERS-style file, list owning teams on each finding and split reports per team. |
| **Value / effort** | high / medium |
| **Plan entry** | [PLAN.md section 8, *Ownership and governance*](../PLAN.md#ownership-and-governance) |

Moved from the PLAN.md backlog table on 2026-11-23, unchanged apart from links. It hasn't been worked out in more detail yet; add background, options and open questions here when it is.

Marked **★** in PLAN.md: one of the ideas to do first.

## What it does

Read owners from `x-owner` on operations or tags, or from a CODEOWNERS-style file mapping paths to teams. Each finding lists the owning teams, and reports can be split per team ("findings for @payments"). An acknowledgement can require an owner of the affected operations.

## Related

- Part of M9 (Governance).
- `x-owner` is listed as backlog (M9) in [docs/spec-authors.md](../docs/spec-authors.md).
- [Overlays and a review loop](overlays-and-review-loop.md) section 6 would use it to check ack owners.

## Open questions

- None recorded yet.

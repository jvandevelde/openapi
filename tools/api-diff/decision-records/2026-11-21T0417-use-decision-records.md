# Record decisions as decision records

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 04:17 UTC |
| **Summary** | Keep a `decision-records/` directory with one dated record per decision. |
| **Milestone** | M0 |

## Background

Decisions were spread across PLAN.md, RULES.md and chat. The user asked for a record of each decision as it's made, with background, alternatives, the decision and its impacts.

## Alternatives considered

- **Decisions section in PLAN.md only**: No history, no alternatives, hard to supersede.

## Decision

One Markdown file per decision, named `<YYYY-MM-DDTHHMM>-<slug>.md` (UTC) so files sort chronologically. Each has a status (`Proposed`, `Accepted` or `Superseded`, with a link to the superseding record), a summary, background, alternatives considered, the decision, impacts and references. README.md indexes them. A test checks the format and links. Earlier decisions were back-filled using the times of the commits that recorded them.

## Impacts

- New decisions get a record in the same commit as the change they describe.

## References

- [README.md](README.md)
- [TEMPLATE.md](TEMPLATE.md)

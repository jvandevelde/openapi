# Feature proposals live in feature-backlog/, with a short entry in PLAN.md

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-23 01:57 UTC |
| **Summary** | Each feature proposal or design gets its own file in the tool's `feature-backlog/` directory; PLAN.md keeps only a short overview and value statement that links to it. |
| **Milestone** | — |

## Background

PLAN.md section 8 already holds many backlog ideas that may or may not be built. A brainstorm about overlays and a review loop (2026-11-22/23) produced far more detail than a backlog row can hold. Adding it, and future proposals like it, to PLAN.md would make the plan hard to read. The user asked for a brief PLAN.md entry linking to a dedicated file, and for this to apply to all future feature proposals and designs.

## Alternatives considered

- **✅ Chosen: one file per proposal in `tools/<tool>/feature-backlog/`, plus a short PLAN.md entry.** PLAN.md stays an overview, and each proposal can be as detailed as it needs.
- **Rejected: put the details in PLAN.md.** It keeps growing with ideas that may never be built.
- **Rejected: write proposals as decision records with status `Proposed`.** A proposal holds many choices, some still open; decision records are one decision each and are written when the decision is made.
- **Rejected: a repo-wide `proposals/` directory.** Tools are independent, so their proposals stay with them.

## Decision

- Every new feature proposal or design for a tool goes in `tools/<tool>/feature-backlog/<slug>.md`, with a header table (**Status**, **Summary**, **Value / effort**, **Plan entry**) and the background, options, sketches, choices so far and open questions.
- `feature-backlog/README.md` lists the proposals with their status (*Idea*, *Planned*, *Built*, *Dropped*).
- PLAN.md section 8 has one short row per proposal, in the table for its area: what it does, why it's worth having, value/effort, status and a link.
- A proposal isn't a decision. Choices in it are asked again when work starts and recorded as decision records, which the proposal then links to.
- The root CLAUDE.md states the convention, so it applies to every tool and every future session.

## Impacts

- New `feature-backlog/` directory with a README and the first proposal, [overlays and a review loop](../feature-backlog/overlays-and-review-loop.md).
- PLAN.md section 8 gains a *Review and publishing* area for the overlays proposal, and a status column.
- Every existing backlog row in PLAN.md moved to its own file (2026-11-23, asked and answered), unchanged apart from links, with status *Built* for bulk-change collapsing and the cached base index and ownership routing (M9).

## References

- [feature-backlog/README.md](../feature-backlog/README.md)
- PLAN.md section 8
- Root CLAUDE.md, *Feature proposals and designs*
- [Record decisions as decision records](2026-11-21T0417-use-decision-records.md)

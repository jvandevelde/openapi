# Counter-example payloads

| | |
|---|---|
| **Status** | Idea |
| **Summary** | For each `wire` finding, a small JSON value the old schema accepts and the new one rejects, as proof the change breaks something. |
| **Value / effort** | high / medium |
| **Plan entry** | [PLAN.md section 8, *Evidence and accuracy*](../PLAN.md#evidence-and-accuracy) |

Moved from the PLAN.md backlog table on 2026-11-23, unchanged apart from links. It hasn't been worked out in more detail yet; add background, options and open questions here when it is.

Marked **★** in PLAN.md: one of the ideas to do first.

## What it does

For each `wire` finding, generate a small JSON value that the old schema accepts and the new one rejects (for requests) or the other way round (for responses), e.g. `{"status": "archived"}`. Shown in reports and exportable as test fixtures. Proof that the change really breaks something, instead of only a rule saying so. **Not to be built here until the generator question in PLAN.md section 7 is settled:** the separate spec explorer already generates payloads, and cycles and large nested unions are the hard part either way.

## Related

- Waits on the open question in PLAN.md section 7 (delegate to the spec explorer, share a generator, or build one here).
- [The explore report is a diff view](../decision-records/2026-11-22T1647-explore-is-a-diff-view.md) defers it until that is settled.

## Open questions

- Delegate, share or build the generator (PLAN.md section 7).
- How to handle cycles and large nested unions.

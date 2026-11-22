# Migration notes for clients instead of fix advice

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-22 16:34 UTC |
| **Summary** | M8's "explanations and fixes" becomes per-finding migration notes for API consumers (what a client must do), shown in the changelog and explore reports; fix advice for spec authors stays on the rule pages only. |
| **Milestone** | M8 |

## Background

PLAN.md's M8 included "explanations and fixes": fix advice per finding. Planning M8 (2026-11-22), the user confirmed that breaking changes are usually intended, so advice to undo them isn't wanted; what helps is telling API consumers what to do about a change. Asked and answered then.

## Alternatives considered

- **✅ Chosen: migration notes for clients.** One plain sentence per finding a client may have to act on ("Stop sending the query parameter `limit`."), chosen by direction: a narrowed request limit tells clients what to send, a widened response tells them what to handle. No note when there's nothing to do (e.g. an enum value added to a request).
- **Rejected: keep fix advice** (in `explore`). Reads as "undo this".
- **Rejected: neither.** The rule pages explain rules, not what a specific change means for a client.

## Decision

Notes live in `src/rules/notes.ts`, one function per base rule ID, written as data so wording can change without touching the engine (custom templates are M9). A test checks that every `warn` or `error` change in every golden case gets a note, and that notes have no empty values. Version checks and notices have no notes.

## Impacts

- `changelog` and `explore` (M8 steps 3 and 5) show the notes; the JSON of those reports includes them.
- PLAN.md's M8 row says "migration notes for clients" instead of "explanations and fixes".

## References

- PLAN.md section 5 (*Plain language comes from data, not code*)
- [The PR check reports changes and doesn't fail by default](2026-11-22T0653-report-not-gate.md)

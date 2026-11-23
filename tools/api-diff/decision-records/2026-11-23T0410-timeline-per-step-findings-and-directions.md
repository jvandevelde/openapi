# Timeline: findings per step, and one line per change in requests and responses

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-23 04:10 UTC |
| **Summary** | The timeline JSON keeps each step's own finding records instead of one table keyed by finding ID (which showed one step's text in another), and the text and HTML timelines show a change's request and response findings as one line, as `review` and `explore` do. |
| **Milestone** | — (after M10) |

## Background

The [history timeline](2026-11-21T0400-history-timeline.md) JSON listed finding IDs per step and every finding once in a top-level `findings` table, and the HTML page read from that table, after also adding the net result's findings to it. A finding ID names a kind of change at a place, not one occurrence, so the same ID comes up in several steps with different details: a version check (`version-bump-too-small` at the document) in every step that bumps the version, or a property edited in two steps. Each later step overwrote the earlier record. On a sample history, the HTML showed "version went from 1.0.0 to 1.3.0" (the net result's text) on three steps, and the JSON showed the last step's text on all three. The text timeline was correct, since it reads each step's result directly.

The timeline also still listed a schema change twice, once per direction, which [the review and explore reports no longer do](2026-11-23T0348-merge-request-response-entries.md).

Both were asked about and accepted: fix the bug, and merge the directions in the timeline as in `review`.

## Alternatives considered

- **Keep the shared table, keyed by step and ID** (`"2:fbaf54d000d4"`). Not chosen: the same JSON-shape change for consumers, with a made-up key.
- **Keep the shared table and accept the bug for version checks only.** Not chosen: any finding repeated across steps can be affected.
- **Leave the timeline with one line per finding.** Not chosen; it would be the only report still listing both directions.

## Decision

- **JSON:** each step's `findings` is now the list of that step's finding records (as in a normal result), not a list of IDs. The top-level `findings` table is removed. Revert links are unchanged: they already name a finding by ID and step (`finding` + `step`, `revertedBy` + `revertedIn`). The HTML page reads each step's own records, and the net view reads `net.findings`.
- **Text:** a change reported for both directions (same rule apart from the `-in-request`/`-in-response` suffix, subject, message and place) is one line with the worst severity, followed by `(request ERROR, response INFO)`. A revert mark shows if any part has one.
- **HTML:** the same, with `request error · response info` after the message, in step cards and the net view. The element-history filter matches either part's text.
- **Unchanged:** step counts (per finding), revert detection, the net result and the other reports.

## Impacts

- `src/render/timeline.ts`; tests in `test/unit/history.test.ts` (a step that shares a finding ID with another keeps its own text; one line per change).
- **JSON consumers** of `history --report timeline:json` read `steps[].findings` as records instead of IDs, and no longer find a top-level `findings` table.
- Docs: the PLAN.md section 5 JSON example, and `docs/getting-started.md` (the history example).

## References

- [History timeline from consecutive comparisons](2026-11-21T0400-history-timeline.md)
- [Show a change's request and response findings as one entry in review and explore](2026-11-23T0348-merge-request-response-entries.md)
- PLAN.md section 5, *Timeline (history mode)*

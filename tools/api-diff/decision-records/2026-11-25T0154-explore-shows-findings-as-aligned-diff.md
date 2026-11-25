# Explore shows each finding as an aligned, tinted diff of its enclosing schema or operation

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-25 01:54 UTC |
| **Summary** | Each `explore` row shows the client note, then one view with the base and revision side by side, aligned row by row from a line diff: removed and added lines tinted, changed characters marked, unchanged parts folded, long lines wrapped, an added or removed item shown as a gap on the other side instead of highlighting its parent, and a legend. The facts (rule, ID, affected operations) come last, on one line per direction. |
| **Milestone** | — (follow-up to M8) |
| **Supersedes** | [Explore panes show the $ref a side went through, and open on the whole enclosing schema, folded](2026-11-25T0136-explore-panes-show-ref-site-and-fold.md) |

## Background

A UX review of the `explore` page from a reviewer's point of view ([feature proposal](../feature-backlog/explore-reviewer-ux-pass.md)) found that the two panes often hid the change or highlighted a line that hadn't changed:

- Lines didn't wrap, so a change at the end of a flow-style line (`format: uuid`) was off the pane's edge.
- Whole lines were highlighted; the reviewer had to compare `[…, cancelled]` and `[…, refunded]` by eye.
- For an added or removed item, the side without it highlighted the parent (`get:`, `'200':`), and a removed operation showed an empty pane.
- The two panes weren't a diff: other changed lines looked unchanged, and line numbers drifted apart.
- The rule, kind, severity source and ID (two blocks of them for a merged request/response row) pushed the panes below the fold.

The user asked for all twelve items in the proposal, except the phone layout (item 12), which they don't want for now.

## Alternatives considered

- **✅ Chosen: one aligned view per row, driven by a line diff of the two scopes.** The diff gives the tints, the gaps for added and removed items, which parts can fold, and matching rows that scroll together, from data the page already has (`sourceLines`).
- **Keep two independent panes and add tints to each.** Line numbers still drift, the panes scroll separately, and a removed item still has nowhere to show on the other side.
- **A unified diff (one column).** Compact, but a reviewer reading a schema change wants to read each version whole; the user decided not to do phone layouts now, where it would matter most.

## Decision

1. **Layout of a row.** The client note (one per direction when they differ), the `via` / `changes inside` / `for example` links, the diff view, other findings on the highlighted line ("Also on this line"), then the facts: rule, kind, severity source, ID and affected operations on one line (per direction for a merged row), then acknowledgement, exclusion sets and spec explorer links.
2. **Blocks and pairing.** Each side has blocks as before: the `$ref` sites it went through (`Snippet.via`), the scope the change is in, and a `$ref` node's target. Base and revision blocks are paired by the node they show, then the rest in order; a block with no partner is shown alone, tinted when it's new or the other side has nothing.
3. **Alignment.** Each pair's lines are aligned with a longest-common-subsequence line diff. Within a run of differences, removed and added lines are paired in order on one row. Base-only lines are tinted red, revision-only lines green; on a row with both, the differing words are marked. Both sides are in one scrolling box, so they scroll together, with the headers (side, file base name and line, breadcrumb) pinned at the top.
4. **Added and removed items.** When one side's location is an ancestor of the other's (the item was added or removed), that side has nothing highlighted, and the rows beside the other side's item are marked as a gap with "← not in revision" (or base). When an operation exists on one side only, the snippets widen to the path item, and the other side gets an `absent` snippet of the same path item, so the gap shows where the operation was. A component on one side only stays on its own.
5. **Folding.** Folds are by indentation, as before, but on rows, so both sides fold together. A pair over 40 rows folds every part of at least 3 rows that is entirely unchanged and holds no highlighted or other finding's line, except inside a highlighted node of 30 lines or fewer. A gutter arrow folds or opens any part; "show all lines" / "fold unchanged lines" does all.
6. **Wrapping.** Lines wrap; continuation lines are indented two characters past the line's own indentation.
7. **Other findings.** Lines other findings point at get a dot (one per row, at most three per line) that opens that finding; the findings on the highlighted line are listed under the view.
8. **Labels.** Pane headers show the file's base name and line, with the full path as a tooltip. Breadcrumb steps for array items carry a `label`: a parameter's name and location (`limit (query)`), a union or `allOf` member's `$ref` target, else `#n`. Groups and subjects show a component by its name with a muted kind (`Status schema`), the top-level security as `All operations · top-level security`, and documentation groups by the rule's title (`Description changed`).
9. **Version checks.** `version-*` findings, which have no location, get snippets of `info.version` on both sides, and `version-bump-too-small` links to the finding that needs the bump (`details.becauseId`).
10. Kept from the superseded record: `Location.via` and `Snippet.via`, `scopeIsNew`, `ref.isNew`, scopes of at most 400 lines, lines stored once in `sourceLines`, the `via` and `changes inside` links, and `explore` staying a diff view.

## Impacts

- `src/render/explore-diff.ts` (new: the diff view's script and styles), `src/render/explore.ts` (row layout, facts, subject labels, rule titles in the page data), `src/render/theme.ts` (diff colour tokens for both themes), `src/snippets.ts` (`absent` context snippets, widening to the path item, breadcrumb labels, `info.version` snippets), `src/diff/versions.ts` (`because` as subject and message, `becauseId`), `src/types.ts`, `src/render/template.ts`, `schema/result-v0.schema.json` (all new fields optional).
- Tests in `test/unit/explore.test.ts`.
- The phone layout (proposal item 12) isn't done.

## References

- [Feature proposal: a reviewer's UX pass over the finding panes](../feature-backlog/explore-reviewer-ux-pass.md)
- [Schema change messages name the field](2026-11-25T0155-messages-name-the-field.md)
- [Explore panes show the $ref a side went through](2026-11-25T0136-explore-panes-show-ref-site-and-fold.md) (superseded)

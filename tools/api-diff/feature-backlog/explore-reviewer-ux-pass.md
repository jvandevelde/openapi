# Explore page: a reviewer's UX pass over the finding panes

| | |
|---|---|
| **Status** | Idea |
| **Summary** | A UX review of the `explore` page from a reviewer's point of view, done on a realistic spec pair (operations, parameters, headers, enums, security, added and removed operations, docs edits) at desktop and phone width. The common thread is the one behind [the `$ref` site fix](explore-context-panes.md): the panes don't always show the change itself, or highlight a line that didn't change. Twelve issues, with a fix for each, in priority order. |
| **Value / effort** | high / medium (most items are low effort each) |
| **Plan entry** | [PLAN.md section 8, *Large specs and noise*](../PLAN.md#large-specs-and-noise) |

## How this was reviewed

A spec pair for a small shop API produced 20 findings: a lower `maximum` on a query parameter, a required query parameter added, one removed, a response header removed, a 404 removed, enum values swapped, a required request property added, `maxLength` lowered, `format: uuid` added on a path-level parameter, a type narrowed, an optional property added, a security alternative, an operation added and one removed, and two docs edits. Every finding was opened and its panes looked at, at 1400 px and on a phone (iPhone 13 emulation). The question each time was: *can a reviewer see what changed, and trust what's highlighted, without reading the spec?*

## Findings

### Can't see the change

**1. The change is cut off at the pane's right edge.** Lines don't wrap, and flow-style YAML puts a whole parameter on one line. For `format added (none → 'uuid')` the revision line ends `… schema: {type: string, for` and the `format: uuid` that changed is off-screen. On a phone, both sides of `maximum decreased (100 → 50)` end at `schema: {type: integer`: neither value is visible. The reviewer has to scroll each pane sideways to find the change.

*Fix:* soft-wrap long lines with a hanging indent (the wrapped part lines up under the line's text, not the line number), and scroll the highlighted line's changed part into view if it's still too wide.

**2. Whole lines are highlighted, never the changed part.** `enum: [pending, paid, shipped, cancelled]` vs `[…, refunded]`, `maximum: 100` vs `50`, `description: Order total in cents` vs `… in minor units`: the reviewer has to compare the two highlighted lines character by character.

*Fix:* on the two highlighted lines, mark the characters that differ (a word-level diff of the two lines), as code review tools do. When the finding has `from`/`to` values, those are what to mark.

### The highlight points at the wrong thing

**3. For something added or removed, the side without it highlights the parent.** `query parameter 'cursor' removed`: the revision highlights `get:`, as if the operation line changed. Same for `region` added (the base highlights `get:`), `X-Total` removed (the revision highlights `'200':`), and `operation removed` (the revision says `(not in this version)` in an empty pane). The reviewer can't see *where* the thing was, or that the parent line itself is unchanged.

*Fix:* on the side where it's missing, show a gap marker where it would be: a thin row `− cursor (removed)` between `limit` and `status` in the revision, `+ region (added)` after `status` in the base, and the path item with `− delete (removed)` for a removed operation. The place is after the nearest preceding sibling that exists on both sides; the parent stays unhighlighted.

**4. The panes aren't a diff.** Each pane shows its own version of the operation; lines that differ but aren't this finding (`summary`, the `cursor` parameter, `region`, the `X-Total` header) look the same as unchanged lines, apart from a grey gutter mark that has no legend and explains itself only on hover. Line numbers drift apart after the first insertion, so the reviewer has to align the panes by eye.

*Fix:* this is item 3 of the earlier proposal (*line the two sides up*), plus diff tinting: lines only in the base are tinted red, lines only in the revision green, with blank filler rows so matching lines sit side by side, and the two panes scroll together. The finding's own line keeps the stronger highlight. A one-line legend under the panes explains the tints and the gutter marks.

### Words that don't say where

**5. Row titles drop the thing that changed in an operation.** In the `GET /orders` group, `maximum decreased (100 → 50) at /maximum` doesn't say it's the `limit` parameter; `format added (none → 'uuid') at /format` doesn't say it's the `id` path parameter. The client note does ("Send the query parameter `limit` …"), but it's only visible once the row is opened. `type narrowed (["number"] → ["integer"])` shows raw JSON arrays.

*Fix:* for schema changes inside a parameter, header or body, start the message with the field (`query parameter limit: maximum decreased (100 → 50)`), as the note already does; print one-element type lists as plain words (`number → integer`).

**6. Breadcrumbs and paths show array indexes and pointer escapes.** `parameters › 0 › schema`, `oneOf › 2`, and messages like `summary changed at /paths/~1orders/get/summary`.

*Fix:* name a parameter by its name and location (`parameters › limit (query)`), a union branch by its `$ref` or summary (`oneOf › Card`), and unescape pointers in messages (`/paths/{/orders}/get/summary`, or better `GET /orders: summary changed`).

**7. Group names are pointers or rule IDs.** `#/components/schemas/Status`, a group called `4 operations` (for a change to the top-level `security`, which covers every operation), and docs groups called `description-changed` and `summary-changed`.

*Fix:* `Status` with a muted `schema` label; `All operations (top-level security)`; `Descriptions changed` and `Summaries changed`.

### Evidence comes last

**8. Bookkeeping sits above the evidence.** Every opened row lists rule, kind, severity source and finding ID before the panes; a merged request/response row (enum changes) adds two more blocks of four to five facts each, so the panes start below the fold at 1400×1000. A reviewer wants: what changed, what to do (the note), the evidence, and only then the IDs needed for an acknowledgement.

*Fix:* order the row body as note, panes, then the facts in a compact footer (`max-length-decreased · wire · default severity · id 4fe512895437 · affects POST /orders`), with the per-direction facts as one line each.

**9. Related findings on the same line repeat the same panes.** `enum value removed: 'cancelled'` and `enum value added: 'refunded'` are two rows whose panes are identical. Opening one doesn't mention the other.

*Fix:* in each pane, list the other findings on the highlighted line ("also here: enum value added 'refunded'") with links; or merge value changes on one enum into one row (`enum changed: − cancelled, + refunded`), keeping both finding IDs, as request/response findings already are.

**10. The version check has no evidence.** `version went from 1.4.0 to 1.5.0 …, but the changes need a major bump (e.g. max-length-decreased-in-request at #/components/schemas/NewOrder)` has no panes, and the example is a rule ID and a pointer.

*Fix:* show `info.version` on both sides, and link the example to its row by message (`e.g. NewOrder: maxLength decreased`) instead of naming the rule.

### Layout

**11. Pane headers repeat a long path.** Each header shows the input path as given (`../../../../../tmp/…/base.yaml:13`), which wraps to two lines on desktop and three on a phone, twice per finding; the line number is easy to miss at the end.

*Fix:* the file's base name and line (`base.yaml:13`), with the full path as a tooltip; the full paths are already in the page header.

**12. On a phone, two stacked panes make each finding three screens long.** Each pane is up to 70% of the screen tall, the change is often off its right edge (item 1), and the reviewer scrolls between the base and the revision to compare them.

*Fix:* below 760 px, show one unified diff instead of two panes (removed lines red, added green, the finding's line highlighted), with a base/revision toggle for the full scope.

## Suggested order

1. Items 1, 2 and 3: the reviewer can see the change and trust the highlight. Mostly page work; item 3 needs the insertion point, which the page can find from the two scopes' sibling keys.
2. Items 5, 6, 7 and 11: wording and labels. Small changes in messages, the breadcrumb and group titles.
3. Item 8: reorder the row body.
4. Items 4 and 12: aligned, tinted panes and the unified view on phones (one line-diff of the two scopes serves both).
5. Items 9 and 10.

## Open questions

- Item 5 changes message text, which `review`, `ci` and the changelog also print. Change it everywhere, or only on the `explore` page?
- Item 9: list the related findings, or merge enum value changes into one row (a new kind of merge, like the request/response one)?
- Item 12: replace the two panes with a unified diff on phones only, or offer it as a toggle everywhere?

# Explore page: sections, grouping by schema or operation, and documentation changes folded per rule

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-23 03:55 UTC |
| **Summary** | The `explore` page shows input problems, version, changes (grouped by schema or operation by default, or flat via a remembered "group by" control), documentation changes (one closed group per rule) and notes as separate sections; error and warn groups start open. |
| **Milestone** | — (after M10) |

## Background

After [merging request and response findings](2026-11-23T0348-merge-request-response-entries.md), the `explore` page was still one flat list in which documentation-only changes made up most rows and a schema with several changes appeared on several rows, while the text `review` report already groups by root cause and folds documentation changes. The proposal is [Explore page: sections, grouping by schema or operation, and folded documentation changes](../feature-backlog/explore-sections-and-grouping.md). Each choice below was asked separately.

## Alternatives considered

- **Documentation changes: one flat section**, or **folded under their schema or operation**. Not chosen; one group per rule was chosen.
- **Which groups start open: all closed, or all open.** Not chosen; error and warn groups start open, as in the `review` HTML.
- **Grouped only, no control.** Not chosen; a "group by" control keeps the flat list.
- **Input problems, version checks and notes in one "other" group.** Not chosen; own sections.
- **Collapsing the same edit made in several schemas.** Not part of this decision; still an idea.

## Decision

- **Sections**, in order: *Problems with the inputs* (notices above `info`), *Version* (version checks), *Changes* (wire and sdk changes), *Documentation changes* (kind `docs`), *Notes* (`info` notices), using the same tests as the `review` report (`isNotice`, `isVersion`). The page data's `rows` become `{ parts, section }`. Each section heading shows the number of rows shown, and a section with none is hidden.
- **Changes** are grouped by root cause (the finding's subject: a schema, an operation, or a bulk "N operations" subject) when "group by" is *schema or operation*, the default. A group shows a badge with the worst severity of its shown rows, `×n` shown rows and the operations its findings affect (five, then `…`). Rows in a group hide the subject they share with it. Groups are ordered by worst severity of all their findings, then by number of rows, then by name in natural order. Groups whose worst severity is error or warn start open.
- **"Group by" control**: *schema or operation* or *none* (the flat list, in result order). The choice is saved in `localStorage` (`api-diff-explore-group-by`), and every storage access is guarded, so the page works when storage is blocked.
- **Documentation changes** are always grouped, one closed group per rule, ordered by number of rows.
- **Filters**: a row is shown while any of its findings matches (as before); a group while any of its rows is. When the search or path filter has text, groups with matches open (and stay open when the text is cleared).
- **Unchanged:** the result JSON, finding IDs, the count line and every other report.

## Impacts

- `src/render/explore.ts`; tests in `test/unit/explore.test.ts` and `test/unit/directions.test.ts` (the new shape of `rows`).
- Docs: README (the `explore` description) and the PLAN.md section 5 report table; the proposal and a PLAN.md section 8 entry.

## References

- [Show a change's request and response findings as one entry in review and explore](2026-11-23T0348-merge-request-response-entries.md)
- [The explore report is a diff view](2026-11-22T1647-explore-is-a-diff-view.md)
- [Reports by audience as views over one result](2026-11-21T0258-reports-by-audience.md)
- [Feature proposal](../feature-backlog/explore-sections-and-grouping.md)

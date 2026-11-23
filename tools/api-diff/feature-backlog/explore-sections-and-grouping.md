# Explore page: sections, grouping by schema or operation, and folded documentation changes

| | |
|---|---|
| **Status** | Built (see the [decision record](../decision-records/2026-11-23T0355-explore-sections-and-grouping.md)) |
| **Summary** | Lay the `explore` page out like the `review` report: input problems and version checks first, changes grouped under their schema or operation (or a flat list), documentation changes folded into one group per rule, then notes. |
| **Value / effort** | high / low |
| **Plan entry** | [PLAN.md section 8, *Large specs and noise*](../PLAN.md#large-specs-and-noise) |

## What it does

The `explore` page was one flat list of rows. On a generated 80-operation PR it had 61 rows after [request and response findings were merged](merge-request-response-findings.md): 46 of them documentation-only changes (26 `summary-changed`, 20 `description-changed`), and the same schema repeated on several rows. The text `review` report already folds documentation changes and groups by root cause, so the HTML page was the noisier of the two.

This proposal gives the page the `review` report's layout:

- **Sections:** *Problems with the inputs*, *Version*, *Changes*, *Documentation changes*, *Notes*, each with a count, and hidden when the filters leave it empty.
- **Changes grouped by schema or operation:** one collapsible group per root cause, with its badge (worst severity of the rows shown), the number of rows shown and the operations it affects. Rows inside don't repeat the group's name. Groups whose worst severity is error or warn start open. Groups are ordered worst first, then largest, then by name in natural order (`Res2` before `Res10`).
- **A "group by" control** in the filter bar: *schema or operation* (the default) or *none* for the flat list. It is remembered per viewer in the browser, and the page works the same when browser storage is unavailable.
- **Documentation changes folded per rule:** one closed group per rule (`summary-changed ×26`), whichever "group by" is chosen, with each change inside as its own row.
- **Filters and search** work as before. A group is shown while any of its rows is. A search or path filter opens the groups that have matches.

Only the page changes: the result JSON, finding IDs and the other reports are unchanged.

## Options considered

- **Documentation changes as one flat section**, or **under their schema or operation**. Not chosen: one group per rule matches the `review` report and makes the common case ("26 summaries reworded") one line.
- **Groups all open or all closed** at first. Not chosen: open for error and warn, as in the `review` HTML.
- **Grouped only**, with no control. Not chosen: the flat list is useful for scanning or searching everything at once.
- **Input problems, version checks and notes in one "other" group.** Not chosen: own sections, as in `review`.

## Related

- [One entry per change in requests and responses](merge-request-response-findings.md), built first.
- Still an idea: collapsing the same edit made in several schemas ("in 7 schemas") into one row.

## Open questions

- None.

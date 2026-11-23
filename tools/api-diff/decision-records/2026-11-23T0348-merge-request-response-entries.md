# Show a change's request and response findings as one entry in review and explore

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-23 03:48 UTC |
| **Summary** | The `review` report (text and HTML) and the `explore` page show a schema change's `…-in-request` and `…-in-response` findings as one entry with each direction's severity and ID; the result, IDs and acknowledgements stay per finding, and `ci` is unchanged. |
| **Milestone** | — (after M10) |

## Background

A schema change is judged separately for each direction it's used in ([decision record](2026-11-21T0241-direction-aware-classification.md)), so a change to a schema used in both requests and responses gives two findings with the same subject, message and place, differing in rule suffix, severity and affected operations. Reports listed both, which an adoption review found makes the `explore` page and the PR comment read every schema change twice. The proposal is [One entry per change in requests and responses](../feature-backlog/merge-request-response-findings.md).

The choices below were asked one by one.

## Alternatives considered

- **Merge in the engine** (one finding carrying a severity per direction). Not chosen: it changes finding IDs, so every existing acknowledgement would go stale, and the result schema, overrides and severity sources would need rework.
- **Also group `explore` rows by schema or operation, collapse the same edit across schemas, or fold docs-only changes.** Not chosen for now; listed in the proposal.
- **`explore` page only, leaving the text `review` as is.** Not chosen: the PR comment has the same duplicate lines.
- **Review text layout: everything on one line**, or **only the worst direction with the other appended**. Not chosen: lines get too long, or the second direction is easy to miss. A second line with both directions was chosen.
- **`explore` filtering by the worst severity only.** Not chosen: unticking `error` would then hide the `info` direction too.
- **Merge in `ci` too.** Not chosen: `ci` lists only findings at the gate threshold, so pairs are rare there, and one line per finding is easier to grep.

## Decision

- **Which findings merge:** two findings whose rules differ only in the `-in-request` / `-in-response` suffix, with the same subject, message, file and JSON Pointer (revision side, else base). At most one per direction. A policy `message` that words the two directions differently keeps them apart. The entry's severity is the worst of its parts; parts are listed request first. Shared code: `mergeDirections` and `entryLines` in `src/render/common.ts`.
- **`review` text:** the change on one line, with the worst severity (or `-` as before when the group's entries all have the group's severity), the location and the rule without the direction; then a dim line `request ERROR · id … ␣␣ response INFO · id …`; then `request: acknowledged until …` / `response: …` for each acknowledged part. Merging happens within each group, so with `group-by` other than root cause, only parts in the same group merge.
- **`review` HTML:** the same, with severity badges per direction.
- **`explore`:** the page data gains `rows` (lists of finding indexes). A merged row is badged with the worst severity and labelled with each direction's severity. Opened, it shows the shared rule and kind, a section per direction (rule, severity source, finding ID, affected operations, acknowledgement, exclusions, explorer links, and the client note when the notes differ), then the source once. A row is shown while any of its findings matches the filters, and its badge shows the worst severity among those that match. The count reads `N of M changes (n of m findings)` when rows were merged, and `N of M findings` as before otherwise.
- **Unchanged:** the JSON result and its schema, finding IDs, acknowledgements, overrides, counts and `state`, the exit code, and the `ci`, `summary`, `changelog`, `sdk` and `audit` reports.

## Impacts

- `src/render/common.ts`, `src/render/review.ts`, `src/render/html.ts`, `src/render/explore.ts`; tests in `test/unit/directions.test.ts`.
- Scripts that parse the `review` text see one line per change plus a directions line, instead of two finding lines; the JSON result is unchanged.
- Docs: `docs/getting-started.md` (example and how to read it), README (report descriptions); the proposal and a PLAN.md section 8 entry.

## References

- [Classify schema changes by variance and usage direction](2026-11-21T0241-direction-aware-classification.md)
- [Finding IDs in text reports and an `api-diff ack` command](2026-11-23T0313-ack-command-and-ids-in-text.md)
- [The explore report is a diff view](2026-11-22T1647-explore-is-a-diff-view.md)
- [Feature proposal: One entry per change in requests and responses](../feature-backlog/merge-request-response-findings.md)

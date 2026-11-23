# Finding IDs in text reports and an `api-diff ack` command

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-23 03:13 UTC |
| **Summary** | Every text report shows each finding's ID; `review` and `ci` end with a hint while a change at warn or above is open; `api-diff ack <id> --reason --expires [--owner]` appends a checked entry to `api-diff.ack.yaml` without running a comparison. |
| **Milestone** | — (after M10) |

## Background

Reviewers accept a breaking change by adding its finding ID to `api-diff.ack.yaml` ([Acknowledgements](2026-11-22T0319-acknowledgements.md)). The IDs were only in the HTML, `explore` and JSON reports, not in the PR comment or the CI log where reviewers read the findings, and the file was edited by hand. The user chose to show the IDs in text reports with a hint, and to add a small `ack` command first, before the larger review loop in [the overlays and review-loop proposal](../feature-backlog/overlays-and-review-loop.md).

## Alternatives considered

### IDs in text reports

- **✅ At the end of each finding's line,** `… · rule-id · id 1e04c5d74301`, as the HTML reports already do. Every text report uses the same line, so `summary`, `audit` (which had the ID on its own line) and `ci` show it too.
- **Only in the PR comment:** two formats of the same line.

### The hint

- **✅ One line after the totals in `review` and `ci`,** only while a change at `warn` or above is unacknowledged. Version findings (`version-bump-too-small`, `version-unchanged`) and notices don't count, since they're fixed by bumping the version or fixing the input, not by accepting them.
- **Always shown:** noise when everything is accepted or only `info` is left.

### `api-diff ack`

- **✅ Appends without running a comparison.** It takes only the ID, so it's fast and works anywhere. A mistyped ID shows up on the next run as `acknowledgement-stale`. Checking the ID would need the same inputs as the comparison that produced it.
- **✅ Checks the entry:** 12-hex ID, a non-empty reason, an expiry date that isn't past (against today or `--as-of`), not already acknowledged. `--owner` is optional, as in the file.
- **✅ Keeps the file as written:** the entry is appended as text (js-yaml would drop comments when rewriting), and the result is parsed again. A file it can't append to safely (a flow-style list) is left alone with "add the entry by hand". A missing file is created with a one-line comment; an empty one, or one with only `[]`, keeps its comments.
- **✅ Refuses a duplicate** instead of replacing the existing entry: changing an accepted reason or expiry is a deliberate edit.
- **Interactive prompt or HTML buttons:** part of the review loop proposal, not built yet.

## Decision

As listed above.

## Impacts

- `src/render/common.ts` (`findingLine`, `ackHint`), `src/render/review.ts`, `src/render/ci.ts`, `src/render/audit.ts`; `appendAcknowledgement` in `src/policy/acks.ts`; the `ack` command in `src/cli/main.ts`.
- An acknowledgements file that is empty or holds only comments is now read as having no entries (js-yaml 5 rejected it).
- The audit HTML's Acknowledged table no longer wraps owners and dates.
- POLICY.md section 11, README, docs/getting-started.md, docs/workflows.md and docs/ci.md.

## References

- [Acknowledgements](2026-11-22T0319-acknowledgements.md)
- [feature-backlog/overlays-and-review-loop.md](../feature-backlog/overlays-and-review-loop.md), section 5
- `test/unit/acks.test.ts`

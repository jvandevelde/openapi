# Acknowledgements: stale and expired notices, left out of state

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-22 03:19 UTC |
| **Summary** | Acknowledged findings stay in reports with their severity but don't fail CI or make the state breaking; stale and expired acknowledgements are `acknowledgement-stale` and `acknowledgement-expired` (info). |
| **Milestone** | M6 |

## Background

POLICY.md section 11 describes the acknowledgements file (`finding`, `reason`, `owner`, `expires`) and says stale entries are reported as `info`, but RULES.md had no rule IDs for that, and it didn't say whether an acknowledged error still makes the result `breaking`. Both were asked and answered on 2026-11-22; smaller calls made while building are listed for review.

## Alternatives considered

### Stale and expired acknowledgements (asked)

- **✅ Chosen: two notice rules, `acknowledgement-stale` and `acknowledgement-expired` (info).** Both are findings with rule pages and policy settings, so they show up in every report and can be raised (e.g. stale to `warn` to keep the file clean).
- **Rejected: only `acknowledgement-stale`.** An expired acknowledgement would silently stop applying, and a finding would start failing CI with no explanation.
- **Rejected: warnings on stderr.** Not in the JSON result, so CI tooling and reports can't see them.

### State (asked)

- **✅ Chosen: acknowledged findings don't count towards `state`.** `state` matches the exit code: a PR whose only error is acknowledged reads `compatible`. `counts.acknowledged` says how many are covered.
- **Rejected: `state` counts everything.** The state and the exit code would disagree.

### Decided while building (for review)

- **The severity isn't changed.** The finding keeps its severity and `severitySource`; `acknowledged` (reason, owner, expires, file) is added. Reports can still show what was accepted.
- **`expires` is the last day it applies** (inclusive), compared with today (UTC) or `--as-of`.
- **Strict file:** unknown keys, a malformed ID (12 hex characters), a missing `reason` or `expires`, or the same finding twice are errors (exit 2), like the policy file.
- **Version checks ignore acknowledgements** (already accepted in the version-checks record): an acknowledged breaking change still needs a major bump.
- **Finding IDs are 12 hex characters.** POLICY.md and PLAN.md examples used 8; they now use 12, matching real reports.
- **File discovery** mirrors the policy file: `api-diff.ack.yaml` in the working directory if present, `--acknowledgements <file>`, `--no-acknowledgements`.

## Decision

As chosen above.

## Impacts

- `src/policy/acks.ts`; `Finding.acknowledged`, `counts.acknowledged` (result schema v0, additive); `stateOf` and `shouldFail` skip acknowledged findings; the text report marks them.
- Two rules in RULES.md section 11; POLICY.md section 11 describes the behaviour.
- Split findings (overrides, hints) have their own IDs, so acknowledging one part doesn't cover the others.

## References

- POLICY.md sections 11 and 12; RULES.md section 11
- [Version checks: needed bump per finding, 0.x shifted down, notices excluded](2026-11-21T2317-version-checks.md)

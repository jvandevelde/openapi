# The PR check reports changes and doesn't fail by default

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-22 06:53 UTC |
| **Summary** | `--fail-on` defaults to `never`, so `api-diff` reports breaking changes without failing CI unless a team opts in; the `review` report describes what changed and who it affects, without fix advice; with no `--report`, the `review` report is printed. |
| **Milestone** | M7 |

## Background

PLAN.md section 5 framed the `ci` report as "pass or fail?" and `review` as "what does this PR break, and how do I fix or accept it?", and the CLI defaulted to `--fail-on error`. Planning M7 (2026-11-22), the user said breaking changes are **expected** in their API repos: the tool must report them clearly, with no expectation of fixing or reverting them. These choices were asked and answered then.

## Alternatives considered

### Does the PR check fail on breaking changes?

- **✅ Chosen: report only by default (`--fail-on never`).** The check always passes and posts its report; breaking changes are highlighted, not blocked. Teams that want a gate set `defaults.fail-on` in the policy or `--fail-on` in CI.
- **Rejected: fail unless acknowledged.** Every expected breaking change would need an acknowledgement entry just to merge.
- **Rejected: a neutral/warning check status.** GitHub check statuses need the Checks API, which a plain workflow step doesn't control; and it still implies something is wrong.

### What `review` focuses on

- **✅ Chosen: what changed and who it affects.** Grouped by root cause (component or operation), worst first, with severity, affected operations and a plain description. No fix advice; it stays on the rule pages and in `explore` (M8).
- **Rejected: changes plus migration notes per breaking change.** Useful later for `changelog` (M8); not needed in a PR review.
- **Rejected: keep fix advice.** It reads as "undo this", which isn't the intent.

### Default report

- **✅ Chosen: `review` as text** when no `--report` is given. A person at a terminal sees everything, grouped; CI asks for `--report ci` explicitly.
- **Rejected: `ci`**, which hides warn/info by default, and **keeping today's flat list**.

### Also asked

- **"Fixed / new since last push"** in `review` is dropped: there is no expectation of fixing, so comparing runs adds little.
- **Cached base index:** opt-in `--cache-dir`.
- **Done when:** a ready-to-copy GitHub Actions workflow and docs, plus a self-check workflow in this repo that runs `api-diff` on a sample spec on every PR.

## Decision

As chosen above. Severities, acknowledgements and `state` are unchanged: `state` still says `breaking`, and a team can still gate on it.

## Impacts

- The CLI's exit code is 0 for findings unless `--fail-on` or `defaults.fail-on` is set; exit 2 (usage or input errors) is unchanged.
- PLAN.md section 5 (`ci`, `review` rows) and the M7 row; POLICY.md section 2; README.
- The default output changes from a flat list to the `review` report.

## References

- PLAN.md section 5; [Build the ci and review reports first](2026-11-21T0405-ci-and-review-reports-first.md)

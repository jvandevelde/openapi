# Report settings: per-report views, the ci view decides the exit code

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-22 07:01 UTC |
| **Summary** | A report's `exclude` and `include` settings filter what it shows (notices and version checks always stay) and its counts and state are recomputed; the `ci` report's settings also decide the exit code; settings for reports that arrive later are validated now and refused only when used. |
| **Milestone** | M7 |

## Background

POLICY.md section 10 configures reports with `exclude`, `include`, `group-by`, `format`, `template` and `extends`, for seven built-in reports and custom ones. M7 builds `review`, `ci` and `summary`, plus HTML for two of them. Building step 3 needed answers to how a report's filters relate to the exit code and to state, and what to do with settings for reports that don't exist yet. These were decided while building and are listed for review.

## Alternatives considered

### Filters and the exit code

- **✅ Chosen: the `ci` report's settings decide the exit code**, whether or not `--report ci` is produced. `ci` is the gate, so "leave internal changes out of the gate" is `reports.ci.exclude: [internal]`.
- **Rejected: the exit code always uses every finding.** A team couldn't keep internal changes out of the gate without `ignore`, which stops comparing them at all.
- **Rejected: each produced report's filters combined.** The exit code would change depending on which reports were asked for.

### Counts and state in a filtered report

- **✅ Chosen: recomputed from what the report shows**, so a report never says "1 error" when it lists none. The JSON result from `--report review:json` is the filtered view; the full result is the default report with no settings.
- **✅ Notices and version checks are always kept:** they're about the inputs and the release, not a place that might be excluded.

### Settings for later reports

- **✅ Chosen: validate every documented key now; refuse unsupported ones only when that report is produced** (`template`, `include.extensions`, `extends` and custom reports, grouping other than the preset's). A policy can be written for M8/M9 reports ahead of time without breaking today's runs, and typos are still caught.
- **Rejected: refuse them in the policy file.** The POLICY.md example (which configures `changelog`) would become an invalid policy until M8.
- **Rejected: accept and ignore them.** A `template` that silently does nothing is worse than an error.

### HTML

- **✅ One self-contained file**, inline CSS, no scripts or network, light and dark themes. Groups with errors or warnings start open; info groups and documentation changes start closed. Finding IDs are shown, for acknowledgements.

## Decision

As chosen above.

## Impacts

- `src/render/config.ts`, `src/render/html.ts`; `--report` and `-f` accept `html` for `review` and `summary`.
- POLICY.md section 10 lists what works in M7; its example now defines the exclusion set it uses.

## References

- POLICY.md section 10; PLAN.md section 5
- [The PR check reports changes and doesn't fail by default](2026-11-22T0653-report-not-gate.md)

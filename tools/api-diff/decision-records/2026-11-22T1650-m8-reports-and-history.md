# M8 reports and history: what each shows, and the calls made building them

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-22 16:50 UTC |
| **Summary** | The changelog groups by tag and operation with a separate shared-types section; the sdk report bumps by sdk-profile severities; explore embeds a few source lines per finding instead of whole specs; history links reverts by opposite rules at the same place and keeps the latest steps under --max-steps. |
| **Milestone** | M8 |

## Background

PLAN.md section 5 describes the `changelog`, `sdk` and `explore` reports and the history timeline. Building them (M8 steps 3–6) needed choices the plan leaves open. They were made while building and are listed here for review.

## Alternatives considered

### changelog

- **✅ Shared components get their own "Shared types" section** listing the operations that use them, instead of repeating the change under every operation (which multiplies one change by the number of operations).
- **✅ Entries are added / changed / deprecated / removed**, marked "breaking" for `error`, each with its client note. The same change in requests and responses is one entry.
- **✅ Left out:** documentation-only changes (unless `include.kinds` lists `docs`), notices, version checks, acknowledgement details and unused components.
- **✅ Text is Markdown-style**, so it can be pasted into release notes.

### sdk

- **✅ The SDK bump uses `--profile sdk` severities whatever profile the run used**, since that's what generated code sees; severities the policy set explicitly are kept.
- **✅ It includes sdk-kind findings plus wire rules that change generated code's shape** (operations, parameters, properties, types, enum members, union branches).

### explore

- **✅ A few source lines around each finding (4 before and after), base and revision side by side,** instead of embedding both whole specs (up to 16 MB extra). Snippets are only computed when `explore` is requested.
- **✅ Rendered by a small inline script** from embedded JSON; all spec text is inserted as text, and the JSON can't close its script tag.

### history

- **✅ Reverts are found by opposite rules at the same place** (e.g. `operation-removed` then `operation-added` for the same operation; a limit going back to its old value). Unmatched changes stay unlinked.
- **✅ `--max-steps n` keeps the latest n steps**; the net result still covers the whole range, and the report says how many earlier steps were left out.
- **✅ `--tags-only` keeps tagged commits and the end of the range,** so the last step reaches `<end>`.
- **✅ Each version is parsed once** (an in-memory cache serves it again as the next step's base); commits whose files are byte-for-byte unchanged are skipped.
- **Deferred:** parsing in worker threads and the persistent index cache (PLAN.md backlog), and HTML per-element rows; the HTML search filters every step by element instead.

## Decision

As chosen above.

## Impacts

- `src/render/changelog.ts`, `sdk.ts`, `explore.ts`, `timeline.ts`; `src/history.ts`; `api-diff history` in the CLI.
- The result gains `snippets` (only with explore), `operations` and each side's `title` (schema v0, additive).

## References

- PLAN.md section 5; [History timeline from consecutive comparisons](2026-11-21T0400-history-timeline.md)
- [Migration notes for clients instead of fix advice](2026-11-22T1634-client-migration-notes.md)

# M9 reports, owners and templates: the calls made building them

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-11-22 20:28 UTC |
| **Summary** | Owner precedence is operation, path item, tags, policy, document; reach filters narrow impact lists and keep API-wide changes; only review and audit can be regrouped; a template needs format html or txt and its report's formats become that and json; custom reports need extends; audit takes no filters. |
| **Milestone** | M9 |

## Background

[M9 governance choices](2026-11-22T2027-m9-governance-choices.md) settled the main questions. Building M9 needed further choices the plan leaves open. They were made while building and are listed here for review.

## Alternatives considered

### Owners

- **✅ Precedence for an operation:** its `x-owner`, then its path item's; then its tags' `x-owner` (all of them); then the last matching `owners.assign` entry; then the document's `x-owner`. The spec beats the policy, since the policy is the fallback for specs that aren't annotated.
- **✅ A finding's owners** are its operation's or component's owners plus the owners of every operation it affects; a finding with neither gets the document's owners. Notices and version checks have none.
- **✅ An invalid `x-owner`** (not text or a list of text) is `spec-invalid` and ignored, like invalid hints.
- **✅ `owners.extension`** names the extension (default `x-owner`), like the `lifecycle` extensions.
- **✅ `require-owner` with no owners:** an acknowledgement for a finding nobody owns doesn't apply.

### Reach filters (`--uses`, `include.extensions`, `include.owners`)

- **✅ A change is kept if it reaches a matching operation:** its operation; its component, if the component itself matches; or one of the operations in its impact list. The impact list is narrowed to the matching operations, so a partner changelog doesn't name internal operations.
- **✅ Changes about the whole API** (no operation, component or impact list, e.g. a server URL) are always kept: they reach every consumer.
- **✅ `include.extensions` needs every listed extension to match** (on the operation, its path item or the document), like an override's `extension` match; unlike exclusion sets, one matching affected operation is enough, since the change does reach it.
- **✅ `--uses` entries** are `METHOD /path` with any parameter names (a query string is ignored) or an operationId; entries that match nothing are listed on stderr and in the report header, not an error, since access logs list operations that no longer exist.

### Grouping

- **✅ `review` and `audit` can be grouped by any `group-by` value;** `ci`, `changelog`, `sdk` and `summary` keep their grouping. Grouped by owner, tag or operation, a finding appears under each; an owner or tag group lists only its own affected operations.

### Custom reports and templates

- **✅ Every custom report needs `extends`;** settings are merged key by key along the chain, `include` key by key too.
- **✅ A template needs `format: html` or `txt`** (the format it writes); that report's formats are then that one and `json`, which prints exactly the data the template sees.
- **✅ Template paths are relative to the policy file.** Templates are read and checked before comparing, so a typo fails fast (exit 2).
- **✅ Names are checked against declared data shapes,** including inside sections that are empty in a run; a test checks the shapes cover every key the reports produce over all test cases. `{{list.length}}` is allowed; partials are refused.
- **✅ HTML escaping matches the built-in reports** (`& < > " '`), not Mustache's default, which also escapes `/` and `=`.
- **✅ `rules.<id>.message` and `note`** are templates over the finding, checked when the policy is loaded; the note is recorded on the finding (`note` in JSON) and used by changelog and explore.

### audit

- **✅ Formats txt, json and html,** grouped by rule. It takes no `exclude` or `include` (it always shows everything); `--uses` still applies, as it is asked for on the command line. It lists which reports leave out each exclusion set.

## Decision

As chosen above.

## Impacts

- Result schema v0, additive: `owners` and `note` on findings, `owners` on operations, `uses`.
- POLICY.md sections 3, 10, 11 and 14; README; docs/spec-authors.md.

## References

- [M9 governance choices](2026-11-22T2027-m9-governance-choices.md)
- [Report settings: per-report views, the ci view decides the exit code](2026-11-22T0701-report-settings.md)
- [How in-spec hints are scoped, validated and reported](2026-11-21T2109-in-spec-hint-semantics.md)

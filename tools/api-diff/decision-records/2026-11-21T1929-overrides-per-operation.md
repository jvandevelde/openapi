# Overrides apply per operation, splitting shared findings

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 19:29 UTC |
| **Summary** | Override operation keys match a finding's operations (its subject, or the operations in its `impact`); when those operations get different severities the finding is split, one part per severity. |
| **Milestone** | M6 |

## Background

POLICY.md says overrides "apply per usage, so a shared component used under several paths can be affected differently in each". Since M5, a change in a shared component is reported **once**, at the component, with the operations that use it in `impact`, and the same change in 3 or more operations is collapsed into one "N operations" finding. Building overrides (M6 step 3) needed a rule for findings that span operations an override treats differently, for example a `stability: [beta]` override that covers one of three operations using `Order`.

## Alternatives considered

### Findings that span operations

- **✅ Chosen: split the finding by resulting severity.** Each part keeps the subject and lists only its operations in `impact`; a bulk "N operations" part gets a new count, or the operation itself when only one is left. One group (the usual case) leaves the finding exactly as before, with the same ID. This is what "applies per usage" asks for, and nothing is hidden: the beta operation's part is `info`, the others keep their severity.
- **Rejected: match if any operation matches.** One beta operation would lower the finding for every stable operation using the component, so a breaking change could pass CI.
- **Rejected: match only if every operation matches.** Safe, but the override would rarely apply to shared components, which is where teams most often need it.
- **Rejected: take the strictest severity across operations.** Safe, but it ignores the override for the operations it covers, and the report can't show why.

### Other choices made at the same time

- **✅ Chosen: an override whose `rules` map doesn't name the finding's rule is skipped** when looking for the last match, so earlier overrides still apply. Treating it as a match that changes nothing would make the order of unrelated overrides matter.
- **✅ Chosen: a blanket `severity` applies to conditional cases too.** Overrides express "this part of the API is different" (e.g. draft), so it should cover everything there. An override's `rules` map follows the top-level rules, including [the conditional-severity decision](2026-11-21T1919-policy-severity-for-conditional-rules.md).
- **✅ Chosen: rule options other than the conditional-case option are rejected inside overrides.** Options like `honour-open-hint` change what a rule detects, not its severity, and per-operation detection settings aren't supported. Rejecting them is clearer than ignoring them.
- **✅ Chosen: operation keys never match findings without operations** (document-level, security schemes), rather than matching everything or erroring.

## Decision

As above. Split parts get finding IDs derived from the whole finding's key plus their operations, so they are stable across runs with the same policy. `severitySource` names the override: `policy <file>: overrides #<n> (<match>)`.

## Impacts

- `src/policy/overrides.ts` (parsing, globs, matching), `src/policy/context.ts` (operation, component and document extensions), `src/classify/classify.ts` (per-operation resolution and splitting).
- Changing an override can change finding IDs of split parts, so acknowledgements of a split part need renewing when the policy changes how operations are grouped.
- POLICY.md section 5 documents the matching rules.

## References

- POLICY.md sections 5 and 12; PLAN.md *Shared components used in both requests and responses*
- [Schema engine: one finding per direction, effective schemas, bulk collapsing](2026-11-21T1539-schema-engine.md)

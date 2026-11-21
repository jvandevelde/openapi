# How in-spec hints are scoped, validated and reported

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 21:09 UTC |
| **Summary** | `x-api-diff` hints apply from the nearest containing node outwards, then through the affected operation, then the document root; `ignore` hides a node on either side; invalid hints are `spec-invalid`; changes to `x-api-diff` itself are never reported. |
| **Milestone** | M6 |

## Background

POLICY.md section 12 defines three hints (`enum: open`, `ignore: true`, `rules`) and says `rules` apply to "this node and everything under it". Building them (M6 step 4) needed answers to questions the reference doesn't settle: what "under it" means for a shared component that an operation uses but doesn't contain, which side's hint counts when the two documents differ, what happens to a malformed hint, and whether editing a hint is itself a change.

## Alternatives considered

### Which `rules` hint applies

- **✅ Chosen: nearest containing node first, then the affected operation and its path item, then the document root.** The document tree decides first, so a hint on a schema beats one on the operation that uses it. An operation's hint also reaches the shared components it uses (through the finding's affected operations), with the same per-operation splitting as overrides. The root hint is the team-wide fallback, so it comes last even though it contains everything.
- **Rejected: document tree only.** A hint on `GET /orders` wouldn't cover `#/components/schemas/Order`, which is where most of that operation's schema changes are reported. Authors would have to put hints on shared components, affecting every other operation too.
- **Rejected: usage first, then tree.** An operation-wide hint would beat a more specific hint on a schema inside it.

### Which side's hint counts

- **✅ Chosen: either side.** Hints are looked up in the revision, then the base. `ignore` hides a node if either document marks it, and a component finding is dropped if only ignored operations use it.
- **Rejected: revision only.** Removing an ignored operation would be reported as `operation-removed`, because the revision no longer has the node (or the hint).

### Invalid hints

- **✅ Chosen: `spec-invalid` (`error`) at the hint, with a suggestion.** Same strictness as the policy file: a typo like `ignre` must not be silently ignored.
- **Rejected: ignore invalid hints with a warning.** A mistyped `ignore` would quietly compare the node, and a mistyped rule ID would quietly use the default severity.

### Changes to `x-api-diff`

- **✅ Chosen: not reported.** `x-api-diff` configures this tool, not the API, so adding or editing it isn't `extension-changed`.
- **Rejected: report as `extension-changed` like any extension.** Every new hint would add a `docs` finding.

### `enum: open`

- **✅ Chosen: only on the schema that has the `enum`.** The schema is the contract for its values. `open-extensions` follows the same rule; any value other than `false` counts as present.
- **Rejected: inherited from containing schemas or the operation.** An object-level hint would open every enum in it, which is rarely intended. Authors who want that can use `rules: { enum-value-added: info }` instead.

## Decision

As chosen above. Hint `rules` maps accept the same settings as an override's (`severity` and the conditional-case option). A finding's `severitySource` names the hint: `in-spec hint <file>#<pointer>: rules.<rule-id>`, or `…: enum: open`.

## Impacts

- `src/policy/hints.ts` (index, validation), `src/engine.ts` (ignore filtering before bulk collapsing, `not-compared` notices), `src/classify/classify.ts` (resolution).
- `extension-changed` skips `x-api-diff` in both the docs diff and the schema engine.
- POLICY.md section 12 and [docs/spec-authors.md](../docs/spec-authors.md) describe the behaviour.

## References

- POLICY.md section 12
- [Overrides apply per operation, splitting shared findings](2026-11-21T1929-overrides-per-operation.md)

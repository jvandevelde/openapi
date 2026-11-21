# Schema engine: one finding per direction, effective schemas, bulk collapsing

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 15:39 UTC |
| **Summary** | Schema changes are reported once per direction, at the schema they are in; `allOf` is merged with origins; docs findings are one per changed annotation; the same change in 3+ operations is collapsed into one finding. |
| **Milestone** | M5 |

## Background

M5 replaces `unclassified-change` with the schema, reference and docs rules. Several reporting choices had to be made; the user answered each.

## Alternatives considered

- **One finding per change, at the worst severity across directions**: fewer findings, but the rule ID wouldn't say which direction set the severity, and policies couldn't target one direction.
- **Docs findings grouped per node, or one per rule overall**: more compact, but no location or acknowledgement per change.
- **Bulk threshold 2 or 5; subject as a common path prefix**: rejected for 3 and "N operations".
- **Example re-validation in M5**: needs a JSON Schema validator and a new rule; the user asked why it was required. It isn't, so it stays in the backlog.

## Decision

- **Directions:** a change in a schema used by requests and responses produces up to two findings, `<rule>-in-request` and `<rule>-in-response`, each with the operations in that direction. Rules without directions (`ref-*`, `schema-title-changed`, docs and component rules) are reported once.
- **Location:** each change is reported at the schema it is in: the component (`#/components/schemas/Address`), the file and pointer for other files, or the operation for inline schemas, with `details.path` inside it.
- **Effective schemas:** `allOf` members (and 3.1 `$ref` siblings) are merged before comparing, but each keyword keeps its origin. A change in a shared base type is reported once for the base, with every subtype's operations; moving a property between `allOf` members is not a change.
- **Walking:** pairs of schema nodes are walked once per direction and cached; a pair met again while in progress is assumed equal (safe for recursive schemas); unchanged subtrees (equal deep hashes) are skipped. Literal nesting beyond 400 levels is compared by hash only.
- **readOnly/writeOnly:** readOnly properties are ignored in requests and writeOnly in responses; becoming readOnly/writeOnly has its own rules.
- **Unions:** branches are matched by `$ref` target, then identical inline content, then position for the remaining inline branches.
- **Unresolved `$ref` in a schema:** reported as `ref-unresolved`; the position is compared as if empty (e.g. type widened), not as inlined.
- **Unused components:** added/removed components nothing uses are `component-added`/`component-removed`; a changed component nothing uses is one `component-unused` finding (there is no direction to classify it with).
- **Docs:** one finding per changed annotation (`description`, `summary`, `example(s)`, `externalDocs`, `x-` extensions, `info`, tags), anywhere in the document.
- **Bulk collapsing:** the same change (same rule, direction, location and details) in 3 or more operations becomes one finding with subject "N operations" and the operations in its impact. Not applied to `operation-added/removed/path-changed` or notices.
- **Example re-validation:** moved to the backlog.

## Impacts

- `unclassified-change` now only reports differences no rule covers (e.g. `xml`, `patternProperties`).
- `--fail-on` and the profiles work per direction.
- 81 new test cases; bulk threshold becomes a policy option in M6.

## References

- `src/diff/schema-engine.ts`, `src/diff/docs.ts`, `src/diff/bulk.ts`
- [Classify schema changes by variance and usage direction](2026-11-21T0241-direction-aware-classification.md)

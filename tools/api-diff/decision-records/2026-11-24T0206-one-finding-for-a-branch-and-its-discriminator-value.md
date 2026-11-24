# One finding for a union branch added or removed with its discriminator value

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-24 02:06 UTC |
| **Summary** | When a `oneOf`/`anyOf` branch and the `discriminator.mapping` values that point to it are added or removed together, only `union-branch-added`/`-removed` is reported, with the values in `details.discriminatorValues`; the mapping rules still report values whose branch didn't change. |
| **Milestone** | M5 |

## Background

Adding a variant to a discriminated union means adding a branch and a mapping value. That gave two findings, `union-branch-added` and `discriminator-mapping-added`. They had the same default severities (info/warn added, error/info removed), the same fix and almost the same migration note. The second finding never changed the result, but it added a warn, needed a second `ack` and made two changelog lines for one change.

Neither rule can be dropped, because each one catches changes the other misses. Only the branch rule catches a `oneOf` with no discriminator, or a discriminator with no explicit mapping. Only the mapping rules catch an alias added or removed for a branch that stays, a discriminator on a parent schema extended with `allOf` (no union) and `discriminator-mapping-changed`.

## Alternatives considered

- **✅ Chosen: fold the mapping value into the branch finding.** One finding per variant, under the union rule, which also covers unions with no discriminator. The finding still shows the value clients see on the wire.
- **Rejected: fold the branch into the mapping finding.** The mapping rule would then report some new variants and the union rule others, depending on whether the spec has a mapping.
- **Rejected: keep both findings.** It's the noise this record removes.
- **Rejected: drop one of the rules.** Each one catches changes the other misses (see Background).

## Decision

- In one schema comparison, a mapping value added on the revision side whose target (resolved like `$ref`) is a branch the union rules report as added isn't reported as `discriminator-mapping-added`. It goes into that branch's `union-branch-added` finding as `details.discriminatorValues` (every such value, in mapping order). The same goes for removed values and `union-branch-removed`.
- Only branches that are a plain `$ref` can match. A value for an inline branch is still reported by the mapping rules.
- The message gets ` (discriminator 'bird')` and the migration note gets ` (discriminator \`bird\`)`.
- The folded finding is a `union-branch-*` finding: policy, severity and acknowledgements for `union-branch-*` apply to it. A policy set only on `discriminator-mapping-*` doesn't. The defaults are the same, so nothing changes unless a policy sets the two differently.
- Unchanged: aliases, mapping values with no union beside them, `discriminator-mapping-changed`, `discriminator-property-changed`, and branches added without a mapping value.

## Impacts

- `#union` (now returns the unmatched branches), `#discriminator` and the new `#branchChanges` in `src/diff/schema-engine.ts`; `schemaMessage` in `src/rules/registry.ts`; the union notes in `src/rules/notes.ts`; the four rule descriptions in `src/rules/docs.ts` and the generated pages.
- Test cases `union-branch-added-with-discriminator`, `union-branch-removed-with-discriminator` and `union-branch-added-with-alias` and `union-branch-removed-with-alias`.
- Specs that add or remove a variant with its mapping value get one finding fewer. An acknowledgement for the old `discriminator-mapping-*` finding no longer matches a finding and is reported as stale (`acknowledgement-stale`).

## References

- [Schema engine](2026-11-21T1539-schema-engine.md)
- [`union-branch-added`](../docs/rules/union-branch-added.md), [`discriminator-mapping-added`](../docs/rules/discriminator-mapping-added.md)
- RULES.md section 7, composition

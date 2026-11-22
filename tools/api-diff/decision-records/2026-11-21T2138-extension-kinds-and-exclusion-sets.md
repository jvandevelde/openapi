# Classified extension changes get their own rules; exclusion set membership

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 21:38 UTC |
| **Summary** | Changes to extensions the policy classifies are `extension-changed-sdk` (info, sdk profile warn) and `extension-changed-wire` (warn); exclusion sets match operations and components by any key, `ignore`d sets aren't compared, and other sets are recorded on findings for reports. |
| **Milestone** | M6 |

## Background

POLICY.md section 6 classifies `x-` extensions as `wire`, `sdk` or `docs`, and section 8 defines named exclusion sets and `ignore`. RULES.md had one rule for extension changes (`extension-changed`, docs, info), and report-level `exclude` belongs to M7. Building M6 step 6 needed a rule shape for classified extensions (asked and answered on 2026-11-21) and exact membership rules for sets (decided while building, listed for review).

## Alternatives considered

### Classified extension changes (asked)

- **✅ Chosen: two new rules, `extension-changed-sdk` (sdk; info, `--profile sdk`: warn) and `extension-changed-wire` (wire; warn).** Each has its own default, rule page and policy setting; `extension-changed` stays docs/info.
- **Rejected: one rule whose kind changes.** Severity couldn't be set separately per kind.
- **Rejected: change only the kind label.** Classifying an extension as `wire` would still be `info`.

### Exclusion sets (decided while building)

- **✅ Membership by any key:** an operation is in a set if any of `paths`, `operationIds`, `tags` or `extensions` (on the operation or its path item) match; a component schema if `components` or `extensions` on the schema match. Sets are written to gather things, so OR is the natural reading (unlike override `match`, which narrows with AND).
- **✅ `extensions: [x-internal]` matches any value except `false`/`null`;** a mapping requires the given values.
- **✅ `ignore`d sets work like `x-api-diff: { ignore: true }`:** no findings for their operations and components, ignored operations leave other findings' affected-operation lists, and a shared component is still compared for operations outside the set. One `not-compared` notice per set lists its operations.
- **✅ Other sets are recorded on findings (`exclusions` in the JSON result)** now, so M7 reports can filter without recomputing. A component finding belongs to a set only if **all** its affected operations do; if any public operation uses it, it stays in public reports. Rejected: "any operation" (a change visible to public clients would be hidden from the public changelog).
- **✅ `ignore` must name defined sets;** a typo is a policy error with a suggestion.

## Decision

As chosen above.

## Impacts

- `src/policy/exclusions.ts`; engine post-processing for extension kinds, ignored sets and tagging; `exclusions` added to the result schema (v0, additive).
- POLICY.md sections 6 and 8, RULES.md section 10 and [docs/spec-authors.md](../docs/spec-authors.md).

## References

- POLICY.md sections 6, 8 and 10
- [Exclusions are configurable named sets](2026-11-21T0303-configurable-exclusions.md)
- [How in-spec hints are scoped, validated and reported](2026-11-21T2109-in-spec-hint-semantics.md)

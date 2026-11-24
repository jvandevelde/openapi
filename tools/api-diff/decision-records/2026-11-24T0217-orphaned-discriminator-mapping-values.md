# Report discriminator values that point at no branch, on the revision

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-24 02:17 UTC |
| **Summary** | A new notice, `discriminator-mapping-orphaned` (warn), reports a `discriminator.mapping` value beside a `oneOf`/`anyOf` whose target isn't one of its branches or doesn't exist; it checks the revision only, whatever changed. |
| **Milestone** | M5 |

## Background

Removing a branch from a discriminated union and forgetting its mapping value leaves a value that routes payloads to a schema the union rejects. The diff reports only `union-branch-removed`, and nothing flagged the leftover value. A typo in a mapping target, or a target that was deleted, is a similar mistake: mapping values aren't `$ref`s, so `ref-unresolved` doesn't see them.

## Alternatives considered

- Which document to check:
  - **✅ Chosen: the revision only.** A problem in base is either fixed or still in the revision, where it is reported anyway.
  - **Rejected: both documents, as `ref-unresolved` does.** A base finding adds nothing to the revision's.
  - **Rejected: only values a change left behind.** Older leftovers would never be flagged.
- Default severity:
  - **✅ Chosen: `warn`.** The spec still loads; only payloads with that value can't be valid.
  - **Rejected: `error`.** It would fail CI over a spec mistake that may predate the change.
  - **Rejected: `info`.** Too easy to miss.
- Missing targets:
  - **✅ Chosen: the same rule, with `details.reason` `missing` or `not-a-branch`.** Both mean "this value can't work".
  - **Rejected: report them as `ref-unresolved`.** That rule is about `$ref`s, and it is an error.
  - **Rejected: don't report them.**

## Decision

- A section 11 notice, `discriminator-mapping-orphaned`, default `warn`, kind `wire`, with no request/response variants. It is listed with the other notices, so it doesn't count as a change for `version-unchanged`.
- It checks every schema in the revision, including inline ones: component schemas, schemas used by operations, `$ref` targets and everything inside them except data keywords (`example`, `examples`, `default`, `const`, `enum`) and `x-` extensions.
- A schema is checked when it has `discriminator.mapping` and its own `oneOf` and/or `anyOf`. A mapping value (a schema name, or a reference resolved from the schema's file) is reported when its target doesn't exist (`missing`), or when neither the target nor anything on its `$ref` chain is a `$ref` branch or on a branch's `$ref` chain (`not-a-branch`).
- Not checked: a discriminator with no union in the same schema (a parent extended with `allOf`, whose targets are never branches), a union with a branch that is itself a union (directly or through `$ref`), a branch whose `$ref` can't be resolved (already `ref-unresolved`), and targets in external URLs (not supported).
- The subject is the named schema, or `revision document` for an inline schema used by an operation. The location points at the mapping value.

## Impacts

- `src/index/orphaned-mappings.ts`, called from `loadSide` in `src/engine.ts` for the revision only; the rule in `src/rules/registry.ts` and `src/rules/docs.ts`; the notice lists in `src/render/common.ts` and `src/diff/versions.ts`; RULES.md section 11.
- Test cases `discriminator-mapping-orphaned` and `discriminator-mapping-orphaned-missing`.
- Specs that already have such values get a new warning on every run; it can be acknowledged, or turned off with `discriminator-mapping-orphaned: off`.

## References

- [One finding for a union branch added or removed with its discriminator value](2026-11-24T0206-one-finding-for-a-branch-and-its-discriminator-value.md)
- [`discriminator-mapping-orphaned`](../docs/rules/discriminator-mapping-orphaned.md)
- RULES.md section 11

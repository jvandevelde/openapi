# A union's type is its branches' types, and an untyped branch's type comes from its keywords

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-23 22:53 UTC |
| **Summary** | A `oneOf`/`anyOf` without its own `type` accepts the types of its branches (through `$ref`, `allOf` and nested unions); a branch without `type` whose keywords belong to one type only, such as `{properties: …}`, counts as that type. |
| **Milestone** | M5 |

## Background

Replacing a property's `oneOf` of object schemas with an inline `type: object` reported `type-narrowed` (`any` → `object`). The engine only read a schema's own `type` (and `allOf` members), so a union without one counted as any type. Union branches are often built by composition (`allOf` chains, unions in `allOf`, nested unions), and branches written as `{properties: …}` without `type` are common, though under JSON Schema they accept any value.

## Alternatives considered

- **✅ Chosen: derive the type set from the branches, and infer an untyped branch's type from its keywords.** Matches what spec authors mean; real narrowings (a `string` branch dropped) are still reported.
- **Rejected: keep strict JSON Schema for untyped branches.** Technically right, but it reports a narrowing for nearly every union of `{properties: …}` branches replaced by an object.
- **Rejected: a policy option for the inference.** More to document and test for a case where one answer is almost always wanted.

## Decision

- When one side is a union and the other isn't, the type set of the union is the union of its branches' type sets. Each branch is resolved through `$ref`, `allOf` and nested unions (up to 10 levels). If a branch's type can't be worked out, the union accepts any type.
- Every union merged in through `allOf` limits the type set (a value must match a branch of each), together with any own `type`.
- A union branch (not a top-level schema) without `type` whose keywords all belong to one type counts as that type: object (`properties`, `required`, `additionalProperties`, …), array (`items`, `minItems`, …), string (`minLength`, `pattern`, …) or number (`minimum`, `multipleOf`, …). With keywords of several types, or none, it stays any type.
- When both sides are unions, only their own `type` is compared; branch changes are reported by the union rules, so they aren't reported twice.
- Removing a union is still reported as `schema-widened` (info), whatever replaces it (asked and answered: leave as is).

## Impacts

- `#typeSet` in `src/diff/schema-engine.ts`; the effective schema records every merged union.
- Test cases `type-union-to-inline-object`, `type-narrowed-union`, `type-union-composed` and `type-union-untyped-branch`.

## References

- [Schema engine](2026-11-21T1539-schema-engine.md)
- [`type-narrowed`](../docs/rules/type-narrowed.md)

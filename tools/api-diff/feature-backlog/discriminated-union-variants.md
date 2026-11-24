# Discriminated-union variants as one change

| | |
|---|---|
| **Status** | Idea |
| **Summary** | Finish treating a discriminated-union variant as one change: the branch and its mapping value are already one finding; fold in the discriminator property's enum value too, apply an open-enum hint to the whole variant, match branches by discriminator value, and report enum values with no branch. |
| **Value / effort** | medium / medium |
| **Plan entry** | [PLAN.md section 8, *Large specs and noise*](../PLAN.md#large-specs-and-noise) |

## Background

A discriminated union usually describes each variant three times:

```yaml
PetKind: { type: string, enum: [cat, dog] }    # 1. the enum on the discriminator property
Pet:
  oneOf:                                       # 2. the union branches
  - $ref: '#/components/schemas/Cat'
  - $ref: '#/components/schemas/Dog'
  discriminator:
    propertyName: kind
    mapping:                                   # 3. the mapping (optional; implicit if left out)
      cat: '#/components/schemas/Cat'
      dog: '#/components/schemas/Dog'
```

The schema engine compares these on their own (`src/diff/schema-engine.ts`): `#enum` compares the enum wherever it is defined, `#union` matches branches by `$ref` target, then identical inline content, then order, and `#discriminator` compares `propertyName` and the explicit `mapping` entries. None of them knows about the others.

## Behaviour today

Part of this is built. Since [One finding for a union branch added or removed with its discriminator value](../decision-records/2026-11-24T0206-one-finding-for-a-branch-and-its-discriminator-value.md), a branch added or removed together with its mapping value is one `union-branch-*` finding (the value is in `details.discriminatorValues` and the message). Since [Orphaned discriminator mapping values](../decision-records/2026-11-24T0217-orphaned-discriminator-mapping-values.md), a mapping value whose target isn't a branch is reported as the `discriminator-mapping-orphaned` notice. Neither looks at the discriminator property's enum.

Checked on `main` after those records, on the spec above, with `Pet` used in a request and a response (`wire` profile):

| Change | Findings |
|---|---|
| Add a `Bird` variant (branch, mapping entry, enum value) | `union-branch-added` (on `Pet`, "discriminator 'bird'") and `enum-value-added` (on `PetKind`): each `info` in requests, `warn` in responses |
| Same, with an implicit mapping | The same two findings, without the discriminator value in the message |
| Remove the `Dog` variant | `union-branch-removed` and `enum-value-removed`: each `error` in requests, `info` in responses |
| Add `bird` to the enum only, with no branch or mapping | `enum-value-added` only; nothing says no variant handles `bird` |
| Mark `PetKind` open (`x-api-diff: { enum: open }`) and add `Bird` | `enum-value-added-in-response` drops to `info`; `union-branch-added-in-response` stays `warn` |
| Add or remove the `discriminator` keyword | `unclassified-change` |

What is left:

1. **Noise.** One variant change is still two findings per direction, because the enum finding's subject is a different component (`PetKind`), so neither root-cause aggregation nor the branch/mapping folding merges it.
2. **The open-enum hint only half works.** Teams that mark a discriminator enum as open to say "clients must accept new variants" still get a `warn` per new variant from `union-branch-added-in-response`.
3. **Enum consistency isn't checked.** `discriminator-mapping-orphaned` covers mapping values with no branch, but an enum value with no branch, or a branch whose discriminator value the enum doesn't allow, isn't reported.
4. **Branch matching ignores the discriminator.** PLAN.md (risk 7) says branches are matched "by discriminator value, `$ref` target or structural similarity". They are matched by `$ref` target and content only, so a variant whose schema is renamed (`Dog` → `Canine`, same `dog` value) is reported as a branch removed plus a branch added.

## What it would do

- **Find the variants.** For a union with a `discriminator`, build the variant set on each side: value → branch, from the explicit `mapping`, else the implicit mapping (schema names), with the discriminator property's `enum`/`const` in each branch (or a shared component) as the allowed values.
- **Fold the enum value into the variant.** Extend the branch/mapping folding: an enum value added or removed on the discriminator property, matching a branch's discriminator value added or removed in the same comparison, goes into that `union-branch-*` finding (e.g. `details.enumValues`) instead of a separate `enum-value-*` finding on the enum's component. The enum finding stays for values with no matching branch change.
- **Match branches by discriminator value first**, so a renamed variant schema with the same value is compared as the same branch (its schema changes appear as child findings, plus `ref-target-changed` for SDKs).
- **One open hint for the variant.** `x-api-diff: { enum: open }` on the discriminator enum, or a new `x-api-diff: { union: open }` on the union, lowers the whole variant addition in responses to `info`.
- **Enum consistency notices** (on the revision only, next to `discriminator-mapping-orphaned`): an enum value on the discriminator property with no branch, or a branch whose discriminator value the enum doesn't allow.

## Options

- **Fold the enum value in the engine**, the same way mapping values are folded. Consistent with the existing decision; acknowledgements for the old `enum-value-*` finding become stale, as they did for `discriminator-mapping-*`. A shared enum used outside the union complicates it: the value may matter elsewhere.
- **Fold in the reports only.** Keep the findings and IDs; `review` and `explore` show them as one entry. Cheap, but the JSON and `ci` still list both, and the open hint still needs fixing in the engine.
- **Only fix the open hint and add the enum notices.** Smallest change; leaves the noise.

## Related

- Decision records: [One finding for a union branch added or removed with its discriminator value](../decision-records/2026-11-24T0206-one-finding-for-a-branch-and-its-discriminator-value.md), [Orphaned discriminator mapping values](../decision-records/2026-11-24T0217-orphaned-discriminator-mapping-values.md).
- [Bulk-change collapsing](bulk-change-collapsing.md) and [One entry per change in requests and responses](merge-request-response-findings.md): the same "one change, one entry" idea for other cases.
- [Spec quality side-report](spec-quality-side-report.md): where consistency findings could live instead.
- RULES.md section 7, *Enums* and *Composition*.

## Open questions

- Engine folding or report-only folding?
- When the enum is a shared component also used outside the union, should its value change still be folded into the branch finding?
- Where does the discriminator enum count as "the" enum when each branch has its own `const` instead of a shared `enum`?
- Should the consistency checks be findings, or go in the spec-quality side-report?
- How does this interact with `anyOf` unions and nested discriminators?

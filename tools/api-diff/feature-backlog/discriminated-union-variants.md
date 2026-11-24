# Discriminated-union variants as one change

| | |
|---|---|
| **Status** | Idea |
| **Summary** | Treat the union branch, the discriminator mapping entry and the discriminator property's enum value as one variant, so adding or removing a variant is one finding, an open-enum hint applies to all of it, and mismatches between the three are reported. |
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

Checked with api-diff 0.12.0 on the spec above, with `Pet` used in a request and a response (`wire` profile):

| Change | Findings |
|---|---|
| Add a `Bird` variant (branch, mapping entry, enum value) | `union-branch-added`, `discriminator-mapping-added` (on `Pet`) and `enum-value-added` (on `PetKind`): each `info` in requests, `warn` in responses |
| Same, with an implicit mapping | `union-branch-added` and `enum-value-added` only |
| Remove the `Dog` variant | `union-branch-removed`, `discriminator-mapping-removed` and `enum-value-removed`: each `error` in requests, `info` in responses |
| Add `bird` to the enum only, with no branch or mapping | `enum-value-added` only; nothing says no variant handles `bird` |
| Mark `PetKind` open (`x-api-diff: { enum: open }`) and add `Bird` | `enum-value-added-in-response` drops to `info`; `union-branch-added-in-response` and `discriminator-mapping-added-in-response` stay `warn` |
| Add or remove the `discriminator` keyword | `unclassified-change` |

The three rules have the same severity pattern, so the result isn't wrong, but:

1. **Noise.** One variant change is up to six findings (three rules × two directions), each to read and acknowledge. Root-cause aggregation doesn't merge them, because the enum finding's subject is a different component.
2. **The open-enum hint only half works.** Teams that mark a discriminator enum as open to say "clients must accept new variants" still get two `warn`s per new variant.
3. **No consistency checks.** A discriminator value with no variant (enum value or mapping entry without a branch), or a variant whose value the enum doesn't allow, isn't reported. These are spec bugs that a diff tool sees naturally, since it already has both sides indexed.
4. **Branch matching ignores the discriminator.** PLAN.md (risk 7) says branches are matched "by discriminator value, `$ref` target or structural similarity". Today they are matched by `$ref` target and content only, so a variant whose schema is renamed (`Dog` → `Canine`, same `dog` value) is reported as a branch removed plus a branch added.

## What it would do

- **Find the variants.** For a union with a `discriminator`, build the variant set on each side: value → branch, from the explicit `mapping`, else the implicit mapping (schema names), with the discriminator property's `enum`/`const` in each branch (or a shared component) as the allowed values.
- **Report variant changes once.** A new `variant-added` / `variant-removed` (names to be decided) on the union, with details listing what changed (branch, mapping entry, enum value). The individual `union-branch-*`, `discriminator-mapping-*` and `enum-value-*` findings it explains become child findings, folded in reports the way bulk-change collapsing folds its members.
- **Match branches by discriminator value first**, so a renamed variant schema with the same value is compared as the same branch (its schema changes appear as child findings, plus `ref-target-changed` for SDKs).
- **One open hint for the variant.** `x-api-diff: { enum: open }` on the discriminator enum, or a new `x-api-diff: { union: open }` on the union, lowers the whole variant addition in responses to `info`.
- **Consistency findings** (spec-quality, on the revision only): a discriminator value with no branch, a branch with no value, or a mapping value the enum doesn't allow.

## Options

- **Fold in the reports only.** Keep today's findings and IDs; `review` and `explore` show them as one entry under the variant. Cheap, keeps acknowledgements, but the JSON and the `ci` report still list each one, and the open hint still needs fixing in the engine.
- **A variant finding in the engine, with the parts as children.** One finding to acknowledge; the children keep their IDs for anyone who acknowledged them. Changes the result for existing users.
- **Only fix the open hint and add consistency checks.** Smallest change; leaves the noise.

## Related

- [Bulk-change collapsing](bulk-change-collapsing.md) and [One entry per change in requests and responses](merge-request-response-findings.md): the same "one change, one entry" idea for other cases.
- [Spec quality side-report](spec-quality-side-report.md): where consistency findings could live instead.
- RULES.md section 7, *Enums* and *Composition*.

## Open questions

- Engine finding or report-only folding?
- Where does the discriminator enum count as "the" enum when each branch has its own `const` instead of a shared `enum`?
- Should the consistency checks be findings, or go in the spec-quality side-report?
- How does this interact with `anyOf` unions and nested discriminators?

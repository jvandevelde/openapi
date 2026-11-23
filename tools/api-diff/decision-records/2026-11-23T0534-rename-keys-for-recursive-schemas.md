# Rename keys for recursive schemas

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-23 05:34 UTC |
| **Summary** | Members of recursive schema groups get a separate, name-neutral rename key (references inside the group written as positions in an order found without names), which rename matching uses instead of the deep hash; deep hashes are unchanged. |
| **Milestone** | — (after M10) |

## Background

[Rename detection](2026-11-22T1631-rename-detection.md) matches a component that disappeared with one that appeared by their deep shape hash, then by their own content. A recursive schema's hashes include its own name. Its `$ref` to itself is written with the target's name, and the [deep hash](2026-11-21T0249-schema-index-with-tarjan.md) of a recursive group uses member names for references inside the group and in the group's unit. So renaming `TreeNode` (with `children: items: $ref TreeNode`) to `Node` was reported as two `ref-target-changed` findings, not as `component-renamed`. The same happened when every member of a cycle was renamed. A group where only one member was renamed was already matched by the own-content pass. A user asked for the fix, chose where the key lives, and chose to release it as 0.11.1.

## Alternatives considered

- **Make the deep hashes of recursive groups name-neutral.** Not chosen: skipping unchanged schemas, telling docs-only from real changes and the other checks that use deep hashes would change for recursive schemas.
- **Order a group's members by name.** Not possible: the names are what changes.
- **Guess an order for members identical apart from names.** Not chosen: a guessed rename could pair the wrong schemas, against the existing rule that ambiguous matches stay unmatched.

## Decision

- After the deep hashes, each recursive SCC (`#renameKeys` in `src/index/schema-index.ts`) gets, for each member, `renameKey = { local, deep }` in shape mode:
  1. Each member is hashed with every reference inside the group blanked out (in its local tree and its edge list); members are ordered by that hash.
  2. If two members have the same blanked hash, the group gets no keys.
  3. Otherwise each reference inside the group is written as `@<position>`, giving `local` and an own hash (edges outside the group use the target's deep shape hash, as before); the group's unit is the hash of `position=own` in order, and `deep = hash(own | unit)`.
- Rename matching (`#renames` in `src/diff/schema-engine.ts`) uses `renameKey.deep` and `renameKey.local` when present, else the deep and local shape hashes as before. Everything else, including the deep hashes, is unchanged.
- References from outside the group still use the target's name, so renaming a schema still changes its referrers' hashes. Those `$ref` changes are part of the rename, as for other renames.

## Impacts

- `src/index/schema-index.ts`, `src/diff/schema-engine.ts`; golden cases `component-renamed-recursive` (a schema that refers to itself), `component-renamed-recursive-cycle` (two schemas that refer to each other, both renamed) and `component-renamed-recursive-twins` (identical apart from names: no guessed rename).
- A known, separate gap: a renamed schema used as a `oneOf`/`anyOf` branch is also reported as one branch removed and one added (union branches are matched by `$ref` target), for recursive and other schemas alike.
- Docs: the `component-renamed` rule description and generated pages, PLAN.md section 4.

## References

- [Detect renames](2026-11-22T1631-rename-detection.md)
- [Schema index with Tarjan's SCCs for recursive schemas](2026-11-21T0249-schema-index-with-tarjan.md)
- PLAN.md section 4, *Reference graph, deep nesting and cycles*

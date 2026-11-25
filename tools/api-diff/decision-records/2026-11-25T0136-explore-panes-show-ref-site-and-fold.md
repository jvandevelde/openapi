# Explore panes show the $ref a side went through, and open on the whole enclosing schema, folded

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-25 01:36 UTC |
| **Summary** | When one side reaches a change through a `$ref` the other side doesn't (an inline schema became a `$ref`, or the reverse), the finding's location records that `$ref` as `via`, and its pane shows the schema both sides share, with the `$ref` line highlighted, above the component the change is in. Each pane opens on the whole enclosing schema or operation, with unchanged parts of more than 3 lines folded to one line (schemas of 40 lines or fewer are shown whole). The 9-line window and its "show all" toggle are gone. |
| **Milestone** | — (follow-up to M8) |
| **Supersedes** | [Explore: expand a finding's source to its enclosing schema, with a breadcrumb and $ref jumps](2026-11-23T2219-explore-expands-to-the-enclosing-schema.md) |

## Background

The user found the `explore` panes still hard to read in two cases ([feature proposal](../feature-backlog/explore-context-panes.md)):

- **An inline schema became a `$ref`.** `Order.shipping` was an inline object and became `$ref: Address`, and `zip.maxLength` dropped in the same commit. The base pane showed `Order` with `zip` highlighted; the revision pane showed only `Address`. Nothing on the revision side said that `Address` is what `Order.shipping` now points at. The schema walk lost the `$ref` site when it stepped through it on one side only.
- **Every finding: the 9-line window.** Too little to see the schema's other properties; "show all of `<name>`" was off by default, all or nothing, and had to be clicked on each side.

The user picked the options below from the proposal.

## Alternatives considered

For the `$ref`:

- **✅ Chosen: a second block.** The pane shows the shared schema (`Order`) with the `$ref` line highlighted, then the component (`Address`) as its own block with the change highlighted. Line numbers stay the file's.
- **Expand the component in place** under `shipping:`. The two sides look most alike, but line numbers stop being the file's, and a big component pushes the rest of `Order` down.
- **Both, with a toggle.** More to build and explain for little gain.

For the default view:

- **✅ Chosen: the whole enclosing schema, folded around the change.** Scales to large schemas: a 300-line schema reads as an outline.
- **The whole schema below a size limit, the window above it.** Simpler, but leaves the large schemas, the hard ones, as they were.
- **Keep the window.**

## Decision

1. **`via` on locations.** The schema walk keeps, per side, the `$ref`s it stepped through on that side only (`ref-extracted`: the revision; `ref-inlined`: the base). A change found inside carries them on that side's location as `via` (outermost first), in every report's JSON. When both sides go through a `$ref` (a pair of components), the list starts empty. A finding found again through another route keeps the first `via`. Finding IDs don't change (they don't include `via`).
2. **Snippets.** A snippet side with `via` gets a `via` entry per hop: its line, the `$ref` as written, its path and its enclosing scope (lines in `sourceLines`). `scopeIsNew` says the other version has no node at the snippet's scope (e.g. the component was added with the `$ref`); `ref.isNew` says the same for a `$ref`'s target. The root file on one side matches the root on the other, whatever their names.
3. **Pane layout.** A pane is a stack of blocks: one per `via` hop (its scope, the `$ref` line highlighted and tagged `↓ Address`), then the scope the change is in (headed `→ Address (new)`, or `(not in revision)` on the base side), then, when the changed node is a `$ref`, its target (headed `→ Address`). The breadcrumb runs through the blocks: `components › schemas › Order › properties › shipping ⇢ Address › properties › zip`; each step scrolls to its line, opening folds.
4. **Folding.** Blocks open on the whole scope (the enclosing component, Swagger 2 definition, operation, path item or file, narrowed to the outermost node that fits in 400 lines, as before; with no scope, the lines around the change). Fold ranges come from indentation, as editors fold. In a block over 40 lines, every node that spans more than 3 lines folds to `key: … N lines`, except the ancestors of the changed line and of other findings' lines, and the changed node's own children when it is 30 lines or shorter. A gutter arrow folds or opens any node; "show all lines" / "fold unchanged" in the pane header does it for the whole side. The fold state isn't remembered.
5. **Marks.** Lines other findings point at in the same file and side are marked in the gutter, with their messages as a tooltip.
6. **Links.** A change with `via` lists the `ref-extracted` / `ref-inlined` finding for that `$ref` under **via**; that finding lists the changes found inside it under **changes inside**. Each link opens and scrolls to the finding's row.
7. Unchanged from the superseded record: the path breadcrumb, scopes of at most 400 lines, the lines embedded once per file and side in `sourceLines`, and `explore` staying a diff view.

Not done (the proposal's other items): lining the two sides up row by row with synced scrolling, sticky ancestor lines, a schema-level view per group, the route from each operation to the change, and shorter file names in pane headers.

## Impacts

- `src/diff/schema-engine.ts` (`#via`, `#through`), `src/types.ts` (`Location.via`, `Snippet.via`, `scopeIsNew`, `ref.isNew`), `src/snippets.ts`, `src/render/explore.ts` (pane renderer, folding, links), `src/render/template.ts` (shapes), `schema/result-v0.schema.json` (all new fields optional; result schema version 0 still holds).
- Tests in `test/unit/explore.test.ts`.
- PLAN.md section 4 (*Rendering*), section 5 (`explore`), section 8; README.md (`--report explore`).

## References

- [Feature proposal: clearer context in the before/after panes](../feature-backlog/explore-context-panes.md)
- [Explore: expand a finding's source to its enclosing schema](2026-11-23T2219-explore-expands-to-the-enclosing-schema.md) (superseded)
- [The explore report is a diff view](2026-11-22T1647-explore-is-a-diff-view.md)

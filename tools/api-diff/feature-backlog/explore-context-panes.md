# Explore page: clearer context in the before/after panes

| | |
|---|---|
| **Status** | Idea |
| **Summary** | Make each finding's base and revision panes readable without hunting: when one side reaches the change through a `$ref` the other side doesn't (an inline schema extracted to a component, or the reverse), show the enclosing schema with the `$ref` line on that side and the component as a second block; open the whole enclosing schema by default with unchanged siblings folded instead of a 9-line window; and line the two sides up. |
| **Value / effort** | high / medium |
| **Plan entry** | [PLAN.md section 8, *Large specs and noise*](../PLAN.md#large-specs-and-noise) |

## The problem

[Expand to the enclosing schema](explore-expand-to-enclosing-schema.md) added a breadcrumb, a "show all of `<name>`" toggle and a one-hop `$ref` jump. Two kinds of finding are still hard to read.

**A property's inline schema became a `$ref` (or a `$ref` was inlined).** Example: `Order.shipping` was an inline object and becomes `$ref: '#/components/schemas/Address'`, and in the same commit `zip.maxLength` drops from 10 to 8. Today:

- The `max-length-decreased` finding's base pane shows `Order` with `zip` highlighted; its revision pane shows only `Address` with `zip` highlighted. Nothing on the revision side says that `Address` is what `Order.shipping` now points at. The two panes start from different schemas, so they don't look like the same place.
- The finding is filed under the `Address` group, while the `ref-extracted` finding ("inline schema replaced by `$ref` Address at /properties/shipping") is under `Order`. The page doesn't link them.
- The same happens for an inline `oneOf` moved to a component: the base shows `Order.payment.oneOf`, the revision only `Payment`.

This is because the schema walk drops the `$ref` site when it steps through one: in `#schemas` (`src/diff/schema-engine.ts`), `ref-extracted` continues with `{ node: rt, path: [] }`, so the revision location is relative to the target, and the place it was reached from is lost.

**Every finding, ref or not: the 9-line window.** The default view shows 4 lines either side of the changed line. That's often too little to see the schema's other properties or its `required` list, and too much to scan when the change is a one-liner. "Show all of `<name>`" helps but is off by default, all-or-nothing, and has to be clicked on both sides separately; the two sides then scroll independently with different line numbers.

## Proposal

### 1. Show the `$ref` site when the sides reach the change differently

The engine records, for each side, the `$ref`s it stepped through on that side but not on the other (`ref-extracted`, `ref-inlined`, `ref-target-changed`): a `via` list of locations on `Location`, outermost first. Symmetric hops (both sides go through `$ref Address`) aren't recorded; they look the same on both sides already.

On the page, a side with `via` shows:

- **The main block: the schema the sides have in common.** `Order` on both sides, the base with `zip` highlighted, the revision with `shipping: {$ref: '#/components/schemas/Address'}` highlighted and marked "now a `$ref`". The two panes now start from the same schema.
- **A second block below it: the component.** Headed "→ `Address` (new component)" (or "(existing component)" if the base already had it), with `zip` highlighted. One block per hop.

For the reverse (`ref-inlined`) the base side gets the second block. The breadcrumb shows the hop: `components › schemas › Order › properties › shipping ⇢ Address › properties › zip`.

The `ref-extracted` finding and the findings found inside the extracted schema refer to each other: the change shows "via: inline schema replaced by `$ref` Address" linking to it, and the `ref-extracted` entry lists "changes inside: maxLength decreased (10 → 8) at zip". (Grouping them as one logical change is what [Changesets](changesets.md) proposes; this only links them.)

*Alternative:* expand the `$ref` in place in the revision's `Order` (the `Address` lines indented and tinted under `shipping:`). It makes the two sides look most alike, but the line numbers stop being the file's, and a big component pushes the rest of `Order` far down. The second block is clearer; in-place expansion could be a toggle later.

### 2. Open the enclosing schema by default, folded

Instead of the line window, open each side on its enclosing schema or operation (the existing `scope`), folded around the change:

- The changed node's subtree and its ancestors' key lines are always open.
- Every other subtree that is more than a line or two is folded to one line: `▸ billing: … (14 lines)`; a click opens it. Short siblings (`id: {type: string}`) stay as they are, so a small schema shows whole.
- Lines of other findings in the same scope are marked in the gutter, so a reviewer sees "three things changed in `Order`".
- "Expand all" / "fold all" per finding, and the choice is remembered (like the group-by control).

A threshold (open whole below N lines, window above) is simpler but leaves the large schemas, which are the hard ones, as they are today. Folding scales: a 300-line schema reads as an outline of 20 lines. Fold ranges come from the same `endOffsetOf` offsets as scopes, so nothing new is parsed; they can be computed in the page from `path` and `sourceLines`, or sent as a per-scope outline in the result.

`SCOPE_MAX_LINES` (400) could rise once folding keeps big scopes short; the cost is page size, since `sourceLines` embeds every line of every scope a finding is in.

### 3. Line the two sides up

With both sides open on the same schema (item 1) and folded the same way (item 2), align them: matched nodes (the engine already pairs base and revision pointers) start on the same row, with blank filler rows where one side has lines the other doesn't, and the two panes scroll together. Within the changed line, highlight the changed token (`10` → `8`).

### Smaller things

- **Sticky ancestors.** When scrolling inside an open scope, keep the enclosing keys (`Order:`, `properties:`, `shipping:`) pinned at the top of the pane, as editors' sticky scroll does.
- **One view per schema group.** In "group by schema", a group's findings all show the same schema again and again. Offer a schema-level view in the group header: the schema once (folded, aligned) with every finding marked, clicking a marker opening its finding.
- **Reached from.** Show how an affected operation reaches the change: `GET /orders → 200 application/json → Order.shipping → Address.zip`. "Affects" lists the operations, but not the route, which is what tells a reviewer whether the field is in a request or response body, a parameter or a header.
- **Shorter file names in the pane headers.** The header shows the path as given (`../../../../tmp/…/rev.yaml`), which wraps over two lines; show the name relative to the repository (or the base name) with the full path in a tooltip.

## Bugs found while looking at this

- `union-branch-added` gives the revision a pointer that doesn't exist (`/components/schemas/Payment/oneOf/2/oneOf`): `#branchChanges` passes `[ch.bu.kind]` as the base keywords and `#emit` reuses them for the revision. The base side should get the keyword and the revision none, as `union-branch-removed` does.
- An inline branch is named by its index: "oneOf/anyOf branch added: 2" and the hint "Handle the new `2` variant of `Payment`". Better: "branch 3 (inline object)" or a summary of its properties (`{paypal}`).

## Open questions

- Is the second block enough, or is in-place `$ref` expansion wanted as well?
- How short is "short" for a sibling that stays unfolded (1 line? up to 3?).
- Should alignment be the default, or a toggle (it adds filler rows that can look odd for big moves)?
- Does a schema-level group view replace the per-finding panes in "group by schema", or sit next to them?

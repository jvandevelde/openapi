# The explore report is a diff view; spec browsing and payload generation stay in the spec explorer

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-22 16:47 UTC |
| **Summary** | `explore` shows findings and the changed spec fragments only and links into the separate spec explorer for everything else. Counter-example payloads aren't built in `api-diff` until we've decided whether to share generation logic with the explorer. |
| **Milestone** | M8 (explore), backlog (counter-examples) |

## Background

A spec explorer is being built separately. It works like Scalar's API reference or Swagger UI: it browses a spec as reference docs and can already generate example payloads from schemas.

Two parts of this plan overlap with it:

- **The `explore` report** (PLAN.md section 5) promised a "side-by-side spec view". Built out fully, that is a second spec browser.
- **★ Counter-example payloads** (PLAN.md section 8) need a value the old schema accepts and the new one rejects. That needs a payload generator, which the explorer already has.

Payload generation is hard in exactly the places this tool's design already worries about:

- **Recursive schemas.** `TreeNode.children: items: $ref TreeNode`, or `Shape: oneOf [Circle, Group]` with `Group.children` referring back to `Shape`. A generator has to stop by picking the branch that doesn't recurse, or an empty collection.
- **Large nested unions.** `oneOf`/`anyOf` with many branches, discriminators and nested `allOf` lead to an explosion of combinations. The generator has to pick one valid branch, and pick it deterministically.

Building this twice means two sets of bugs in the hardest part of either tool.

## Alternatives considered

### Scope of `explore`

- **✅ Chosen: a diff view that links out.** `explore` lists findings, filters and search, and shows only the changed fragment of each side, from the source maps (file, line, the YAML/JSON around the pointer). Every finding already carries JSON Pointers for both sides (see *Change record* in PLAN.md), so `explore` deep-links into the spec explorer at that operation or schema. The explorer can also read the result JSON to mark changed or breaking elements in its own views.
- **Rejected: full side-by-side spec rendering in `explore`.** It duplicates the explorer, and it's the largest part of M8.
- **Rejected: drop `explore` and put everything in the explorer.** The CI artifact must work offline as one file with no other service. The `review` comment links to it, and the history timeline reuses its finding panels.

### Counter-example payloads

- **Delegate entirely to the explorer.** `api-diff` records the schema pair and the pointers, and the explorer generates the payloads when someone looks. This is the least work here, but CI reports and `review` comments then carry no proof, and `explain` can't show one.
- **Share a generator.** One library builds a minimal valid payload for a schema, handling cycles and unions, and both tools use it. `api-diff` adds the part only it knows: the finding-specific change (e.g. put the removed enum value `archived` at `body.status`), then validates against both sides to confirm that old accepts and new rejects. This plays to both tools' strengths. It needs the two to agree on language, runtime and determinism.
- **Build it in `api-diff`.** The schema index already has the hard pieces: SCCs, productive-cycle checks, merged `allOf`, union branch matching. But a minimal-sample generator is still new work that the explorer has already done.

## Decision

1. **`explore` is a diff view.** It shows findings, filters, search and the changed source fragments, plus deep links into the spec explorer, configured as a URL template keyed by JSON Pointer (e.g. `explorer-url: https://…/#{pointer}`). It doesn't render the spec as reference docs.
2. **The result JSON is the integration point.** Pointers, rules and severities are already in it. The explorer reads that JSON. Neither tool imports the other's internals.
3. **No counter-example generator is built in `api-diff` yet.** Before it's scheduled, we compare the explorer's generator against these questions and pick one of the three options above:
   - Does it handle productive cycles and unions without blowing up, and does it pick the smallest branch that terminates?
   - Is its output deterministic? Same input must give the same bytes (see *Offline and deterministic* in PLAN.md section 8).
   - Can it be bundled into `api-diff.mjs` (TypeScript/ESM, no network, Node ≥ 22.18), or does it only run in the browser?
   - Does it accept OpenAPI 3.0, 3.1 and 3.2, or would it need `api-diff`'s normalise step first?
   - Where would a shared package live (`tools/` here, or the explorer's repo), and who owns it?

## Impacts

- PLAN.md: the `explore` row, the M8 row, the section 2 "diff views" row and the counter-example backlog row are updated. The counter-example question is added to section 7 as still open.
- M8 gets smaller: no spec rendering.
- `explore` and the history timeline HTML need an `explorer-url` report option (M8).
- The explorer gains a way to show "what changed" by reading the result JSON. That work is in the explorer, not here.
- `explain <finding-id>` shows a counter-example only once one of the options is chosen.

## References

- PLAN.md section 5 (*Who reads what*, *Spec browsing and payloads*), section 7, section 8 (*Evidence and accuracy*)
- PLAN.md section 4 (*Reference graph, deep nesting and cycles*, *Change record*)
- [Reports by audience as views over one result](2026-11-21T0258-reports-by-audience.md)
- [Schema index with Tarjan's SCCs for recursive schemas](2026-11-21T0249-schema-index-with-tarjan.md)

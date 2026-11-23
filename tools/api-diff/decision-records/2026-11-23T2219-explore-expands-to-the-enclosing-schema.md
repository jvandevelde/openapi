# The explore page can expand a finding's source to its enclosing schema, with a breadcrumb and $ref jumps

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-23 22:19 UTC |
| **Summary** | Each side of an `explore` finding shows its path from the document root as a breadcrumb, can expand from the 9-line window to the whole enclosing schema or operation (up to 400 lines), and jumps to a `$ref`'s target. The lines are embedded once per file and side, so the page still works offline. |
| **Milestone** | — (follow-up to M8) |

## Background

The `explore` page showed a fixed window of 4 lines either side of the changed line. Deep inside a schema, the window doesn't reach the schema's name. A reviewer reading `maxLength: 50` couldn't tell which schema or property it was in without opening the spec. The [decision that `explore` is a diff view](2026-11-22T1647-explore-is-a-diff-view.md) left everything beyond the changed fragment to the separate spec explorer, through `explorer-url` links. Those links need an explorer deployment, and the CI artifact has to work offline as one file.

The user asked for a way to see more of each side, mainly the top of the schema a finding is in.

## Alternatives considered

- **✅ Chosen: a breadcrumb, an expand toggle up to the enclosing schema or operation, and `$ref` jumps.** This answers "which schema is this?" without expanding anything, and the toggle shows the full context when needed. Only the lines of scopes that findings are in are embedded, once per file.
- **Expand only, no breadcrumb.** You still have to expand to learn the schema's name.
- **A configurable window size (e.g. `snippet-context: 15`).** The least work, but a long schema still hides its name, and larger windows repeat the same lines for every finding in a schema.
- **Embed the whole spec and render it.** That's the spec browser the earlier decision rejected, and it would make the page as big as the spec.

## Decision

1. Each snippet side gains:
   - `path`: the pointer's steps from the document root, each with its line.
   - `scope`: the enclosing component (`/components/<type>/<name>`), Swagger 2 definition, operation or webhook (`/paths/<path>/<method>`), or path item. A node in a file of its own uses the whole file. If the scope is longer than 400 lines (`SCOPE_MAX_LINES`), it narrows to the outermost node on the path that fits; if none fits, there is no scope.
   - `ref`: when the node is a `$ref` (or the pointer ends at a `$ref` key), the node it points at, one hop, with the same 400-line limit.
2. A node's range runs from its line to the line before whatever follows it: its next sibling, or the next sibling of its nearest ancestor that has one (`PositionIndex.endOffsetOf`). Trailing blank lines are dropped. This uses the offsets the parser already records, so the parse cache is unchanged.
3. The lines that scopes and targets cover go into the result's new `sourceLines` (by side, file and line number), stored once however many findings share them. Lines are cut at 300 characters, as in the window. Both fields appear only with snippets (when `explore` is requested).
4. On the page, each side shows the breadcrumb. A step inside the window or scope jumps to its line, expanding if needed; steps outside are shown with their line number as a tooltip. A "show all of `<name>` (N lines)" toggle switches between the window and the scope, naming operations as `GET /pets`. A `→ <$ref>` step shows the target and switches back with "← back". The source box scrolls within itself, up to 70% of the window height.
5. `explore` stays a diff view: it shows only the scopes that findings are in, never the whole spec, and `explorer-url` links are still how you browse further.

## Impacts

- `src/snippets.ts` (new; moved out of `src/engine.ts`), `src/load/positions.ts` (`endOffsetOf`, `lineColAt`), `src/render/explore.ts`, `src/types.ts`, `src/render/template.ts` (shapes), `schema/result-v0.schema.json` (`snippet.path`, `snippet.scope`, `snippet.ref`, `sourceLines`; all optional, so result schema version 0 still holds).
- The explore HTML grows by the lines of the scopes that findings are in, at most 400 per scope per side.
- PLAN.md section 4 (*Rendering*) and section 5 (`explore`) mention the expandable scope.

## References

- [The explore report is a diff view](2026-11-22T1647-explore-is-a-diff-view.md)
- [Feature proposal: expand explore snippets to the enclosing schema](../feature-backlog/explore-expand-to-enclosing-schema.md)
- PLAN.md section 4 (*Reference graph, deep nesting and cycles*), section 5 (*Who reads what*), section 8 (*Large specs and noise*)

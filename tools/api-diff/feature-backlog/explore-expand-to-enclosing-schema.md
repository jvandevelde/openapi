# Explore page: expand a finding's source to its enclosing schema

| | |
|---|---|
| **Status** | Built (see the [decision record](../decision-records/2026-11-23T2219-explore-expands-to-the-enclosing-schema.md)) |
| **Summary** | Each side of an `explore` finding shows a breadcrumb from the document root, can expand from the 9-line window to the whole enclosing schema or operation, and jumps to a `$ref`'s target, so a reviewer can see which schema a deep change is in without opening the spec. |
| **Value / effort** | high / low |
| **Plan entry** | [PLAN.md section 8, *Large specs and noise*](../PLAN.md#large-specs-and-noise) |

## What it does

The `explore` page showed 4 lines either side of the changed line. For a change deep inside a schema (`components › schemas › Order › properties › name › maxLength`), the schema's name was out of view, and the rest of the file wasn't in the page.

Each side of a finding now has:

- **A breadcrumb**: the pointer's steps, e.g. `components › schemas › Order › properties › name › maxLength`. Clicking a step jumps to its line, expanding if needed.
- **An expand toggle**: "show all of Order (36 lines)" shows the whole enclosing component, operation (`GET /pets`) or path item, with the changed line highlighted; "show less" goes back to the window.
- **A `$ref` jump**: when the changed node is a `$ref`, `→ #/components/schemas/Other` shows the target; "← back" returns.

## Choices

- **Scope**: the enclosing component, Swagger 2 definition, operation or webhook, or path item; a whole file for a node in a file of its own. Over 400 lines, it narrows to the outermost node on the path that fits.
- **Size**: the lines are stored once per file and side in the result's `sourceLines`, not per finding, so many findings in one schema cost one copy.
- **Ranges** come from the parser's existing offsets (a node ends where the next sibling of it or of its nearest ancestor begins), so the parse cache didn't change.
- `explore` is still a diff view: the page holds only the scopes findings are in, and `explorer-url` links remain the way to browse the rest of the spec.

## Not done

- Following a `$ref` more than one hop, or following references inside an expanded scope.
- Base and revision scopes scrolled in step.

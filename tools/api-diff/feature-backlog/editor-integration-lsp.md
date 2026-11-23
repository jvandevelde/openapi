# Editor integration (LSP)

| | |
|---|---|
| **Status** | Idea |
| **Summary** | Run the engine as a language server so breaking changes show up in the editor before a PR exists. |
| **Value / effort** | high / medium |
| **Plan entry** | [PLAN.md section 8, *Developer experience*](../PLAN.md#developer-experience) |

Moved from the PLAN.md backlog table on 2026-11-23, unchanged apart from links. It hasn't been worked out in more detail yet; add background, options and open questions here when it is.

## What it does

Run the engine as a language server against `main`, so breaking changes show up as editor warnings while the spec is edited, before a PR exists. The engine is pure functions, so this is mostly a wrapper.

## Open questions

- None recorded yet.

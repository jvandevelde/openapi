# Memory-lean index

| | |
|---|---|
| **Status** | Idea |
| **Summary** | Intern strings and store graph edges in typed arrays so 50 MB+ specs fit in small CI runners. |
| **Value / effort** | medium / medium |
| **Plan entry** | [PLAN.md section 8, *Enterprise operation*](../PLAN.md#enterprise-operation) |

Moved from the PLAN.md backlog table on 2026-11-23, unchanged apart from links. It hasn't been worked out in more detail yet; add background, options and open questions here when it is.

## What it does

Intern strings and store graph edges in typed arrays, so very large specs (50 MB+) fit in CI runners with little memory.

## Open questions

- None recorded yet.

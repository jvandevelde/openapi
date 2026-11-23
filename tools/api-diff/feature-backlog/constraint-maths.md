# Constraint maths

| | |
|---|---|
| **Status** | Idea |
| **Summary** | Compare numeric, length and item-count constraints as intervals, and simple `pattern`s as automata, so narrowed vs widened is exact. |
| **Value / effort** | medium / medium |
| **Plan entry** | [PLAN.md section 8, *Evidence and accuracy*](../PLAN.md#evidence-and-accuracy) |

Moved from the PLAN.md backlog table on 2026-11-23, unchanged apart from links. It hasn't been worked out in more detail yet; add background, options and open questions here when it is.

## What it does

Treat `minimum`/`maximum`/`multipleOf`, `minLength`/`maxLength` and `minItems`/`maxItems` as intervals, so "narrowed" vs "widened" is exact. Compare simple `pattern` regexes by converting them to automata, and fall back to "can't tell" (`warn`) for complex ones.

## Open questions

- None recorded yet.

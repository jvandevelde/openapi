# Rule plugins

| | |
|---|---|
| **Status** | Idea |
| **Summary** | Custom TypeScript rules against the change-record API, tested with the golden-case format. |
| **Value / effort** | high / medium |
| **Plan entry** | [PLAN.md section 8, *Developer experience*](../PLAN.md#developer-experience) |

Moved from the PLAN.md backlog table on 2026-11-23, unchanged apart from links. It hasn't been worked out in more detail yet; add background, options and open questions here when it is.

## What it does

Custom rules written in TypeScript against the change-record API, tested with the same `base/revision/expected` corpus format as the built-in rules. Covers house rules such as "every list operation must keep its pagination parameters".

## Related

- [Lint only what changed](lint-only-what-changed.md) builds on this.

## Open questions

- None recorded yet.

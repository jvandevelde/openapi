# Lint only what changed

| | |
|---|---|
| **Status** | Idea |
| **Summary** | Let plugin rules declare `scope: changed` so house rules apply only to new and changed parts. |
| **Value / effort** | high / low |
| **Plan entry** | [PLAN.md section 8, *Developer experience*](../PLAN.md#developer-experience) |

Moved from the PLAN.md backlog table on 2026-11-23, unchanged apart from links. It hasn't been worked out in more detail yet; add background, options and open questions here when it is.

## What it does

Rule plugins can declare `scope: changed`, so house rules apply only to new and changed parts and legacy parts don't block a PR.

## Related

- Depends on [rule plugins](rule-plugins.md).

## Open questions

- None recorded yet.

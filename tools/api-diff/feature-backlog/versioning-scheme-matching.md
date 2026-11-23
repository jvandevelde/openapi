# Versioning-scheme aware matching

| | |
|---|---|
| **Status** | Idea |
| **Summary** | Match `/v1/…` with `/v2/…`, or versioned media types, when a new API version is published alongside the old one. |
| **Value / effort** | medium / low |
| **Plan entry** | [PLAN.md section 8, *Evidence and accuracy*](../PLAN.md#evidence-and-accuracy) |

Moved from the PLAN.md backlog table on 2026-11-23, unchanged apart from links. It hasn't been worked out in more detail yet; add background, options and open questions here when it is.

## What it does

Match `/v1/orders` in the base with `/v2/orders` in the revision, or match media-type versions (`application/vnd.acme.v2+json`), when a new version is published alongside the old one. Configured with a path or media-type template.

## Open questions

- None recorded yet.

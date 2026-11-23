# Portfolio mode

| | |
|---|---|
| **Status** | Idea |
| **Summary** | Compare many specs in one run and report which APIs a change to a shared schema file affects. |
| **Value / effort** | high / high |
| **Plan entry** | [PLAN.md section 8, *Large specs and noise*](../PLAN.md#large-specs-and-noise) |

Moved from the PLAN.md backlog table on 2026-11-23, unchanged apart from links. It hasn't been worked out in more detail yet; add background, options and open questions here when it is.

## What it does

Compare many specs in one run, including shared schema files (`common/errors.yaml`) that several APIs reference. A change to a shared file reports **which APIs** it affects. This needs external file `$ref`s, which are out of scope for now.

## Related

- Needs external file `$ref`s, which are out of scope for now (PLAN.md section 6).
- Org-wide layering in [overlays and a review loop](overlays-and-review-loop.md) section 6 leads towards it.

## Open questions

- None recorded yet.

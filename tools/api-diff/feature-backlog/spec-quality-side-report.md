# Spec quality side-report

| | |
|---|---|
| **Status** | Idea |
| **Summary** | List identical inline schemas found by the content hashes ("appears inline 42 times; consider a component"). |
| **Value / effort** | medium / low |
| **Plan entry** | [PLAN.md section 8, *Large specs and noise*](../PLAN.md#large-specs-and-noise) |

Moved from the PLAN.md backlog table on 2026-11-23, unchanged apart from links. It hasn't been worked out in more detail yet; add background, options and open questions here when it is.

## What it does

The hashes already find identical inline schemas, so list them ("this object appears inline 42 times; consider a component"). They're the root cause of the bulk changes above.

## Related

- These duplicates are the root cause of the changes [bulk-change collapsing](bulk-change-collapsing.md) groups.

## Open questions

- None recorded yet.

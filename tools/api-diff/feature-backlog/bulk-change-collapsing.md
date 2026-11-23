# Bulk-change collapsing

| | |
|---|---|
| **Status** | Built |
| **Summary** | Group the same change made in many places without a shared `$ref` into one "N operations" finding. |
| **Value / effort** | high / low |
| **Plan entry** | [PLAN.md section 8, *Large specs and noise*](../PLAN.md#large-specs-and-noise) |

Moved from the PLAN.md backlog table on 2026-11-23, unchanged apart from links. It hasn't been worked out in more detail yet; add background, options and open questions here when it is.

Marked **★** in PLAN.md: one of the ideas to do first.

## What it does

The same change made in many places without a shared `$ref` (e.g. a new `X-Request-Id` header added inline to 300 operations) is grouped into **one** finding: "header added to 300 operations (list)". Detected by grouping change records by kind and normalised value. This extends root-cause grouping to copy-pasted specs.

## Related

- Built in M5 (3+ operations): see [Schema engine: one finding per direction, effective schemas, bulk collapsing](../decision-records/2026-11-21T1539-schema-engine.md).

## Open questions

- None recorded yet.

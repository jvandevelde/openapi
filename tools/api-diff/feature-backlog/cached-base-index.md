# Cached base index

| | |
|---|---|
| **Status** | Built |
| **Summary** | Cache the parsed base by content hash so CI only parses the revision. |
| **Value / effort** | high / low |
| **Plan entry** | [PLAN.md section 8, *Large specs and noise*](../PLAN.md#large-specs-and-noise) |

Moved from the PLAN.md backlog table on 2026-11-23, unchanged apart from links. It hasn't been worked out in more detail yet; add background, options and open questions here when it is.

Marked **★** in PLAN.md: one of the ideas to do first.

## What it does

Store the parsed base's index and hashes in a content-addressed cache, keyed by the file's SHA-256. In CI the base (main) is usually unchanged between runs, so only the revision is parsed.

## Related

- Built in M7 as opt-in `--cache-dir`: see [The PR check reports changes and doesn't fail by default](../decision-records/2026-11-22T0653-report-not-gate.md) (*Also asked*).

## Open questions

- None recorded yet.

# History timeline from consecutive comparisons

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 04:00 UTC |
| **Summary** | `api-diff history <start>..<end> <spec>` compares each consecutive version of the spec in the range and links findings across steps. |
| **Milestone** | M8 |

## Background

Users want to see when each change landed, not just the net difference between two commits.

## Alternatives considered

- **Net diff only**: Hides when and where changes happened, and reverted changes.
- **Every commit, including branch commits**: Cluttered; available with `--all-commits`.

## Decision

First-parent commits that touched the spec or its `$ref` files, skipped when the files' blob fingerprint didn't change; each version parsed once and cached by blob SHA; a separate net start → end comparison; revert detection through stable finding IDs. Text, JSON and HTML (timeline strip, step panel, element history) output.

## Impacts

- About N+1 parses for N steps; `--max-steps` and `--tags-only` bound large ranges.

## References

- PLAN.md section 5, *Timeline (history mode)*

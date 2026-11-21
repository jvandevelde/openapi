# Record the compared versions in every report

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 03:03 UTC |
| **Summary** | Every report records the versions it compared, from `info.version` by default or from configured vendor extensions. |
| **Milestone** | M6 |

## Background

Reports must show exactly what they cover, and some teams keep versions in their own extensions.

## Alternatives considered

- **`info.version` only**: Doesn't fit teams using `x-` extensions.

## Decision

`versions.primary.from` is an ordered list of sources (extension, `info.<field>` or JSON Pointer); extra `labels` are recorded too. CLI options take precedence. File hashes, tool version and policy hash are recorded for reproducibility.

## Impacts

- A missing version shows `unknown` and skips the semver advice.

## References

- PLAN.md section 5, *Versions compared*
- POLICY.md section 9

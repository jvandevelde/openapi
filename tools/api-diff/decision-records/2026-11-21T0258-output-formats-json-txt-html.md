# Output formats: JSON, text and HTML only

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 02:58 UTC |
| **Summary** | Support only `json`, `txt` and `html` output. |
| **Milestone** | M3, M7 |

## Background

Each output format is code to maintain. The user asked for JSON, text and HTML.

## Alternatives considered

- **Also Markdown, SARIF, JUnit, GitHub annotations, CSV**: More integrations, more maintenance.

## Decision

Three formats. JSON (with a versioned schema) is the stable interface; any other format can be built from it outside the tool.

## Impacts

- PR comments are plain text in a code block plus a link to the HTML report.
- No built-in inline annotations or code scanning upload.

## References

- PLAN.md section 5, *Output formats*

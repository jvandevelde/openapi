# Read git revisions in the tool through document sources

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 03:52 UTC |
| **Summary** | Support `rev:path` inputs inside the tool, but keep git out of the engine behind a document-source interface. |
| **Milestone** | M2 |

## Background

Users want to compare a file at two revisions. A helper script that writes temp files breaks multi-file `$ref`s and puts temp paths in reports.

## Alternatives considered

- **Helper script around the tool**: Breaks `$ref`s, wrong file names in reports, each team rewrites it.
- **JavaScript git library**: Extra dependency, and misses repository layouts the git binary handles.

## Decision

The engine reads through `read(path)`. The CLI picks a filesystem or git source per side. The git source runs `git cat-file --batch` via `execFile`, resolves `$ref`s at the same revision, supports merge-base (`main...`), detects shallow clones and runs in the repository that contains the spec.

## Impacts

- Works from any repository, not only this one.
- History mode reuses the git source.

## References

- PLAN.md section 4, *Inputs: files and git revisions*

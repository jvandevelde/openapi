# Command-line syntax for files and git revisions

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 04:36 UTC |
| **Summary** | Inputs are files or `rev:path`; `--base <rev>` and `--revision <rev>` take one shared path; `<rev>...` means the merge-base. |
| **Milestone** | M2 |

## Background

PLAN.md sketched `--base-rev`/`--revision-rev` flags and `--base main...`. Building the inputs needed one consistent syntax that covers files, revisions, the staged version and merge-bases, and that never misreads a file name.

## Alternatives considered

- **`--base-rev` / `--revision-rev`**: longer, and `--base` would be free for nothing else.
- **Only `rev:path` positionals**: works, but repeats the path in the common "this file on main vs now" case.

## Decision

- Positionals: `api-diff <base> <revision>`, each a file or git's `rev:path`. `:path` is the staged version. `rev...:path` is the merge-base of `rev` and the other side (`HEAD` when the other side is a file).
- `--base <rev>` and `--revision <rev>` with exactly one path: `api-diff --base main... openapi.yaml`.
- An argument is a revision only if no file with that exact name exists and it isn't a Windows drive path. Revisions starting with `-` are rejected.
- Paths are relative to the current directory (like `git show rev:./path`), and git runs in the repository containing the file, so each side can come from a different repository.
- Exit codes: 0, 1 (findings at or above `--fail-on`), 2 (usage or input errors).

## Impacts

- PLAN.md's `--base-rev`/`--revision-rev` are replaced by `--base`/`--revision`.
- Shallow clones get an error that explains how to fetch the base commit.

## References

- `src/sources/input.ts`, `src/sources/git.ts`, `src/cli/main.ts`, `test/unit/git.test.ts`
- [Read git revisions in the tool through document sources](2026-11-21T0352-git-revision-inputs.md)

# Release-to-release timelines: tag globs, tags on any commit, and the untagged end

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-23 04:37 UTC |
| **Summary** | `history --tags-only[=<glob>]` makes a step of every commit in the range with a matching tag (git-style glob), whether or not it changed the spec, then of the range's end when the spec changed after the last matching tag (`--no-end` leaves it out). |
| **Milestone** | — (after M10) |

## Background

The [history timeline](2026-11-21T0400-history-timeline.md)'s `--tags-only` filtered the commits that changed the spec down to those with any tag, plus the end of the range. A user asked for a tag pattern, and for the end of the range (e.g. `HEAD`) as a step even when it isn't tagged. Testing found a bug as well: a release tagged on a commit that didn't change the spec (a release-notes or version-bump commit, which is common) was dropped, and its changes were folded into a later step. The end of the range also showed only if that commit itself changed the spec. The proposal is [Release-to-release timelines: tag globs and the unreleased end](../feature-backlog/release-timeline-tag-globs.md). Each choice below was asked about.

## Alternatives considered

- **`--tags <glob>` and `--exclude-tags <glob>`**, repeatable. Not chosen; one option with an optional glob was chosen.
- **A regular expression.** Not chosen: a different syntax from git's.
- **The end of the range only with a flag.** Not chosen; it's included by default and `--no-end` leaves it out.
- **No step for a release without API changes.** Not chosen; every matching release is a step.

## Decision

- **`--tags-only`** (no value) means any tag; **`--tags-only=<glob>`** keeps tags matching a git-style glob: `*` any text (including `/`), `?` one character, `[…]` a class, `[!…]` its complement, everything else literal, matched against the whole tag name. The value must be given with `=`. An empty pattern is a usage error.
- **Steps:** every commit in `<start>..<end>` (all commits, not only first-parent ones, so a tag on a merged branch's commit counts) with a matching tag, oldest first, is a step, compared with the previous step (or `<start>`). This holds whether or not the commit changed the spec. A tagged commit where the spec can't be read is skipped. A step without API changes reads "no API changes" in text and HTML. A step's `tags` lists only its matching tags.
- **The end of the range** is a last step when it isn't a matching tag and its spec differs from the last step's (by the fingerprint of every file in the `$ref` closure). It's marked `end: "<rev>"` in JSON, `── HEAD (end of range, no matching tag) ──` in text, and a marker in the HTML strip and step card. **`--no-end`** (only with `--tags-only`) leaves it out.
- **Unchanged:** the default commit timeline, `--max-steps` (applied after), the net result, revert links, and `--all-commits` (which doesn't change tag mode).

## Impacts

- `src/history.ts` (`tagsOnly` takes a glob, `noEnd`, `Step.end`, `tagGlob`), `src/render/timeline.ts`, `src/cli/main.ts`; tests in `test/unit/history-tags.test.ts`.
- A `--tags-only` timeline can now have more steps (tagged commits that didn't change the spec) and a final untagged step.
- Docs: README, `docs/getting-started.md`, `docs/workflows.md`, PLAN.md section 5; the proposal and a PLAN.md section 8 entry.

## References

- [History timeline from consecutive comparisons](2026-11-21T0400-history-timeline.md)
- [Timeline: findings per step, and one line per change in requests and responses](2026-11-23T0410-timeline-per-step-findings-and-directions.md)
- [Feature proposal](../feature-backlog/release-timeline-tag-globs.md)

# Versions from git tags, and only the configured sources

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-23 04:52 UTC |
| **Summary** | A `git-tag[:<glob>]` version source reads a matching tag on the compared commit (the tag name as is, the highest semver one if several); and only the configured sources count, so with none present the version is `unknown`, with a notice, instead of a silent `info.version`. |
| **Milestone** | — (after M10) |

## Background

[Versions are recorded](2026-11-21T0303-record-compared-versions.md) from the sources in `versions.primary.from`, first present wins. Testing a policy with `from: [x-api-version]` on a spec without that extension showed a bug. The engine fills in `info.version` before the policy's sources are read, and keeps it when none is found. So `version-unchanged` compared `info.version` values the team had chosen not to use, with no source shown. PLAN.md section 5 says the version should then be `unknown`, with the advice skipped and a notice.

A user also asked how to set versions without `info.version`. The existing sources and `--base-version` cover the diff command. Teams that version by git tag, though, got no versions in `history` timelines, which have no version options. The proposal is [Versions from git tags](../feature-backlog/versions-from-git-tags.md). Each choice below was asked about.

## Alternatives considered

- **Document the fallback** (`info.version` always last). Not chosen; the fix matches the documented behaviour.
- **A separate `versions.primary.tag` key** that beats the list. Not chosen; `git-tag` is a source in the list.
- **The nearest reachable tag** (`git describe`). Not chosen; only a tag on the commit counts.
- **Strip the glob's fixed prefix from the tag.** Not chosen; the tag name is the version as is.

## Decision

- **Only configured sources count.** `recordVersions` starts each side at `unknown` (or the CLI value) and takes the first configured source present. `versionSource` is set only when a source was used. The default `versions` is still `[info.version]`.
- **Missing versions:** when a side's version is `unknown`, there are API changes, and either version check is on, a `not-compared` notice says `version checks (no version for the base[ and revision]; tried <sources>)`. With both schemes `none`, no notice.
- **`git-tag` / `git-tag:<glob>`** is valid in `versions.primary.from` and in `versions.labels`. It reads the tags pointing at the side's commit (`git tag --points-at`), through a new optional `tagsAt()` on document sources, which `GitSource` implements, so git stays out of the engine. The engine asks only when the policy uses a `git-tag` source. The glob is the same git-style glob as `history --tags-only=<glob>` (moved to `src/sources/git.ts`). With several matching tags, the highest semver one wins; tags that aren't semver come after, by name. A side with no tagged commit (an untagged commit, the index, the working tree, an in-memory source) uses the next source.
- **History** needs no change: each step's comparison is between git inputs, so tag versions apply per step.

## Impacts

- `src/diff/versions.ts` (`git-tag` sources, `tagVersion`, `usesGitTags`, `unknown` and the notice), `src/engine.ts`, `src/sources/source.ts` (`tagsAt`), `src/sources/git.ts` (`tagsAt`, `tagGlob`), `src/history.ts` (re-exports `tagGlob`); tests in `test/unit/versions.test.ts` and `test/unit/history-tags.test.ts`.
- **Behaviour change:** a policy whose sources are all missing used to fall back to `info.version` silently. It now reports `unknown` with a notice, and no version checks run. Policies that relied on the fallback should list `info.version` last.
- Docs: POLICY.md section 9, PLAN.md section 5 (*Versions compared*), README; the proposal and a PLAN.md section 8 entry.

## References

- [Record the compared versions in every report](2026-11-21T0303-record-compared-versions.md)
- [Version checks](2026-11-21T2317-version-checks.md)
- [Release-to-release timelines: tag globs, tags on any commit, and the untagged end](2026-11-23T0437-release-timeline-tag-globs.md)
- [Read git revisions in the tool through document sources](2026-11-21T0352-git-revision-inputs.md)
- [Feature proposal](../feature-backlog/versions-from-git-tags.md)

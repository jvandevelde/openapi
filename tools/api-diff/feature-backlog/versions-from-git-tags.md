# Versions from git tags

| | |
|---|---|
| **Status** | Built (see the [decision record](../decision-records/2026-11-23T0452-versions-from-git-tags.md)) |
| **Summary** | A `git-tag` / `git-tag:<glob>` version source reads the version from the release tag on the compared commit, for teams that version by tag rather than in the spec; it works in `history` timelines too. |
| **Value / effort** | high / low |
| **Plan entry** | [PLAN.md section 8, *Ownership and governance*](../PLAN.md#ownership-and-governance) |

## What it does

Version checks (`version-unchanged`, `version-bump-too-small`, the bump advice) need a version for each side. Until now it came from the spec (`info.version`, an `x-` extension or a JSON Pointer) or from `--base-version` / `--revision-version`. Teams that version by git tag, and don't keep `info.version` up to date, had to pass versions from CI, and got no versions at all in `api-diff history`, which has no such options.

`git-tag` (any tag) or `git-tag:<glob>` in `versions.primary.from` (or as a label) reads the tag on the compared commit:

```yaml
versions:
  primary:
    from: ["git-tag:v[0-9]*", info.version]   # the release tag, else the spec's own version
```

- Only a tag **on that commit** counts. An untagged commit, the working tree or a non-git input uses the next source, or `unknown`, so unreleased work isn't checked against the last release's version.
- The tag name is the version **as is**. `v1.2.0` parses as semver; a prefixed tag like `orders-api-v1.2.0` doesn't, so bump checks are skipped for it.
- With several matching tags on one commit, the highest semver one wins.
- In `history`, every step is a git input, so each step is versioned by its tag. With `--tags-only`, the timeline goes from release version to release version.

## Options considered

- **A separate key** (`versions.primary.tag`) that always beats the `from` list. Not chosen: one ordered list is simpler, and lets the spec's version be the fallback.
- **The nearest tag** (`git describe`). Not chosen: unreleased work would show the last release's version, so `version-unchanged` would fire until it's tagged.
- **Strip the glob's fixed prefix** (`orders-api-v1.2.0` → `1.2.0`). Not chosen: the tag name is used as is.

## Open questions

- Monorepos with per-API prefixed tags (`orders-api-v1.2.0`) get versions but no semver checks. Should prefix stripping be offered as an option later?

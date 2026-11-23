# Release-to-release timelines: tag globs and the unreleased end

| | |
|---|---|
| **Status** | Built (see the [decision record](../decision-records/2026-11-23T0437-release-timeline-tag-globs.md)) |
| **Summary** | `api-diff history --tags-only=<glob>` keeps only tags matching a git-style glob; every matching release is a step, even one tagged on a commit that didn't change the spec; the end of the range (e.g. `HEAD`) is a last step when the spec changed after the last release. |
| **Value / effort** | high / low |
| **Plan entry** | [PLAN.md section 8, *Ownership and governance*](../PLAN.md#ownership-and-governance) |

## What it does

A release-to-release timeline is what release managers and governance reviews ask for: "what changed in each release, and what's waiting to ship". `--tags-only` was meant to give it, but had three gaps:

1. **Any tag counted.** Repositories with pre-release, build or other tool tags (`v1.2.0-rc.1`, `deploy-2026-09-12`, another tool's `api-diff-v0.10.1`) had no way to keep just the releases.
2. **Releases tagged on a commit that didn't change the spec were dropped.** Only commits that changed the spec were considered, and release tags often sit on a "release notes" or version-bump commit. Their changes were folded into a later step.
3. **Unreleased changes after the last tag** appeared only if the end commit itself changed the spec.

Now:

- `--tags-only` alone: every tag; `--tags-only=<glob>`: tags matching a git-style glob (`*` any text, `?` one character, `[…]` and `[!…]` classes), e.g. `--tags-only='v[0-9]*'`.
- Each commit in the range with a matching tag is a step, whether or not it changed the spec. A release without API changes says "no API changes", so the timeline lists every release.
- The end of the range is a last step, marked "end of range, no matching tag", when the spec changed after the last matching tag. `--no-end` leaves it out.

```
$ api-diff history v1.0.0..HEAD openapi.yaml --tags-only='v*'
2026-09-08  b60ebde  Release notes for 1.1.0  1.0.0 → 1.1.0
            WARN   …
── tag v1.1.0 ──────────────────────────────────────────────────────
2026-09-10  c41d2e7  Patch release, no API change
            no API changes
── tag v1.1.1 ──────────────────────────────────────────────────────
2026-09-20  aec8418  Add d (#3)
            WARN   …
── HEAD (end of range, no matching tag) ──────────────────────────────
```

## Options considered

- **`--tags <glob>` plus `--exclude-tags <glob>`** (repeatable, as in `git describe --match/--exclude`). Not chosen: one option, `--tags-only=<glob>`, was preferred. Dropping pre-releases needs a pattern that can't match them (`v[0-9].[0-9].[0-9]`), since `*` matches any text.
- **A regular expression.** Not chosen: a different syntax from git's own tag matching.
- **The end of the range only with a flag.** Not chosen: it's included when the spec changed, and `--no-end` leaves it out.
- **Skip releases without API changes.** Not chosen: every release gets a step.

## Open questions

- Should an exclude pattern be added later, if pre-release tags that can't be ruled out with one glob turn out to be common?

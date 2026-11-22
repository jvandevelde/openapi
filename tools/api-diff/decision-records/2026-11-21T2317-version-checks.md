# Version checks: needed bump per finding, 0.x shifted down, notices excluded

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 23:17 UTC |
| **Summary** | Under semver, an `error` finding needs a major bump, other `wire`/`sdk` findings a minor bump and `docs` findings a patch bump, one level lower below 1.0.0; notices never count; `calver` only checks that the version changed. |
| **Milestone** | M6 |

## Background

POLICY.md section 9 defines where versions come from, and RULES.md section 9 has `version-unchanged` and `version-bump-too-small` with a `scheme` option (`semver`, `calver`, `none`). Building them (M6 step 7) needed a mapping from findings to the bump they need and a rule for 0.x (both asked and answered on 2026-11-21), plus smaller calls made while building, listed for review.

## Alternatives considered

### Bump each finding needs (asked)

- **✅ Chosen: `error` → major, any other `wire` or `sdk` finding → minor, `docs`-only → patch.** Follows semver's meaning: breaking, new or changed API surface, fixes and docs.
- **Rejected: `error` → major, everything else → minor.** Docs-only releases would need minor bumps.
- **Rejected: only check major.** Missed minor bumps would never be reported.

### 0.x versions (asked)

- **✅ Chosen: one level lower while the base version is below 1.0.0.** Semver rule 4 allows anything in 0.x; the common convention is breaking → minor, everything else → patch.
- **Rejected: same rules as 1.x+**, or **not checking 0.x** at all.

### Decided while building (for review)

- **Notices don't count as changes:** `spec-invalid`, `ref-unresolved`, `not-compared`, `cycle-not-productive`, `documents-unrelated` (and the version rules themselves).
- **Final severities are used:** findings turned `off` or below `min-severity` don't count; a policy that lowers a removal to `warn` makes it need only a minor bump. (Acknowledgements, in step 8, won't change this: an acknowledged breaking change is still breaking.)
- **`calver`** checks only `version-unchanged`; calendar versions say nothing about compatibility.
- **`scheme` lives on both rules;** `none` on either turns both off, otherwise `version-bump-too-small`'s value wins, then `version-unchanged`'s.
- **A version that isn't semver** under `semver` gives one `not-compared` notice (info) instead of a guess or an error.
- **A lower revision version** counts as no bump.
- **Pre-release and build suffixes** (`2.0.0-rc.1`) are ignored when working out the bump.
- **Golden test cases opt in** with `check-versions: true`; otherwise `version-unchanged` would appear in almost every case, since they change specs without bumping versions.

## Decision

As chosen above. Versions and labels are recorded on each side of the result (`version`, `versionSource`, `labels`); `commit` is a label for git inputs.

## Impacts

- `src/diff/versions.ts`; engine runs the checks after classifying, then classifies their findings with the same policy.
- `--base-version`, `--revision-version`, `--base-label`, `--revision-label`; result schema gains `versionSource` and `labels` (v0, additive); the text report shows labels.
- Most comparisons of a changed spec at the same version now include `version-unchanged` (`warn`). It doesn't fail CI under the default `--fail-on error`.

## References

- POLICY.md section 9; RULES.md section 9
- [Record the compared versions in every report](2026-11-21T0303-record-compared-versions.md)

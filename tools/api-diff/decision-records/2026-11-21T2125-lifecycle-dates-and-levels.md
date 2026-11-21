# Lifecycle: reference date, undated deprecations and unknown stability levels

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 21:25 UTC |
| **Summary** | Deprecation periods and sunsets are checked against today (UTC) or `--as-of`; an undated deprecation counts as long enough unless `undated-deprecation: block`; an unknown stability level is `spec-invalid`. |
| **Milestone** | M6 |

## Background

Building the lifecycle rules (M6 step 5: `operation-removed-after-deprecation`, `deprecated-added`/`-removed`, `sunset-moved-earlier`, `stability-decreased`) needed answers POLICY.md section 7 doesn't give. The first three were asked and answered on 2026-11-21; the rest were decided while building and are listed so they can be reviewed.

## Alternatives considered

### The date "now" for deprecation periods and sunsets (asked)

- **✅ Chosen: the run date (UTC), with `--as-of <YYYY-MM-DD>` to fix it.** Simple and matches what a reviewer expects today. Re-running an old CI job later can give a different answer; `--as-of` makes runs reproducible, and the golden test cases always set it (2026-11-21 by default).
- **Rejected: the revision's commit date for git inputs.** Reproducible, but a rebased PR gets a new date, and plain files would still need the run date.
- **Rejected: always require `--as-of`.** No hidden clock, but every run would need the flag for the rules to work.

### A deprecated operation without `x-deprecated-since` (asked)

- **✅ Chosen: configurable, `operation-removed.unless.undated-deprecation: allow | block`, default `allow`.** `allow` counts any deprecation as long enough (`operation-removed-after-deprecation`, `info`), which suits teams that don't record dates; `block` keeps the removal an error and the message says the period can't be checked.
- **Rejected: always block.** Strict, but teams without dates would see every removal as an error.
- **Rejected: always allow, or always `warn`.** Not configurable either way.

### An unknown stability level (asked)

- **✅ Chosen: `spec-invalid` at the extension.** Strict like the rest of the policy: a typo such as `stabel` is caught. Teams with other names set `stability-decreased.levels`; `lifecycle.default-stability` must be one of them (a policy error otherwise).
- **Rejected: ignore unknown levels, or a `warn` notice.**

### Decided while building (for review)

- **Lifecycle extensions aren't also `extension-changed`.** The configured `stability`, `deprecated-since` and `sunset` extensions are interpreted by lifecycle rules, so a change to them isn't reported twice. A change to `x-deprecated-since` alone has no rule and isn't reported.
- **Where the extensions are read:** the operation, or else its path item.
- **`past-sunset` doesn't need `deprecated`.** A passed sunset date allows removal on its own, as POLICY.md's `unless.past-sunset` reads.
- **`deprecated-for-days` per stability level:** a level missing from the mapping uses 90 days.
- **Where `deprecated-added` / `-removed` apply:** operations, parameters (matched like other parameter rules, with location variants), and schemas including properties (from the schema engine, one finding per schema). Not path items, headers or media types.
- **Invalid dates** (not a real `YYYY-MM-DD`) are `spec-invalid` at the extension, on either side.

## Decision

As chosen above.

## Impacts

- `src/diff/lifecycle.ts` (lifecycle diff, deprecation period); `--as-of` on the CLI and `asOf` in `CompareOptions`; test cases take `options.as-of`.
- `operation-removed` messages say why a removal wasn't allowed (deprecated too briefly, or no date with `block`).
- POLICY.md sections 4 and 7, [docs/spec-authors.md](../docs/spec-authors.md) and the README describe the behaviour.

## References

- POLICY.md sections 4 and 7; RULES.md sections 2 and 9
- [In-spec hints and the spec-author guide](2026-11-21T2109-in-spec-hint-semantics.md)

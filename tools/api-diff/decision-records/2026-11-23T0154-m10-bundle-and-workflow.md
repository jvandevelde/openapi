# M10 bundle and release workflow: the calls made building them

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-11-23 01:54 UTC |
| **Summary** | esbuild is pinned exactly and the bundle is deterministic and tested against the sources on every golden case; the result schema is imported, not read from disk; releases are never replaced, aren't marked Latest, and a suffixed version is a pre-release. |
| **Milestone** | M10 |

## Background

[M10 release choices](2026-11-23T0153-m10-release-choices.md) settled the main questions. Building the bundle and the workflow needed further choices. They were made while building and are listed here for review.

## Alternatives considered

### The bundle

- **✅ esbuild pinned to an exact version (`0.28.2`)**, so the same lockfile gives the same bytes and a release can be rebuilt from its tag and checked against its SHA-256.
- **✅ `mainFields: module, main`:** `jsonc-parser`'s default build is UMD with `require()` calls esbuild can't follow, which failed at start-up; its ESM build bundles cleanly.
- **✅ The result schema is imported** (`with { type: 'json' }`) instead of read from a path next to the sources, which doesn't exist next to the release file. `api-diff schema` now prints it indented by two spaces instead of the file's compact layout; the content is the same.
- **✅ A banner and a list of bundled packages with their licences** at the end of the file (from esbuild's metafile and each package's `package.json`), since `mustache` and `jsonc-parser` carry no licence comment of their own.
- **✅ Not minified:** about 500 KB, and stack traces stay readable.
- **✅ Tested on every test run:** `test/unit/bundle.test.ts` builds it, runs it from a directory without `node_modules`, and compares its output and exit code with the sources' for `--help`, `rules`, `schema` and all golden cases (about 5 s).

### The workflow

- **✅ The version must equal `package.json`'s** at the released commit; the workflow doesn't bump versions itself, so a release is always a commit that went through review.
- **✅ An existing tag or release is never replaced:** a pinned version must always give the same file. A mistake is fixed with a new version.
- **✅ A manual run must be on `main`.**
- **✅ Releases aren't marked *Latest*,** since this repo holds several tools and *Latest* would point at whichever released last. A version with a suffix (`-rc.1`) is published as a pre-release.
- **✅ Release notes** hold the download commands, the SHA-256 and the commit; there's no separate changelog file yet.

## Decision

As listed above.

## Impacts

- `scripts/bundle.ts` (`make bundle`, `npm run bundle`) writes `dist/` (git-ignored).
- `esbuild` is a new development dependency; the release file has no runtime dependencies besides Node.

## References

- `scripts/bundle.ts`, `test/unit/bundle.test.ts`, `.github/workflows/api-diff-release.yml`
- [docs/releasing.md](../docs/releasing.md)

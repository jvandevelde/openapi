# Releasing api-diff

Each release is one file, `api-diff.mjs`, with every dependency bundled, plus `api-diff.mjs.sha256`. Both are attached to a GitHub release of this repository tagged `api-diff-v<version>`. Other repositories download a pinned release ([ci.md](ci.md)); nothing is published to a package registry.

## Cutting a release

1. **Bump the version** in a pull request: `version` in `package.json` and `VERSION` in `src/version.ts` (a test keeps them equal), then `npm install` to update `package-lock.json`. Use [semantic versioning](https://semver.org): before 1.0, a minor bump (`0.11.0`) may change the result JSON, the policy file or the CLI, and a patch bump (`0.10.1`) only fixes bugs. A version with a suffix (`0.11.0-rc.1`) is published as a pre-release.
2. **Merge it to main.**
3. **Start the release**, in either of two ways:
   - **From the Actions tab:** *api-diff release* → *Run workflow*, on `main`, with the version (`0.10.0`, without the `v`). The workflow creates the tag on the commit it runs on.
   - **By pushing the tag:** `git tag api-diff-v0.10.0 <commit> && git push origin api-diff-v0.10.0`.

The [release workflow](../../../.github/workflows/api-diff-release.yml) then:

- checks the version is well formed and equals `package.json`'s at that commit, and that neither the tag (for a manual run) nor the release exists yet; **an existing release is never replaced**, so a mistake is fixed with a new version;
- runs `make test`, builds the bundle (`make bundle`), and runs the bundle on its own (outside the tool's directory, checked against its `.sha256`);
- creates the tag (manual run only) and the release, with download instructions and the SHA-256 in the release notes.

Releases aren't marked *Latest*, since this repository holds several tools; link to a specific tag instead.

## Building it locally

```sh
make bundle          # dist/api-diff.mjs and dist/api-diff.mjs.sha256
node dist/api-diff.mjs --version
```

The build is deterministic: the same commit and lockfile give the same bytes. To check a published release, check out its tag, run `npm ci && make bundle`, and compare `dist/api-diff.mjs.sha256` with the release's. `test/unit/bundle.test.ts` builds the bundle on every test run and checks that it gives the same output as the sources for every golden case.

The bundle starts with `#!/usr/bin/env node` and a banner naming the version, and ends with the bundled packages and their licences (all MIT at present).

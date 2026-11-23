# Running api-diff on pull requests

This page sets up `api-diff` in an API repository's CI: on every pull request it compares the spec with the base branch, posts the `review` report as a comment (updated on each push, not added again) and keeps the full reports as artifacts. **It reports changes; it doesn't fail the build on them**, since breaking changes are often intended. A team that wants a gate adds `--fail-on error` (or `defaults.fail-on` in the policy).

This repository runs the same workflow on its example spec (`examples/petstore/openapi.yaml`) as the `self-check` job in [`.github/workflows/api-diff.yml`](../../../.github/workflows/api-diff.yml), so it's exercised on every PR here.

## The workflow

The workflow downloads a pinned release of `api-diff` (one file, checked against its SHA-256) and fetches the comment script from the same release's tag. Pin `API_DIFF_VERSION` to a [release](https://github.com/jvandevelde/openapi/releases) and update it deliberately; nothing is installed or committed in the API repository.

```yaml
# .github/workflows/api-diff.yml in the API repository
name: api-diff

on:
  pull_request:
    paths: ['openapi.yaml', 'api-diff.yaml', 'api-diff.ack.yaml']   # the spec, plus any files it $refs

jobs:
  api-diff:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write          # to post and update the review comment
    env:
      SPEC: openapi.yaml            # path of the spec in this repository
      BASE: ${{ github.base_ref }}
      API_DIFF_VERSION: 0.11.0      # pin the tool's version
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0            # the base branch's commits must be present
      - uses: actions/checkout@v4   # only the comment script, from the same release
        with:
          repository: jvandevelde/openapi
          ref: api-diff-v${{ env.API_DIFF_VERSION }}
          path: .api-diff-tool
          sparse-checkout: tools/api-diff/ci
      - uses: actions/setup-node@v4
        with:
          node-version: 22          # api-diff needs Node 22.18 or later
      - name: Download api-diff
        run: |
          url="https://github.com/jvandevelde/openapi/releases/download/api-diff-v$API_DIFF_VERSION"
          cd "$RUNNER_TEMP"
          curl -fsSLO "$url/api-diff.mjs" -O "$url/api-diff.mjs.sha256"
          sha256sum -c api-diff.mjs.sha256
      - uses: actions/cache@v4      # optional: skip re-parsing an unchanged base
        with:
          path: ${{ runner.temp }}/api-diff-cache
          key: api-diff-parse-${{ github.event.pull_request.base.sha }}
          restore-keys: api-diff-parse-
      - name: Compare the spec with the base branch
        run: |
          mkdir -p api-diff-out
          node "$RUNNER_TEMP/api-diff.mjs" --base "origin/$BASE..." "$SPEC" \
            --cache-dir "$RUNNER_TEMP/api-diff-cache" \
            --report ci \
            --report review:txt:api-diff-out/review.txt \
            --report review:html:api-diff-out/review.html \
            --report review:json:api-diff-out/result.json \
            --report summary:json:api-diff-out/summary.json \
            --report changelog:html:api-diff-out/changelog.html \
            --report explore:html:api-diff-out/explore.html
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}     # keep the reports when the check fails too
        with:
          name: api-diff-reports
          path: api-diff-out/
      - name: Post the review report on the pull request
        if: ${{ !cancelled() }}     # post it when the check fails too
        run: node .api-diff-tool/tools/api-diff/ci/github-comment.ts --file api-diff-out/review.txt --key "$SPEC"
        env:
          GITHUB_TOKEN: ${{ github.token }}
          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
```

Without the PR comment, drop the second checkout and the last step: the report is still in the job log and the artifacts.

What each part does:

- **The download** fetches `api-diff.mjs` and its `.sha256` from the release and checks one against the other, so a changed or truncated file fails the job. Releases are never replaced, so a pinned version always gives the same file. How releases are made: [releasing.md](releasing.md).
- **`--base "origin/$BASE..."`** compares with the commit where the PR's branch left the base branch, so the report shows only this PR's changes. `fetch-depth: 0` makes sure that commit is present; on a shallow clone `api-diff` says how to fix it.
- **`--report ci`** prints a short list to the job log. `review` (text, HTML and JSON), `summary` (JSON), `changelog` (HTML, for release notes) and `explore` (interactive HTML with every finding and the source side by side) go to files that are kept as the `api-diff-reports` artifact.
- **The comment step** posts `review.txt` inside a code block, with a hidden marker so the next push edits the same comment. It only creates a comment when the spec changed, and always updates an existing one. Each spec gets its own comment (`--key`), so a repository with several specs can run the step once per spec.
- **A spec that can't be read** (broken YAML, Swagger 2.0, not OpenAPI) fails the job (exit code 2) whatever `--fail-on` says, since nothing could be compared. The reports are still written, and the comment shows why under "Problems with the inputs"; that's why the last two steps run with `if: ${{ !cancelled() }}`. The same goes for a failing gate with `--fail-on`.
- **Fork PRs**: GitHub gives them a read-only token, so the comment step warns instead of failing, and the report is still in the job log and artifacts.
- **`--cache-dir`** (optional) keeps the base's parsed documents between runs; it saves about half a second on an 8 MB spec.

## Policy and acknowledgements

Put `api-diff.yaml` (the policy, [POLICY.md](../POLICY.md)) and `api-diff.ack.yaml` (acknowledgements, section 11) in the directory you run `api-diff` from, usually the repository root, and both are picked up. Useful settings for a PR check:

```yaml
# api-diff.yaml
version: 1
exclusions:
  internal: { tags: [internal], extensions: [x-internal] }
reports:
  review:
    exclude: [internal]      # keep internal operations out of the PR comment
# defaults:
#   fail-on: error           # uncomment to fail the check on breaking changes
```

**Accepting a change in a PR:** each finding in the comment ends with its `id`. The PR's author runs `api-diff ack <id> --reason "…" --expires <YYYY-MM-DD>` locally (or edits `api-diff.ack.yaml`) and pushes the file with the PR; the next run marks the finding acknowledged, and reviewers see the reason in the comment. Review that file like code: CODEOWNERS on `api-diff.ack.yaml` makes sure the right people approve what is accepted.

To make the check required, add the `api-diff` job to the branch protection rules. With the default `--fail-on never` it always passes, so it guarantees the report is produced without blocking intended changes; with `fail-on` set, it blocks until the changes are fixed or acknowledged.

## Specs split across files

`api-diff` reads every file the spec reaches with `$ref` at the base revision, so a multi-file spec works as long as `SPEC` is its root file. Widen the workflow's `paths` filter to the directory that holds them.

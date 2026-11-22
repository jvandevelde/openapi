# Running api-diff on pull requests

This page sets up `api-diff` in an API repository's CI: on every pull request it compares the spec with the base branch, posts the `review` report as a comment (updated on each push, not added again) and keeps the full reports as artifacts. **It reports changes; it doesn't fail the build on them**, since breaking changes are often intended. A team that wants a gate adds `--fail-on error` (or `defaults.fail-on` in the policy).

This repository runs the same workflow on its example spec (`examples/petstore/openapi.yaml`) as the `self-check` job in [`.github/workflows/api-diff.yml`](../../../.github/workflows/api-diff.yml), so it's exercised on every PR here.

## The workflow

Until the first release (milestone M10), the workflow checks out this tools repository next to the API repository and runs `api-diff` from there. Pin `ref` to a commit of this repo and update it deliberately.

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
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0            # the base branch's commits must be present
      - uses: actions/checkout@v4
        with:
          repository: jvandevelde/openapi
          ref: <commit SHA>         # pin the tool's version
          path: .api-diff-tool
      - uses: actions/setup-node@v4
        with:
          node-version: 22          # api-diff needs Node 22.18 or later
      - run: npm ci --prefix .api-diff-tool/tools/api-diff
      - uses: actions/cache@v4      # optional: skip re-parsing an unchanged base
        with:
          path: ${{ runner.temp }}/api-diff-cache
          key: api-diff-parse-${{ github.event.pull_request.base.sha }}
          restore-keys: api-diff-parse-
      - name: Compare the spec with the base branch
        run: |
          mkdir -p api-diff-out
          node .api-diff-tool/tools/api-diff/bin/api-diff.ts --base "origin/$BASE..." "$SPEC" \
            --cache-dir "$RUNNER_TEMP/api-diff-cache" \
            --report ci \
            --report review:txt:api-diff-out/review.txt \
            --report review:html:api-diff-out/review.html \
            --report review:json:api-diff-out/result.json \
            --report summary:json:api-diff-out/summary.json \
            --report changelog:html:api-diff-out/changelog.html
      - uses: actions/upload-artifact@v4
        with:
          name: api-diff-reports
          path: api-diff-out/
      - name: Post the review report on the pull request
        run: node .api-diff-tool/tools/api-diff/ci/github-comment.ts --file api-diff-out/review.txt --key "$SPEC"
        env:
          GITHUB_TOKEN: ${{ github.token }}
          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
```

What each part does:

- **`--base "origin/$BASE..."`** compares with the commit where the PR's branch left the base branch, so the report shows only this PR's changes. `fetch-depth: 0` makes sure that commit is present; on a shallow clone `api-diff` says how to fix it.
- **`--report ci`** prints a short list to the job log. `review` (text, HTML and JSON), `summary` (JSON) and `changelog` (HTML, for release notes) go to files that are kept as the `api-diff-reports` artifact.
- **The comment step** posts `review.txt` inside a code block, with a hidden marker so the next push edits the same comment. It only creates a comment when the spec changed, and always updates an existing one. Each spec gets its own comment (`--key`), so a repository with several specs can run the step once per spec.
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

To make the check required, add the `api-diff` job to the branch protection rules. With the default `--fail-on never` it always passes, so it guarantees the report is produced without blocking intended changes; with `fail-on` set, it blocks until the changes are fixed or acknowledged.

## Specs split across files

`api-diff` reads every file the spec reaches with `$ref` at the base revision, so a multi-file spec works as long as `SPEC` is its root file. Widen the workflow's `paths` filter to the directory that holds them.

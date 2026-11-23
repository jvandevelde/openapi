# Using api-diff outside CI

`api-diff` isn't only a PR check. This page has recipes for running it on your own machine and for release, consumer and governance work. Each recipe uses only the defaults unless it says otherwise. For a first look at the tool, see [getting-started.md](getting-started.md). For the PR check, see [ci.md](ci.md).

The examples assume the release file is at `~/bin/api-diff.mjs`, with `alias api-diff='node ~/bin/api-diff.mjs'` ([getting-started.md §1](getting-started.md#1-get-it)). Run them from inside the repository that holds the spec.

| I want to… | Recipe |
|---|---|
| Check my edits before I commit | [1](#1-while-editing-the-spec) |
| Block commits that break clients | [2](#2-a-pre-commit-hook) |
| See what my branch changes before opening a PR | [3](#3-before-opening-a-pull-request) |
| Review someone else's PR locally | [4](#4-reviewing-a-pull-request-locally) |
| Pick the version number for a release | [5](#5-choosing-the-version-for-a-release) |
| Write release notes, or tell SDK maintainers what changed | [6](#6-release-notes-and-sdk-releases) |
| Tell one consumer what affects them | [7](#7-what-affects-one-consumer) |
| Accept a breaking change on purpose | [8](#8-accepting-a-breaking-change) |
| See how the API evolved, or run a governance review | [9](#9-history-and-governance-reviews) |
| Compare with a spec that isn't in this repo | [10](#10-specs-from-elsewhere) |
| Use the results in a script | [11](#11-scripting-with-the-json-result) |

## 1. While editing the spec

Compare your working copy, including uncommitted edits, with the last commit:

```sh
api-diff --base HEAD openapi.yaml                  # the review report
api-diff --base HEAD openapi.yaml --state          # just: no-changes, compatible or breaking
api-diff HEAD:openapi.yaml :openapi.yaml           # only what you've staged (git add)
```

For a closer look, write the `explore` page and open it in a browser. It has every finding, filters, search, and the old and new source side by side:

```sh
api-diff --base HEAD openapi.yaml --report explore:html:/tmp/explore.html && open /tmp/explore.html   # xdg-open on Linux
```

If a finding is surprising, `api-diff rules <rule-id>` explains the rule, why it has its severity, and how to avoid the break.

## 2. A pre-commit hook

Save this as `.git/hooks/pre-commit` and make it executable (`chmod +x`). It compares the staged spec with the last commit, and stops the commit if anything is an `ERROR`:

```sh
#!/bin/sh
# Block commits that make breaking changes to the staged spec.
spec=openapi.yaml
git diff --cached --quiet -- "$spec" && exit 0     # spec not staged: nothing to check
node "$HOME/bin/api-diff.mjs" HEAD:"$spec" :"$spec" --report ci --fail-on error || {
  echo "api-diff: breaking changes in $spec (see above). Commit with --no-verify to override." >&2
  exit 1
}
```

A blocked commit looks like this:

```
ERROR  #/components/schemas/NewPet  maxLength decreased (50 → 20) at /properties/name/maxLength  :openapi.yaml:87 · max-length-decreased-in-request · id 8b48ac001f7e

3 findings: 1 error, 1 warn, 1 info · state: breaking · fails CI at error and above
FAIL: 1 finding at error or above
To accept a change on purpose: api-diff ack <id> --reason "…" --expires <YYYY-MM-DD> (POLICY.md section 11)
api-diff: breaking changes in openapi.yaml (see above). Commit with --no-verify to override.
```

- To also stop on `WARN`, use `--fail-on warn`.
- Breaking changes listed in `api-diff.ack.yaml` don't block the commit ([recipe 8](#8-accepting-a-breaking-change)).
- A spec referenced with `$ref` across several files is read from the index too, so the hook works for multi-file specs. Widen the `git diff --cached` check to cover their directory.
- Hooks in `.git/hooks` aren't shared through git. To share the hook with a team, commit it (e.g. as `scripts/pre-commit`) and have each person run `git config core.hooksPath scripts` once, or add it to a hook manager such as `pre-commit` or `lefthook`.
- A brand-new repository has no `HEAD` yet. Make the first commit with `--no-verify`.

## 3. Before opening a pull request

Compare your branch with the point where it left `main`, so changes that landed on `main` in the meantime aren't counted. This is the same comparison the CI check makes:

```sh
git fetch origin
api-diff --base origin/main... openapi.yaml        # includes uncommitted edits
api-diff --base origin/main... --revision HEAD openapi.yaml   # only what's committed
```

## 4. Reviewing a pull request locally

Fetch the PR's branch, then compare it with where it left `main`:

```sh
git fetch origin pull/123/head:pr-123              # GitHub; or fetch the branch by name
api-diff --base origin/main... --revision pr-123 openapi.yaml --report review:html:/tmp/pr-123.html
```

You can do this without checking out the branch, and your working copy isn't touched. With `--base <rev>...`, the merge-base is taken with the `--revision` side.

## 5. Choosing the version for a release

Every report starts with `advice`, which compares the version bump in `info.version` with the changes. The `summary` report gives the size and risk:

```sh
api-diff --base v1.4.0 openapi.yaml --report summary
```

```
advice    major bump needed (2 breaking changes); revision is a minor bump (too small)

Size and risk
  3 places changed, 2 with breaking changes; 3 operations affected
…
```

A bump that's too small is a `version-bump-too-small` warning. A spec that changed without a bump is `version-unchanged`. If the version lives somewhere other than `info.version` (an `x-` extension, a git tag), or follows another scheme, see [POLICY.md §9](../POLICY.md#9-versions).

## 6. Release notes and SDK releases

Compare the last release with the new one:

```sh
api-diff --base v1.4.0 --revision v1.5.0 openapi.yaml \
  --report changelog:txt:CHANGELOG-1.5.0.md \
  --report changelog:html:changelog-1.5.0.html \
  --report sdk:txt:sdk-1.5.0.txt
```

- **`changelog`** is written for API consumers. Changes are grouped by tag and operation, each with what clients need to do, and docs-only changes are left out. The text version is Markdown, ready for release notes or a developer portal. [getting-started.md §3](getting-started.md#3-reports-one-per-audience) has an example.
- **`sdk`** is for SDK maintainers. It lists changes by generated method and type, renamed methods, arguments and types, and the SDK version bump.
- **To change what the changelog shows,** set it in the policy's `reports.changelog` section ([POLICY.md §10](../POLICY.md#10-reports)). For example, leave internal operations out, or render it with your own Mustache template so the notes need no editing. A per-rule `note` replaces the built-in client advice with your own, such as a link to a migration guide ([POLICY.md §3](../POLICY.md#3-options-every-rule-supports)).

## 7. What affects one consumer

List the operations a consumer calls in a file, one per line, as `METHOD /path` or an `operationId`. The list can come from their SDK usage, or from your gateway's access logs. Then pass the file with `--uses`:

```sh
cat > partner-ops.txt <<'EOF'
listPets
POST /pets
EOF
api-diff --base v1.4.0 --revision v1.5.0 openapi.yaml --uses partner-ops.txt --report changelog
```

Every report then keeps only the changes that reach those operations. The exit code does too. Changes to the whole API, such as a server URL, are always kept. Entries that match no operation are listed in the report header rather than treated as errors, since logs often name operations that have since been removed.

## 8. Accepting a breaking change

If a breaking change is intended and its consumers have been told, record that decision so the change stops failing checks. Every finding has a stable 12-character ID, shown at the end of its line in every report (the PR comment and CI log included):

```
ERROR  DELETE /pets/{petId}  operation removed  v1.0.0:openapi.yaml:63 · operation-removed · id 1e04c5d74301
```

Accept it with `api-diff ack`, run next to the spec, and commit the file it writes with your change:

```sh
api-diff ack 1e04c5d74301 --reason "deletePet was beta; the two partners using it have moved to archiving." \
  --owner @pets-team --expires 2027-03-31
# Created api-diff.ack.yaml: 1e04c5d74301 acknowledged until 2027-03-31. Commit it with your change; …
```

It checks the entry (ID format, a reason, an expiry date in the future, not already acknowledged) and appends it, keeping the rest of the file as written. Or edit `api-diff.ack.yaml` by hand:

```yaml
# api-diff.ack.yaml
- finding: 1e04c5d74301
  reason: "deletePet was beta; the two partners using it have moved to archiving."
  owner: "@pets-team"
  expires: 2027-03-31
```

The finding is still reported, marked `(1 acknowledged)` in the totals, but it no longer fails `--fail-on` or blocks the pre-commit hook. After `expires`, it counts again. An acknowledgement whose finding has gone is reported as stale, so the file can be cleaned up. See [POLICY.md §11](../POLICY.md#11-acknowledgements-file), including how to require that only an owner of the change can accept it.

## 9. History and governance reviews

**How the API evolved** between two releases, one step per commit, with release tags and reverted changes marked:

```sh
api-diff history v1.0.0..v2.0.0 openapi.yaml
api-diff history v1.0.0..HEAD openapi.yaml --tags-only --report timeline:html:history.html   # release to release, then unreleased changes
api-diff history v1.0.0..HEAD openapi.yaml --tags-only='v*' --no-end                         # only v… release tags, stop at the last one
```

**A governance review** of a release uses the `audit` report. It includes everything the other reports leave out: acknowledgements (who, why, until when), where each severity came from, exclusions, and findings per owning team:

```sh
api-diff --base v1.4.0 --revision v1.5.0 openapi.yaml --report audit:html:audit-1.5.0.html --report audit:json:audit-1.5.0.json
```

The JSON version can be kept per release to track trends. To split findings by team, add `owners` to the policy, or `x-owner` to the spec ([POLICY.md §14](../POLICY.md#14-owners)).

## 10. Specs from elsewhere

`api-diff` reads files and git revisions, not URLs. For a spec somewhere else, fetch it first:

```sh
curl -fsSLo /tmp/published.yaml https://api.example.com/openapi.yaml    # what's live
api-diff /tmp/published.yaml openapi.yaml                               # live vs your working copy

api-diff main:../billing-api/openapi.yaml openapi.yaml                  # a file in another clone, at its main
```

Each side is read from its own repository, so the base and the revision can come from different clones. A downloaded single-file spec works as is. A multi-file spec needs its `$ref`ed files next to it.

**Several specs in one repository:** run once per spec, for example in a loop:

```sh
for spec in specs/*/openapi.yaml; do
  echo "== $spec"; api-diff --base origin/main... "$spec" --report ci
done
```

## 11. Scripting with the JSON result

`-f json` prints the full result. Its schema is printed by `api-diff schema` and is in [schema/result-v0.schema.json](../schema/result-v0.schema.json). The top-level fields are `state`, `counts`, `findings`, `advice`, `compared` and `operations`. Each finding has `id`, `rule`, `kind`, `severity`, `severitySource`, `subject`, `message`, `details`, the `base` and `revision` locations, and `impact` (the operations it affects).

```sh
api-diff --base v1.4.0 openapi.yaml -f json > result.json
jq -r .state result.json                               # breaking
jq -c .counts.bySeverity result.json                   # {"error":3,"warn":2,"info":2}
jq -r '.findings[] | select(.kind == "wire" and .severity == "error") | .subject' result.json
```

For a yes or no answer, use `--state` (prints the state) or `--fail-on <level>` (exit code 1 at or above that severity). Exit code 2 always means a usage or input error, such as a missing file, an unknown revision or an invalid policy. Use `--as-of <date>` for runs that must give the same result on any day, since deprecation and sunset checks depend on the date.

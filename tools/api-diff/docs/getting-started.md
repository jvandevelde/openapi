# Getting started with api-diff

`api-diff` compares two versions of an OpenAPI document (3.0, 3.1 or 3.2, YAML or JSON) and tells you what changed and which changes break clients. It reads files or git revisions, needs nothing but Node, and runs without a config file.

This guide covers getting it, comparing two versions, the reports (one per audience), the other commands, and where to go to change the defaults. The full option list is in the [README](../README.md#usage).

## 1. Get it

You need **Node.js 22.18 or later**. Check with `node --version`.

**The release file (recommended).** Each release is one file with everything bundled. Download a pinned version and check it:

```sh
url=https://github.com/jvandevelde/openapi/releases/download/api-diff-v0.13.1
curl -fsSLO "$url/api-diff.mjs" -O "$url/api-diff.mjs.sha256"
sha256sum -c api-diff.mjs.sha256          # macOS: shasum -a 256 -c api-diff.mjs.sha256
node api-diff.mjs --version               # 0.13.1
```

In PowerShell (Windows PowerShell 5.1 or PowerShell 7):

```powershell
$url = "https://github.com/jvandevelde/openapi/releases/download/api-diff-v0.13.1"
Invoke-WebRequest "$url/api-diff.mjs" -OutFile api-diff.mjs
Invoke-WebRequest "$url/api-diff.mjs.sha256" -OutFile api-diff.mjs.sha256
$expected = (Get-Content api-diff.mjs.sha256).Split(" ")[0]
if ((Get-FileHash api-diff.mjs -Algorithm SHA256).Hash -ne $expected) { throw "checksum mismatch" }
node api-diff.mjs --version               # 0.13.1
```

In Windows PowerShell 5.1, run `$ProgressPreference = 'SilentlyContinue'` first: the progress bar makes downloads slow.

Put it anywhere, e.g. `~/bin/api-diff.mjs`, and add `alias api-diff='node ~/bin/api-diff.mjs'` to your shell profile (in PowerShell, `function api-diff { node "$HOME\bin\api-diff.mjs" @args }` in your `$PROFILE`). To update, download a newer version. All releases are listed on the [releases page](https://github.com/jvandevelde/openapi/releases?q=api-diff) (tags `api-diff-v*`).

**From a clone** (to try unreleased changes):

```sh
git clone https://github.com/jvandevelde/openapi ~/src/openapi
npx ~/src/openapi/tools/api-diff --version
```

The rest of this guide writes `api-diff` for either.

## 2. Compare two versions

Give it a **base** (the old version) and a **revision** (the new one). Run it from inside the repository that holds your spec:

```sh
api-diff old.yaml new.yaml                     # two files
api-diff main:openapi.yaml openapi.yaml        # main vs your working copy (uncommitted edits included)
api-diff --base main openapi.yaml              # the same, shorter
api-diff --base main... openapi.yaml           # vs where your branch left main: only your branch's changes
api-diff --base v1.0.0 --revision v1.1.0 openapi.yaml   # two tags
```

`rev:path` takes any git revision (branch, tag, commit, `HEAD~3`, `:` for the staged version). Files the spec references with `$ref` are read **at the same revision**, so multi-file specs work.

Here a branch made three changes to the example pet store: `limit` became required, the `PetStatus` enum got a new value, and `name`'s `maxLength` went from 100 to 50:

```
$ api-diff --base main openapi.yaml
api-diff 0.13.1 · profile wire
base      main:openapi.yaml @ 39ca1cd  (OpenAPI 3.1.0, version 1.0.0)
revision  openapi.yaml  (OpenAPI 3.1.0, version 1.1.0)
advice    major bump needed (2 breaking changes); revision is a minor bump (too small)

Version
  WARN   version went from 1.0.0 to 1.1.0 (a minor bump), but the changes need a major bump (…)  version-bump-too-small · id fbaf54d000d4

Changes (3 places, 2 with breaking changes)
ERROR  #/components/schemas/NewPet  affects 3 operations: GET /pets, GET /pets/{petId}, POST /pets
       -  maxLength decreased (100 → 50) at /properties/name/maxLength  openapi.yaml:94 · max-length-decreased
              request ERROR · id 8b48ac001f7e   response INFO · id c6a8e0868a08
ERROR  GET /pets
       -  query parameter 'limit' became required  openapi.yaml:17 · query-parameter-became-required · id 7266a0a41492
WARN   #/components/schemas/PetStatus  affects 3 operations: GET /pets, GET /pets/{petId}, POST /pets
       -  enum value added: 'adopted' at /enum  openapi.yaml:89 · enum-value-added
              request INFO · id 6f4a9cb185dc   response WARN · id 0d553c2a7a3a

6 findings: 2 error, 2 warn, 2 info · state: breaking · not failing CI (--fail-on never)
To accept a change on purpose: api-diff ack <id> --reason "…" --expires <YYYY-MM-DD> (POLICY.md section 11)
```

### Reading the result

- **Each finding has a severity.**
  - **`ERROR`** breaks existing clients.
  - **`WARN`** may break some clients, for example a new enum value that a strict client doesn't expect.
  - **`INFO`** is safe.
- **Severity depends on direction.** The same schema change is judged separately for data clients **send** (requests) and data they **receive** (responses). That's why the shorter `maxLength` is an `ERROR` for requests and only `INFO` for responses. Such a change is listed once, with its worst severity, and the line below it gives each direction's severity and `id` (`request ERROR · id 8b48ac001f7e   response INFO · id c6a8e0868a08`). They are two findings in the JSON result, each accepted separately, and each has a `direction` field (`in` for requests, `out` for responses). The `explore` page shows them as one row too.
- **A shared component's change is shown once,** with the operations it affects.
- **Each line ends with the file and line, the rule ID and the finding's `id`.** The `id` is what you use to accept a change ([section 5](#5-customise-it)). `api-diff rules <rule-id>` explains a rule, and [docs/rules/](rules/README.md) has a page for each rule with an example.
- **`advice`** compares the version bump in `info.version` with the changes. It warns when the bump is too small, or when the spec changed but the version didn't.
- **`state`** is `no-changes`, `compatible` or `breaking`. `api-diff --state …` prints only the state, for scripts.

### Defaults worth knowing

| Default | What it means | To change it |
|---|---|---|
| **Never fails** (`--fail-on never`) | Exit code 0 even when there are breaking changes, since they're often intended | `--fail-on error` (or `warn`, `info`) exits 1 at or above that severity; or `defaults.fail-on` in the policy ([POLICY.md §2](../POLICY.md#2-profile-and-defaults)) |
| **`wire` profile** | Judges changes by what's sent over the wire (JSON) | `--profile sdk` also treats changes that break generated SDKs as breaking, such as a changed `operationId` or a renamed schema |
| **Built-in severities** | Every rule has a default per direction (`api-diff rules` lists them) | `--rule <id>=<severity>` for one run, or `rules:` and `overrides:` in the policy ([POLICY.md §3–5](../POLICY.md#3-options-every-rule-supports)) |
| **No policy file needed** | `api-diff.yaml` in the current directory is used if present | `--policy <file>`, `--no-policy` ([section 5](#5-customise-it) below) |
| **Nothing excluded** | Internal or beta operations are compared like everything else | Exclusions and stability levels ([POLICY.md §7–8](../POLICY.md#7-lifecycle)) |
| **Today's date** | Deprecation periods and sunset dates are checked against today (UTC) | `--as-of 2027-01-31` for reproducible runs |
| **Text to stdout** | The `review` report, coloured in a terminal | `-f json` / `-f html`, `-o <file>`, `--no-color`, or other reports (next section) |

Exit codes: `0` passed, `1` a finding reached `--fail-on`, `2` a usage or input error (missing file, unknown revision, invalid policy, a report file that can't be written, or a spec that can't be read as OpenAPI 3.x, such as broken YAML or Swagger 2.0; the report is still printed, under "Problems with the inputs").

## 3. Reports: one per audience

One comparison can write several reports. Use `--report <name>[:<format>[:<file>]]`, repeatable. Without a file, the report goes to stdout (one at most). Formats are `txt`, `json` and `html`.

```sh
api-diff --base main... openapi.yaml \
  --report ci \
  --report review:html:review.html \
  --report changelog:html:changelog.html \
  --report explore:html:explore.html
```

| Report | For | What it shows by default | Example |
|---|---|---|---|
| **`review`** (the default) | Reviewers of a spec change | Every finding grouped by the component or operation it's on, with the operations each one affects | Above |
| **`ci`** | CI logs | One line per `ERROR` and `WARN` finding, worst first, and the totals | `--report ci` |
| **`summary`** | Release or product managers | Size and risk: counts by kind and severity, the version advice, the 5 most serious findings | `--report summary:json:summary.json` |
| **`changelog`** | API consumers, release notes | What changed per tag and operation, in plain language, with **what clients need to do**. Docs-only changes are left out | see below |
| **`sdk`** | SDK maintainers | Changes by generated method and type, renamed methods, arguments and types, and the SDK version bump (judged with `--profile sdk`); a change in requests and responses is one line, with each direction's ID | `--report sdk` |
| **`explore`** | Anyone digging in | One self-contained HTML page with every finding, filters, search, and the base and revision source side by side (with a breadcrumb, expandable to the whole schema or operation) | `--report explore:html:explore.html` |
| **`audit`** | API governance | Everything, including what other reports leave out: acknowledgements, where each severity came from, exclusions, findings per owner, finding IDs | `--report audit` |
| `-f json` | Scripts | The full result ([schema](../schema/result-v0.schema.json), also printed by `api-diff schema`) | `-f json -o result.json` |

The changelog for the change above:

```
$ api-diff --base main openapi.yaml --report changelog
# Pet Store 1.0.0 → 1.1.0

**2 breaking changes.** Clients may need updating; each change below says what to do.

## pets

### `GET /pets`: List pets

- **Changed (breaking):** query parameter 'limit' became required
  Always send the query parameter `limit`.

## Shared types

### `NewPet`

Used by `GET /pets`, `GET /pets/{petId}`, `POST /pets`.

- **Changed (breaking):** maxLength decreased (100 → 50) at /properties/name/maxLength
  Send `name` within the new limit: `maxLength` is now 50 (was 100).
…
```

**For one consumer:** `--uses ops.txt` keeps only the changes that reach the listed operations, in every report and in the exit code. The file has one operation per line, as `METHOD /path` or an `operationId`, for example taken from an SDK or from access logs. The changelog then begins with "2 changes affect you".

**To change a report** (leave operations out, regroup it, filter by owner, or render it with your own template), use the policy's `reports` section ([POLICY.md §10](../POLICY.md#10-reports)). You can also define your own report there, such as a `partner-changelog`.

## 4. Other commands

### `history`: how a spec changed over time

```
$ api-diff history v1.0.0..HEAD openapi.yaml
api-diff history  openapi.yaml  v1.0.0 (39ca1cd) → HEAD (4bb2cce)
2 steps · net: 3 error, 2 warn, 2 info

2026-11-23  12bac85  1.1.0: adopted status, limit required, shorter names  1.0.0 → 1.1.0
            ERROR  #/components/schemas/NewPet  maxLength decreased (100 → 50) at /properties/name/maxLength  (request ERROR, response INFO)
            ERROR  GET /pets  query parameter 'limit' became required
            …
── tag v1.1.0 ──────────────────────────────────────────────────────
2026-11-23  4bb2cce  remove deletePet (beta)
            ERROR  DELETE /pets/{petId}  operation removed
            WARN   document  the spec changed (1 finding) but the version is still 1.1.0

Net (v1.0.0 → HEAD): 3 error, 2 warn, 2 info
```

By default there is one step per first-parent commit that changed the file or anything it `$ref`s. Release tags are shown between the steps, changes that a later commit undid are marked as reverted, and the net result comes last. A change reported for both requests and responses is one line, with its worst severity and each direction's in brackets.

- `--tags-only` compares release to release: one step per tagged commit in the range (even one that didn't change the spec, shown as "no API changes"), then the end of the range, marked as having no matching tag, if the spec changed since the last release. `--tags-only=<glob>` keeps only tags matching a git-style glob (`*` any text, `?` one character, `[0-9]` a class), e.g. `--tags-only='v[0-9].[0-9].[0-9]'` for single-digit releases without pre-release suffixes. `--no-end` stops at the last matching tag.
- `--all-commits` includes commits from merged branches.
- `--max-steps <n>` keeps only the latest steps.
- `--report timeline:html:history.html` writes an interactive timeline. `--report timeline:json` gives each step with its own findings, for scripts.

### `rules`: what each rule does

```sh
api-diff rules                                   # implemented rules, kind and default severities (request / response)
api-diff rules query-parameter-became-required   # one rule: what it means, why, how to fix it
api-diff rules --format json                     # for scripts
```

### `schema`

`api-diff schema` (or `api-diff schema result`) prints the JSON Schema of the `-f json` result. There's no JSON Schema for the policy file yet; `api-diff schema policy` says so.

Every command takes `--help`.

## 5. Customise it

Everything is optional. Start with the defaults, and add a policy file when a default doesn't fit your API.

**A policy file**, `api-diff.yaml` next to where you run `api-diff` (usually the repository root), is picked up automatically:

```yaml
# api-diff.yaml
version: 1
defaults:
  fail-on: error                       # fail CI on breaking changes
rules:
  enum-value-added-in-response: info   # our clients tolerate new enum values
exclusions:
  internal: { tags: [internal], extensions: [x-internal] }
reports:
  changelog:
    exclude: [internal]                # keep internal operations out of release notes
```

Unknown keys and rule IDs are errors that come with a suggestion, so typos don't go unnoticed. Here is where to look for each kind of change:

| To… | See |
|---|---|
| Change a rule's severity, wording or fix advice | [POLICY.md §3–4](../POLICY.md#3-options-every-rule-supports) |
| Treat part of the API differently, e.g. anything `beta` or under `/admin` | [Overrides, §5](../POLICY.md#5-overrides) |
| Read deprecation, sunset and stability from your own extensions | [Lifecycle, §7](../POLICY.md#7-lifecycle) |
| Leave internal operations out of reports, or out of the comparison | [Exclusions, §8](../POLICY.md#8-exclusions) |
| Read the version from somewhere other than `info.version`, or turn off the version checks | [Versions, §9](../POLICY.md#9-versions) |
| Change what a report shows, or add your own report | [Reports, §10](../POLICY.md#10-reports) |
| Route findings to the teams that own them | [Owners, §14](../POLICY.md#14-owners) |

**Accepting a breaking change.** If a breaking change is intended, run `api-diff ack <finding-id> --reason "…" --expires <YYYY-MM-DD>` (every report shows each finding's `id`) and commit the `api-diff.ack.yaml` it writes; or edit that file by hand. The finding is still reported, but it no longer fails CI ([POLICY.md §11](../POLICY.md#11-acknowledgements-file)).

**Hints in the spec itself.** Spec authors can steer `api-diff` from the spec, for example with `x-api-diff: { enum: open }` on an enum that will grow, or `x-stability-level: beta` on an operation that may still change. See [spec-authors.md](spec-authors.md).

## 6. Run it on pull requests

[ci.md](ci.md) has a GitHub Actions workflow you can copy. It downloads a pinned release, compares the spec with the PR's base branch, posts the `review` report as a PR comment (updated on every push), and keeps the HTML and JSON reports as artifacts. It doesn't fail the build unless you set `fail-on`.

## Where next

- [workflows.md](workflows.md): recipes for using it outside CI: before committing, a pre-commit hook, reviewing a PR locally, release notes and version numbers, consumer impact, accepting a breaking change, governance reviews, scripting
- [README](../README.md#usage): every command-line option
- [docs/rules/](rules/README.md): one page per rule, with a tested example
- [POLICY.md](../POLICY.md): the full policy file reference
- [RULES.md](../RULES.md): why each change is classified the way it is

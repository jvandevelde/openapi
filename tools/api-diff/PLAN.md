# api-diff: plan

Status: **M0–M10 built** (every rule is implemented, including rename detection; the policy file, acknowledgements, in-spec hints and ownership routing are supported; the `review`, `ci`, `summary`, `changelog`, `sdk`, `explore` and `audit` reports, custom reports with templates, `--uses` consumer views, the `history` timeline, a PR workflow and a release workflow for the bundled `api-diff.mjs` are in place; see [README.md](README.md)). M10 is done once the first release, `api-diff-v0.10.0`, is published and another repo's CI runs it ([docs/releasing.md](docs/releasing.md)). The initial rule set is in [RULES.md](RULES.md), the policy file reference in [POLICY.md](POLICY.md), and decisions in [decision-records/](decision-records/README.md).

`api-diff` compares two OpenAPI documents (a *base* and a *revision*), finds what changed, and decides which changes break clients. Several tools already do parts of this (section 1). We're building our own so that we decide what counts as breaking and how results are shown, and so the tool is built around the problems those tools leave open (section 3): shared and recursive schemas, request vs response direction, wire vs SDK compatibility, and reports for different readers.

---

## 1. Existing tools

Surveyed in November 2026 from each project's own README and docs. "Not documented" means we didn't find it in the pages we read, not that the feature is missing.

| Tool | Type | Status | What stands out |
|---|---|---|---|
| [oasdiff](https://github.com/oasdiff/oasdiff) | Go CLI, Apache-2.0 | Active | `breaking`, `changelog` and `diff` views; `ERR`/`WARN`/`INFO` levels; a large set of checks, each with an ID whose level can be changed; deprecation periods and stability levels; path prefix and filter options |
| [openapi-changes](https://github.com/pb33f/openapi-changes) (pb33f) | Go CLI, Apache-2.0 | Active | Reads specs straight from git (`HEAD~1:openapi.yaml`) and walks a file's git history; interactive terminal UI; offline HTML report with a timeline, change graph and side-by-side/unified diff views; OpenAPI 3.0–3.2 and AsyncAPI 3; rule file toggles `added`/`modified`/`removed` per change type |
| [openapi-diff](https://github.com/OpenAPITools/openapi-diff) (OpenAPITools) | Java CLI, Maven plugin and library, Apache-2.0 | Active | One-word result (`no_changes` / `compatible` / `incompatible`); per-check config properties (e.g. `incompatible.response.enum.increased`); pluggable path matcher; extension diffing via plugins; HTML, Markdown, AsciiDoc, JSON, text |
| [Azure openapi-diff](https://github.com/Azure/openapi-diff) (`oad`) | TypeScript CLI, MIT | **Retired** July 2026 | About 50 numbered rules (1000–1050), each with its own docs page (description, cause, example); version-aware rules (a breaking change needs a new `api-version`; a changed spec without a version change is flagged); Azure `x-ms-*` extension rules; Swagger 2.0 |
| [Bump.sh](https://docs.bump.sh/help/changes-management/) | Hosted service, with CLI and GitHub Action | Active | Changelog published with the API docs; changes labelled documentation, structural or breaking; PR comments; `fail_on_breaking`; consumers subscribe by email or RSS; any two releases can be compared through a shareable link. Breaking-change rules aren't documented as configurable |
| [Speakeasy](https://www.speakeasy.com/docs) | SDK generation platform | Active | Computes OpenAPI and SDK diffs internally (per its changelog), but has no documented standalone diff feature |

### Tool details: features, pros and cons

Features come from each project's docs. Pros and cons are our assessment for this project's needs: configurable rules, large specs, and several audiences.

#### oasdiff

- **Features:** commands `breaking`, `changelog`, `diff`, `summary`, `validate`, `flatten` (merge `allOf`) and `checks` (list rules). Levels `ERR`/`WARN`/`INFO` with `--fail-on`. A `--severity-levels` file (`<check-id> <level>`, or `none` to disable) and ignore files that match a method + path + description text. Deprecation days for stable and beta, and stability levels. Path filtering, prefix add/strip, path parameter rename matching, composed mode for specs split across files. Output: YAML, JSON, Markdown, HTML, text, JUnit, GitHub Actions annotations. Check messages in four languages.
- **Pros:** the largest check set we found; actively maintained; mature CI story (exit codes, annotations); good lifecycle handling.
- **Cons:** checks are written per keyword and position, so the set is large and behaviour depends on which checks exist; customisation is one level per check for the whole spec, with no scoping by path, tag or audience; ignoring a change means matching its description text; `allOf` is exact only with `--flatten-allof`; documented gaps: parameters using `content`, callbacks, `$dynamicRef`, and partial 3.2 support.

#### openapi-changes (pb33f)

- **Features:** commands `console` (interactive terminal UI), `summary`, `report` (JSON), `markdown-report` and `html-report`. Reads specs from git revisions (`HEAD~1:openapi.yaml`) or GitHub URLs, and walks a file's git history ("time machine"). Offline HTML report with a timeline, change graph and side-by-side, unified or inline diff views. Resolves multi-file `$ref`s per revision. A `changes-rules.yaml` file toggles `added`/`modified`/`removed` per change type. OpenAPI 3.0–3.2 and AsyncAPI 3.
- **Pros:** the best history and presentation features we found; current OpenAPI versions; fully offline; npm and Docker distribution.
- **Cons:** rule configuration is on/off per change type rather than a severity per rule; how changes are classified as breaking isn't documented on the pages we read; no request vs response direction model or audience-specific reports documented.

#### openapi-diff (OpenAPITools)

- **Features:** CLI, Maven plugin and Java library. Result state `no_changes` / `compatible` / `incompatible`, `--fail-on-incompatible` and `--fail-on-changed`. Per-check config properties (e.g. `incompatible.response.enum.increased: false`) from a YAML file or the command line. Pluggable `PathMatcher` and extension diffing via Java SPI. Output: HTML, Markdown, AsciiDoc, JSON, text.
- **Pros:** simple to adopt in Java and Maven builds; usable as a library; the one-word state is handy in scripts; extension points for path matching and `x-` extensions.
- **Cons:** only two compatibility outcomes (no "might break" level); OpenAPI 3.0 listed, 3.1/3.2 not; the default path matcher can fail on ambiguous paths (documented); many open issues and pull requests.

#### Azure openapi-diff (`oad`)

- **Features:** about 50 numbered rules (1000–1050), each with a docs page giving description, cause and example. Version-aware rules: breaking changes need a new `api-version`, and a changed spec without a version change is flagged. Rules for Azure `x-ms-*` extensions. Ran as Azure's "Swagger Breaking Change" and cross-version checks.
- **Pros:** well-documented rules; versioning built into the rules; proven on a very large spec repository.
- **Cons:** **retired in July 2026** (AutoRest ecosystem, superseded by TypeSpec); Swagger 2.0 focused; Azure-specific; no configuration or suppression documented.

#### Bump.sh

- **Features:** hosted docs with a changelog entry per deployment, changes labelled documentation, structural or breaking, and breaking changes shown first. CLI and GitHub Action (`diff` posts a PR comment, `fail_on_breaking`). Compare any two releases, including across branches, through a shareable link. Consumers subscribe to weekly email or RSS summaries.
- **Pros:** the best consumer-facing changelog and notifications we found; no tooling to run.
- **Cons:** hosted service, so specs leave your network; breaking-change rules aren't documented as configurable; no SDK-oriented reporting.

#### Speakeasy

- **Features:** SDK generation platform. Its changelog shows OpenAPI and SDK diffs computed internally.
- **Pros:** relevant for teams already generating SDKs with it.
- **Cons:** no documented standalone diff or breaking-change feature; commercial.

### What most tools agree on (our baseline)

- A **breaking / non-breaking** classification, usually with a middle "might break" level.
- An **exit code** for CI.
- A **stable ID per check**, so checks can be documented and tuned.
- Matching `/users/{id}` and `/users/{userId}` as the same path.
- At least **JSON** and **HTML** output.

## 2. Ideas we take from other tools

| Idea | Seen in | How we use it |
|---|---|---|
| Read specs from git revisions (`main:openapi.yaml`) without a checkout | openapi-changes | Accepted anywhere a file path is, with `$ref`s resolved at the same revision (see *Inputs: files and git revisions*, phase 1) |
| Walk a spec's history and show a timeline | openapi-changes | `--history <range>` compares each consecutive pair of commits, and the `explore` report shows the timeline (backlog) |
| Side-by-side, unified and inline diff views | openapi-changes | Options in the `explore` HTML report, for the changed fragments only; browsing the whole spec is left to the separate spec explorer (phase 4) |
| A one-word result for scripts | openapi-diff | `--state` prints `no-changes`, `compatible` or `breaking` (phase 1) |
| Pluggable path matching | openapi-diff | Configurable matcher, including versioning-aware matching (backlog) |
| A docs page per rule with cause and example | Azure openapi-diff | Generated from rule metadata: `api-diff rules <id>` (see POLICY.md section 13) |
| Version-aware rules | Azure openapi-diff, oasdiff | `version-bump-too-small` and `version-unchanged` (RULES.md section 9) |
| Separate documentation, structural and breaking changes | Bump.sh | Our `docs` / `wire` / `sdk` kinds, plus severity |
| Deprecation periods and stability levels | oasdiff | `operation-removed` options and the `lifecycle` policy section |

**Out of scope:** hosted changelog pages and email/RSS subscriptions (Bump.sh); AsyncAPI (openapi-changes). The JSON output is enough for someone to build the first two on top.

## 3. Gaps we aim to close

| # | Common today | Our approach |
|---|---|---|
| 1 | **Hand-written checks for each keyword and position** (request, response, parameter). The larger the set, the easier it is to miss a combination, and behaviour can be uneven. | **Variance-based classification.** Every schema change is first labelled *widened*, *narrowed*, *incompatible* or *neutral*. Then its **position** decides whether it breaks: data clients **send** (requests, parameters) may only widen, and data clients **receive** (responses) may only narrow. One core rule covers most cases. Named rules stay as overrides and for non-schema changes. |
| 2 | **Findings are per endpoint**, so a change to a shared `$ref` can be repeated once for every operation that uses it, which buries the real change. | **Report root causes.** One finding per changed component, with an *impact* list of the affected operations and positions. Renderers can expand or collapse it. |
| 3 | **Customisation ranges from none documented** (Bump.sh, Azure) to on/off switches (openapi-changes, openapi-diff) to a level per check (oasdiff). Ignoring a specific change usually means matching on text. | **Policy file.** Severity per rule, scoped by path, tag, operation, stability level or `x-` extension, with conditions. **Acknowledgements** point at a stable finding ID and carry a reason, owner and expiry date. Expired acknowledgements fail again. |
| 4 | **Findings point at an endpoint or one location**, not at the exact place in both documents. | **Source maps.** Every finding has a JSON Pointer and a file/line/column in **both** documents, which feeds `file:line` references in text output and links in the HTML report. |
| 5 | **Message text is fixed**, and each output format is its own code path. | **Typed change records → separate renderers.** The engine never writes prose. Three output formats: **JSON** (versioned schema, the source of truth), **text** (terminal and logs) and **HTML** (one self-contained file). Any other format (Markdown, SARIF, JUnit, …) can be produced from the JSON by a small script outside the tool. |
| 6 | **Uneven OpenAPI coverage:** parameters that use `content` instead of `schema`, `$dynamicRef`, and 3.2 are partly or not covered (e.g. documented as gaps in oasdiff; openapi-diff lists 3.0). | Model `content` parameters from the start. Normalise 3.0/3.1/3.2 into one internal model, so `nullable: true` and `type: [x, "null"]` don't show up as a diff. |
| 7 | **Composition is approximate:** `allOf` may need to be flattened by an option first, and `oneOf`/`anyOf` changes often can't be classified. | Always compare **effective** schemas (allOf merged), and keep the original structure for display. Match oneOf/anyOf branches by discriminator value, `$ref` target or structural similarity, not by array index. |
| 8 | **Renames read as remove + add.** | **Rename detection:** an operation with the same `operationId` at a new path, a component with a new name but the same structure, a renamed path parameter. Reported as one *renamed* change. |
| 9 | Says *what* changed. | Each finding also says **why** it breaks (an example client that fails) and **how to fix** it (e.g. "make the new property optional", "deprecate first"). |
| 10 | Version checks are a yes/no rule, where they exist. | **Semver advice:** the bump the changes need (major/minor/patch), compared with the recorded versions (`info.version` or configured `x-` extensions, see *Versions compared*). |
| 11 | **Wire and SDK compatibility are mixed together.** A renamed component is harmless on the wire but breaks generated code. | Every rule declares its kind (`wire`, `sdk`, `docs`), and `--profile wire|sdk` sets defaults for each audience. |
| 12 | **One output for everyone.** | **Reports per audience** (section 5) from one result: CI, reviewers, consumers, SDK maintainers, release managers, governance. |

## 4. Architecture

```
 base.yaml ─┐
            ├─► load (+ source map) ─► normalise ─► model ─► diff ─► classify ─► aggregate ─► render
 rev.yaml  ─┘                                                         ▲
                                                          policy.yaml ┘  acknowledgements.yaml
```

1. **load**: parse JSON or YAML and keep the position of every node. Resolve local and file `$ref`s, but keep the reference graph instead of inlining it.
2. **normalise**: convert to a single internal dialect (3.1/3.2 semantics). Normalise path templates (`/users/{id}` and `/users/{userId}` share a key) and lower-case header names.
3. **model**: operations keyed by `METHOD normalised-path`, plus components and security schemes.
4. **diff**: a structural, type-aware diff that produces **change records** (below). No severity decisions here.
5. **classify**: the rule engine. Variance core plus named rules plus policy, giving a severity and rule ID for each change.
6. **aggregate**: group by root cause, compute impact, apply acknowledgements, work out the semver bump.
7. **render**: one renderer per format, all reading the same result object.

Each stage is a pure function with its own tests, so the stages can be swapped or reused (for example, a different renderer, or the diff engine without the classifier).

### Inputs: files and git revisions

**Recommendation: build git reading into the tool, but keep it out of the engine.** The engine only sees a *document source*, an interface with one job: `read(path) → contents`. The CLI chooses the source for each side:

- **Filesystem** (the default): `openapi.yaml`. Uncommitted edits are included.
- **Git revision**: `main:openapi.yaml`, `v1.4.0:specs/orders.yaml`, `HEAD~3:openapi.yaml`, or `:openapi.yaml` (the staged version), using git's own syntax.

```sh
api-diff main:openapi.yaml openapi.yaml             # branch tip vs working tree
api-diff v1.4.0:openapi.yaml v1.5.0:openapi.yaml    # two tags
api-diff --base main... openapi.yaml                # same file at the merge-base with main (what a PR changed)
```

**Why built in rather than a helper script.** A script that runs `git show main:openapi.yaml > /tmp/base.yaml` and passes the temp file looks simpler, but it breaks in three ways:

1. **Multi-file specs break.** `$ref: ./schemas/order.yaml` in the base must be read **from the same revision**, not from the working tree or a temp directory. Only a source that the `$ref` resolver calls into can do that.
2. **Reports point at temp files.** File names and line numbers would refer to `/tmp/base.yaml`, not `main:openapi.yaml`.
3. **Every team writes its own version** of the script, with its own bugs (shallow clones, merge-base, quoting).

**How the git source works.**

- **Shells out to the `git` binary** with `execFile` and an argument list, never a shell string. Revisions starting with `-` are rejected. No libgit2 or JavaScript git library: CI images already have git, and the real binary handles every repository layout (worktrees, submodules, partial clones).
- **One long-running `git cat-file --batch` process** per run reads every file both sides need (the root file and all `$ref` targets), so a spec split into hundreds of files doesn't start hundreds of processes.
- **Paths** in `rev:path` are relative to the current directory, like `git show rev:./path`. `$ref`s are resolved relative to the referring file at the same revision.
- **Telling `rev:path` from a file name:** an argument is read as a git revision only if a local file with that exact name doesn't exist **and** the part before `:` resolves to a commit (`git rev-parse --verify <rev>^{commit}`). A Windows drive letter (`C:\specs\api.yaml`) is never read as a revision. `--base <rev>` and `--revision <rev>` with one shared path avoid the syntax entirely (see decision record *Command-line syntax for files and git revisions*).
- **Merge-base.** `main...` (three dots, as in `git diff`) compares against the commit where the branch left `main`, so a PR's report shows only that PR's changes and not changes that landed on `main` since. This is the default for the `review` and `ci` reports when a branch is given.
- **Shallow clones.** CI checkouts are often shallow, so the base commit may be missing. The tool detects this and fails with a clear fix (e.g. `fetch-depth: 0`, or `git fetch --depth=1 origin main`) instead of a raw git error.
- **Recorded in reports.** The `compared` section records the revision as given, the resolved commit SHA and the blob SHA of each file, and `commit` is filled in automatically as a version label.
- **Caching.** Git blob SHAs are already content hashes, so they're the cache key for the cached base index (backlog): an unchanged base costs one `cat-file` lookup.

#### Using it in other repositories

The tool never assumes it's inside this tools repo. Git commands run **in the repository that contains the spec**, not the one that contains the tool:

- For `rev:path`, the path is resolved from the current directory, and git runs in that path's directory (`git -C <dir>`), which finds the enclosing repository itself. Each side is located independently, so the two sides can even come from different repositories:

  ```sh
  cd ~/src/orders-api
  api-diff main:openapi.yaml openapi.yaml                    # this repo
  api-diff main:../billing-api/openapi.yaml openapi.yaml     # base from another clone
  ```

- `-C <dir>` (as in git) runs everything as if started in `<dir>`, for scripts that don't `cd`.
- Paths inside the reports are shown relative to that repository's root (`orders-api:main:openapi.yaml`), not to where the tool lives.
- **Remote repositories aren't read directly** (no `https://github.com/…` URLs). Clone or fetch first; that keeps authentication with git, where it already works.

**Getting the tool into another repo's CI.** **Decided: a single release file, no package registry.** Each release builds `api-diff.mjs` (all dependencies bundled with esbuild, so no `npm install`) and attaches it to a GitHub release of this repo, tagged `api-diff-v<version>` (tags are per tool, since the repo holds several). This repo is public, so downloads need no token.

```sh
curl -fsSLo api-diff.mjs https://github.com/jvandevelde/openapi/releases/download/api-diff-v0.15.0/api-diff.mjs
node api-diff.mjs main:openapi.yaml openapi.yaml
```

- Each release also attaches `api-diff.mjs.sha256`, so CI can check the download (`sha256sum -c`).
- Before the first release, CI can use a second checkout of this repo instead (`npx ./openapi-tools/tools/api-diff …`). This works with no publishing, but ties the API repo to this repo's layout.
- If a registry is wanted later, the same bundle can be published to npm without changing anything else.

**Nothing is copied into the API repo.** The release file is downloaded when CI runs and is never committed. The API repo only commits:

- the workflow file, with the tool's version pinned in the download URL,
- optionally the policy file (`api-diff.yaml`) and acknowledgements file (`api-diff.ack.yaml`).

The API repo needs a Node runtime (≥ 22.18) in CI, but its own code can be in any language.

**On a developer machine**, either download the release file once (and re-download to update), or point `npx` at a local clone of this repo. Run it from inside the API repo; the current directory is kept, so git reads the API repo, not this one:

```sh
git clone https://github.com/jvandevelde/openapi ~/src/openapi    # once
cd ~/src/orders-api
npx ~/src/openapi/tools/api-diff main:openapi.yaml openapi.yaml
```

- The first `npx` run installs the tool's dependencies into npx's cache. `git pull` in the clone picks up new versions.
- To type just `api-diff`, run `npm link` once in `~/src/openapi/tools/api-diff`, or add a shell alias for `node ~/bin/api-diff.mjs`.
- `npx github:jvandevelde/openapi` doesn't work, because npx can't run a package from a subdirectory of a repo (the same limit `operation-ids` documents).

A minimal workflow in another repo:

```yaml
# .github/workflows/api-diff.yml in the API repo
on: pull_request
jobs:
  api-diff:
    runs-on: ubuntu-latest
    env:
      API_DIFF: https://github.com/jvandevelde/openapi/releases/download/api-diff-v0.15.0
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }            # the base commit must be present
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: |
          curl -fsSLO "$API_DIFF/api-diff.mjs" -O "$API_DIFF/api-diff.mjs.sha256"
          sha256sum -c api-diff.mjs.sha256
      - run: node api-diff.mjs --base origin/${{ github.base_ref }}... openapi.yaml --report ci --report review:html:api-diff.html
```

**What stays outside the core.** Workflows that need more than reading files go in a separate `git` module of the CLI, not the engine:

- **History mode:** `api-diff history v1.0..HEAD openapi.yaml` builds a timeline of changes between two commits (see *Timeline (history mode)* in section 5).
- **Changed specs in a monorepo:** `api-diff changed main...` finds the spec files a branch touched and compares each one.

The library API takes a document source, so other callers (an editor plugin, a test) can supply their own, e.g. in-memory documents, without git.

### Checking both inputs are the same API

When two paths are passed by hand, nothing guarantees they are two versions of one API. A wrong path produces "every operation removed, every operation added": hundreds of errors and nothing pointing at the mistake. So before the diff, the `documents-unrelated` rule (M6, default `error`) checks the two documents share something. If they don't, the diff stops and that is the only finding. The full reasoning, including the algorithms considered, is in decision record *Detect unrelated documents before diffing, with the overlap coefficient*.

- **Signals**, each a set: operations (`METHOD /normalised/path`), `operationId`s and `components.schemas` names. They come from the index the diff builds anyway, so the check costs a few set intersections.
- **Matching**: two items match only if their normalised keys are identical strings. Keys are case-sensitive (`listPets` ≠ `ListPets`), except that HTTP methods are upper-cased, and there is no fuzzy matching: `GET /users/me` and `GET /users/profile` are different items. The tolerance comes from path normalisation and from having three signals. Counting shared keys is one hash-set lookup per item.
- **Score**: the overlap coefficient, shared items ÷ the smaller set's size. Unlike Jaccard (shared ÷ union), an API that grew from 20 to 200 operations still scores 1.0 instead of 0.1.
- **Combining**: the documents are related if **any** scored signal reaches `min-overlap` (default 0.1). A signal empty on either side is skipped. Even if every signal is low, the documents count as related when their `info.title` and a server host match.
- **Path normalisation**, so many different prefixes work: the effective `servers` base path is joined in front, `strip-prefixes` are removed, version-like segments (`v1`, `v2beta1`, `2024-01-01`) are dropped wherever they appear, and parameter names become `{}`. `/billing/v1/invoices/{id}` and `/billing/v2/invoices/{invoiceId}` both become `GET /billing/invoices/{}`. A renamed prefix (`/api/billing` → `/billing`) is usually caught by `operationId`s or schema names instead.

  Worked example for the `operations` signal:

  ```
  base:      GET /billing/v1/invoices          → GET /billing/invoices
             GET /billing/v1/invoices/{id}     → GET /billing/invoices/{}
             GET /users/v1/me                  → GET /users/me

  revision:  GET /billing/v2/invoices          → GET /billing/invoices      ✓ same key
             GET /billing/v2/invoices/{invId}  → GET /billing/invoices/{}   ✓ same key
             GET /users/v2/profile             → GET /users/profile         ✗ no match
             POST /billing/v2/invoices         → POST /billing/invoices     ✗ not in base

  shared = 2, min(3, 4) = 3, score = 2 / 3 ≈ 0.67 ≥ 0.1 → related
  ```

- **Skipped** when the rule is `off`, either document is `spec-invalid`, the base is empty (a new API), the smaller document has fewer than `min-size` (5) operations and schemas, or (with `when: manual`, the default) both inputs are one path at two git revisions.
- **Override**: `documents-unrelated: off` in the policy runs the full diff, e.g. for an intentional rewrite. The options are in POLICY.md section 4.

### Performance (measured)

Measured on a generated 8 MB OpenAPI 3.1 spec (3,650 paths and schemas, about 240k nodes), Node 22, a single run each:

| Step | Time |
|---|---|
| `JSON.parse` (no positions) | 42 ms |
| `jsonc-parser` `parseTree` (JSON with offsets) | 251 ms |
| `js-yaml` load (YAML) | ~250 ms |
| `js-yaml` load with position listener | ~200 ms |
| `yaml` (eemeli) `parse` / `parseDocument` | 2.3–3.1 s |
| Building a pointer → line map from the AST | 235 ms |
| Full recursive deep diff of two parsed docs | 58 ms |

So TypeScript is fast enough, as long as we **don't use the `yaml` package for loading** (it's about 10× slower, because it builds a full CST that keeps comments). Use `JSON.parse` + `jsonc-parser` for JSON and `js-yaml` for YAML, and get positions from offsets. Load base and revision in parallel. The costs that grow with the work are allOf merging and `$ref` impact fan-out, so memoise results per component instead of re-walking for each operation. Target: under 1 s end to end for two 8 MB specs.

**Measured with the implementation (M3)**, `node test/bench/bench.ts 8` on Node 22: parsing one 8 MB YAML spec with positions takes about 0.45–0.56 s and one JSON spec about 0.47 s; comparing two 8 MB YAML specs end to end takes about 1.8 s, mostly parsing. js-yaml 5 replaced the `listener` option with an event parser, which we now use (decision record *Get YAML positions from js-yaml 5 parser events*). Parsing the two sides in worker threads (later) would bring this close to the 1 s target. **With the schema index (M4):** building the index takes about 0.3–0.4 s per 5 MB side, so comparing two 8 MB YAML specs takes about 3.5–4 s. Parsing in workers and caching the base index (backlog) are the next steps if this matters. **With the parse cache (M7, `--cache-dir`):** the base's parsed documents and positions are stored with `v8.serialize`, keyed by content. On the 8 MB benchmark a warm cache saves about 0.5 s (4.0 s → 3.5 s) and writing it costs about 0.4 s once. Parsing is only part of the base's cost; the model and the schema index (about 0.5 s per 5 MB side) are rebuilt every run, so caching the schema index itself is the larger, later step.

### Shared components used in both requests and responses

A component can't be breaking or safe on its own. That depends on **where it's used**. So we split the work into two steps:

**Step 1: classify the change once, at the component.** The diff compares `#/components/schemas/X` in base and revision and labels each change by variance only (`widened` / `narrowed` / `incompatible`), with no severity yet. For example, "enum value added to `Order.status`" is `widened`.

**Step 2: work out the component's usages from the reference graph.** Starting from each operation, walk every `$ref` and record where the component is reached, with a **direction**:

| Reached from | Direction |
|---|---|
| request body, parameters, request headers | `in` (the client sends it) |
| response body, response headers | `out` (the client receives it) |
| property marked `readOnly` | `out` only, even inside a request schema |
| property marked `writeOnly` | `in` only, even inside a response schema |

The comparison walks each property path from the operation (`POST /orders → requestBody → Order.items[] → LineItem.sku`), so `readOnly`/`writeOnly` and nested `$ref`s resolve per property, not per component. Cycles are handled by caching each *(base schema, revision schema, direction)* pair (see the table under *Reference graph, deep nesting and cycles*).

**Step 3: score each direction separately.** The rules come in request/response pairs, and each direction the component is used in gets **its own finding**, with its own rule ID, severity and affected operations: `enum-value-added-in-request` → info, `enum-value-added-in-response` → warn. Each finding records its direction in the result JSON (`"direction": "in"` or `"out"`, the same values as the policy's `direction` override key). It is set only on rules that have request and response variants; rules without them (`ref-*`, docs, component and version rules, and parameter and response-status rules, whose direction is fixed) have no `direction`. One finding per direction, rather than one finding at the worst severity, keeps the rule ID saying which direction set the severity, and lets policies, `--fail-on` and acknowledgements target one direction ([decision record](decision-records/2026-11-21T1539-schema-engine.md)).

The `review`, `explore` and `sdk` reports and the history timeline show the two findings of one change as one entry, with each direction's severity and ID ([decision record](decision-records/2026-11-23T0348-merge-request-response-entries.md); for `sdk`, [this one](decision-records/2026-11-24T0410-sdk-report-pairs-directions.md)):

```
WARN   #/components/schemas/Order  affects 17 operations
       -  enum value added: 'refunded' at /properties/status  orders.yaml:212 · enum-value-added
              request INFO · id 1b7e7940204c   response WARN · id 558c5604c03e
```

The other reports (`ci`, `summary`, `audit`) list each finding with its full rule ID; `changelog` shows the change once, without directions.

Policy overrides apply **per direction and per operation**. An override for one path changes only those usages, and the rest still count (the finding is split, one part per severity).

**Which document's usages count?** Existing clients were built against the **base**, so usages come from the base graph. Usages that are new in the revision (e.g. `Order` now also used in `PATCH /orders`) are already reported as changes to that operation, so they aren't counted again here. An unused component (no usages) gets `info` with the rule `component-unused`.

**This applies to every schema change, not just enums.** Required added or removed, type or format changed, a property removed, length, pattern or min/max limits, `additionalProperties`, `oneOf` branches and so on all work the same way. A change in a nested component (`Order → Customer → Address`) reaches every place `Address` is used, through `Customer` and `Order`.

#### When a `$ref` changes target

For example, `Order.customer` changes from `$ref: Customer` to `$ref: CustomerV2`, or an inline schema becomes a `$ref` or the other way round. This produces **two kinds of finding**, shown together:

1. **The ref change itself.** `ref-target-changed` (or `ref-inlined` / `ref-extracted`) at `Order.customer`. It's always reported, so reviewers see it.
2. **What actually changed in the data.** We compare the base and revision schemas field by field (`Customer` vs `CustomerV2`) **at that location**, and report each difference (e.g. `email` removed) as a child finding with the usages of `Order`.

```
ERROR  Order.customer: $ref Customer → CustomerV2              (orders.yaml:230)
       ├─ ERROR property 'email' removed            used as out in 14 ops
       ├─ WARN  enum value added to 'tier'           used as out in 14 ops
       └─ INFO  optional property 'locale' added     used as in  in  3 ops
```

The parent finding takes the highest severity of its children. If the two schemas are identical, the only finding is the ref change itself.

#### Kinds of change: wire, SDK and docs

A ref change can be harmless on the wire but still break generated SDKs, because code generators use component names as type names (`Customer` → `CustomerV2` breaks code that refers to `Customer`). So every rule declares which kind of compatibility it affects:

- **`wire`**: the JSON on the wire. Old clients fail at runtime.
- **`sdk`**: generated code. Old client code stops compiling (type renamed, ref inlined, an `anyOf` became a `oneOf`, an operationId renamed, a parameter renamed).
- **`docs`**: annotations that don't change the wire or generated types, but are still changes: `description`, `summary`, `title`, `example`/`examples`, `externalDocs`, tag descriptions, and `x-` extensions not otherwise classified. They're `info` by default, shown in the **diff** view, and hidden from **breaking**.

Some annotations aren't purely docs, so they get their own rules:
- **`deprecated`** added or removed has lifecycle rules (deprecation period, sunset).
- **`default`** changes server behaviour when a field is omitted, so it counts as `wire` (`warn`).
- **`x-` extensions** can matter to code generators (e.g. `x-enum-varnames`, `x-go-type`). The policy file says which kind each extension is, e.g. `extensions: { x-enum-varnames: sdk }`, and the rest default to `docs`.

Built-in **profiles** set different defaults: `--profile wire` (`sdk` rules are `info`) and `--profile sdk` (`sdk` rules are `warn` or `error`). For `ref-target-changed` with identical schemas, the default is `info` under `wire` and `error` under `sdk`. The policy file can override either.

### Reference graph, deep nesting and cycles

Recursive schemas usually crash diff tools in one of three ways:

- **Infinite recursion**: inlining or walking `$ref`s never ends (a stack overflow).
- **Path explosion**: listing every path to a schema grows exponentially when unions and collections fan out.
- **Comparisons that never finish**: comparing `A` with `A′` leads back to `A` with `A′`.

Typical shapes: `TreeNode.children: items: $ref TreeNode` (refers to itself), and `Shape: oneOf [Circle, Group]` with `Group.children: items: $ref Shape` (a union whose member refers back to the base type in a collection).

**We never inline `$ref`s.** Each document gets a **schema index**, built once after loading. Documents don't change during a run, so there is nothing to keep up to date:

- **Nodes**: every schema root: component schemas, schemas an operation uses directly (inline, keyed by their JSON pointer) and every `$ref` target. Inline subschemas belong to their root's own content.
- **Edges**: every `$ref` from a node's content to another node, with where it sits (its path inside the node) and whether that path passes through a `properties`, `items` or `additionalProperties` step (*productive*, see cycle validity below).
- **Reverse edges**: who refers to me.
- **Tarjan's strongly connected components (SCCs)**, implemented **iteratively** with an explicit stack. A recursive implementation can itself overflow on deep graphs. Each node records its SCC and whether it's recursive (an SCC of more than one node, **or** a single node with an edge to itself, which Tarjan doesn't flag on its own).

Tarjan gives us the SCCs in reverse topological order (each SCC after every SCC it refers to). Its result is used for three things; the other stages handle cycles their own way. As built:

| Stage | How it handles references and cycles |
|---|---|
| **Structural hashing** (uses Tarjan) | Deep (Merkle) hashes: each node's own content plus the deep hashes of what it references, computed SCC by SCC in Tarjan's order, so referenced nodes are hashed first. Each recursive SCC is hashed as one unit, keyed by the members' stable names, so self-referencing schemas get a stable hash (`#merkle` in `src/index/schema-index.ts`). The diff uses the deep hashes to skip unchanged schemas (same name, same `full` hash), to detect renames (same `shape` hash, new name) and to spot changes to unused components. A recursive schema's hashes include its own name (in its `$ref`s and the unit), so members of recursive SCCs also get a **rename key**: the same hashes with each reference inside the SCC written as the member's position in an order found without names (`#renameKeys`); rename matching uses it instead of the deep hash. See *Content hashes* below. |
| **Cycle validity** (uses Tarjan) | A cycle is *productive* if it passes through at least one `property`, `items` or `additionalProperties` edge, meaning the data actually nests (fine). Within each recursive SCC, Tarjan runs again on the other edges only: a cycle made only of `allOf`/`oneOf`/`anyOf`/`$ref` edges (e.g. `A: allOf [$ref A]`) describes nothing valid and is reported as `cycle-not-productive` instead of looping (`#checkProductive`). |
| **Recursive marker** (uses Tarjan) | A node in a recursive SCC (more than one member, or a self-loop) is marked `recursive`. Findings inside it carry `details.recursive`, shown as `↻` in the `explore` report. |
| **Effective schemas** (allOf merge) | Computed on demand for each position compared (`#effective` in `src/diff/schema-engine.ts`), following `allOf` members and `$ref`s. A visited set and a depth limit (50) stop `allOf` cycles, which the index reports. Each merged keyword keeps where it came from. |
| **Diff** | Compares pairs (base node, revision node), cached per pair and direction. A pair met again while it's still being compared is **assumed equal** (the standard way to compare recursive types); any real difference is still found on the non-cyclic part of the path. |
| **Usages / direction** | The diff walks from each operation's request and response schemas with a direction (`in` or `out`; a `readOnly` property is skipped in requests and a `writeOnly` one in responses) and records, for each pair it reaches, the pairs it was reached from. A finding's affected operations are found by walking those links back to the operations (`#impact`). The pair cache above keeps this finite on cycles. |
| **Impact paths** | Not built: findings list the affected operations, not example paths through the schemas. |
| **Rendering** | Reports show findings and snippets of the changed source, never an expanded schema, so there is no depth to limit. The `explore` page shows each finding's enclosing schema or operation on both sides, aligned as a diff and folded around the change, and a `$ref`'s target source, one hop (at most 400 lines each); when one side reached the change through a `$ref` the other didn't, it shows that `$ref`'s schema first. It never inlines references. |

The component graph is small even for an 8 MB spec (thousands of nodes), and Tarjan is O(V+E), so building the index takes milliseconds.

### Content hashes: skip unchanged parts, check nothing was missed, count changes

Every node in the schema index (each component, operation, parameter and response) gets **two hashes**, computed after the normalise step so cosmetic differences such as key order or `nullable` vs `type: [.., "null"]` don't count:

- **`shape`**: everything that affects the wire or the SDK (types, constraints, required, refs by target *and* name, enum values, `default`, extensions classified `wire`/`sdk`).
- **`full`**: `shape` plus every annotation (`description`, examples, `x-` extensions, …).

Comparing the two hashes of each base/revision pair gives:

| `shape` | `full` | Meaning | What we do |
|---|---|---|---|
| same | same | Unchanged | **Skip the subtree entirely.** Most of a large spec usually hasn't changed, so this is the main speed-up. |
| same | differs | Annotations only | Diff only the annotations and emit `docs` findings. |
| differs | — | Real change | Full diff and classification. |

**Safety net: `unclassified-change`.** If a node's `shape` hash changed but no rule produced a `wire` or `sdk` finding for it, we emit `unclassified-change` (default `warn`) with the pointer and both values. This means the rules can never silently miss a change. It also tells us when the rules have a gap: every `unclassified-change` in the test corpus is a missing rule to write. CI can be strict with `unclassified-change: error`.

**Counts.** Every change record has a `kind` (e.g. `schema.enum.value-added`) and a kind of change (`wire`/`sdk`/`docs`), so the summary is just a group-by:

```
Changes: 47  (wire 9, sdk 3, docs 35)
  components changed: 6 of 412      operations changed: 18 of 1,203
  error 2   warn 5   info 40

  wire  schema.property.removed          2  error
  wire  schema.enum.value-added          3  warn
  sdk   ref.target-changed               1  error
  docs  description.changed             31  info
  ...
```

The hashes also give exact "changed / total" counts for components and operations without walking unchanged subtrees. `--summary` prints only this block, and the JSON output contains the same numbers for dashboards.

### Change record (draft)

```jsonc
{
  "id": "c7f3e1a2b4d6",                     // stable hash of kind + locations
  "kind": "schema.enum.value-removed",
  "subject": { "component": "#/components/schemas/Status" },
  "base":     { "pointer": "/components/schemas/Status/enum/2", "file": "base.yaml", "line": 88, "value": "archived" },
  "revision": null,
  "variance": "narrowed",
  "impact": [
    { "operation": "GET /orders/{id}", "position": "response", "status": "200", "path": "body.status" },
    { "operation": "POST /orders",     "position": "request",  "path": "body.status" }
  ],
  "rule": "schema-narrowed-in-request",
  "severity": "error",                      // per impact entry when positions disagree
  "explanation": "Clients that send status=archived will now be rejected.",
  "fix": "Keep 'archived' in the enum and mark it deprecated in the description."
}
```

### Policy file (draft)

```yaml
version: 1
defaults:
  fail-on: error
rules:
  enum-value-added-in-response: warn       # clients with exhaustive switches may break
  property-removed-in-response: error
  operation-removed:
    severity: error
    unless: { deprecated-for-days: 90 }
overrides:
  - match: { stability: [draft, alpha] }
    severity: info                         # anything goes before beta
  - match: { path: "/legacy/**" }
    severity: off
  - match: { extension: { x-audience: partner } }
    rules: { enum-value-added-in-response: error }
```

#### How a finding's severity is chosen

Every finding gets its severity from this list. The first match wins:

1. **Acknowledgement**: this specific finding ID was accepted, so it's reported but doesn't fail CI (until it expires).
2. **In-spec hint**: an extension on the schema or operation itself, e.g. `x-api-diff: { enum: open }` on a schema means "clients must accept unknown values", so adding a value is `info` there. The rule travels with the schema instead of living in a separate file.
3. **Policy override**: the last matching `overrides` entry (by path glob, tag, operationId, stability, extension, component name).
4. **Policy rule**: the `rules` entry for the rule ID.
5. **Built-in default** for that rule.

Enum changes as an example. Each case is its own rule ID, so each can be set separately:

| Rule | Default | Why |
|---|---|---|
| `enum-value-added-in-request` | info | Old clients never send it |
| `enum-value-added-in-response` | warn | Breaks clients that use exhaustive switches; harmless for those that don't |
| `enum-value-removed-in-request` | error | Clients that send it are rejected |
| `enum-value-removed-in-response` | info | Clients just stop seeing it |
| `enum-added-to-unconstrained-in-request` | error | A free string became a closed set |

Every finding in the output also shows **where its severity came from** (e.g. `warn ← policy override #2 (path /partner/**)`), so nobody has to guess why something passed or failed.

```yaml
# acknowledgements.yaml
- finding: c7f3e1a2b4d6
  reason: "Only the mobile app sends 'archived', and it's already updated."
  owner: "@orders-team"
  expires: 2027-01-31
```

## 5. Reports by audience

The engine produces one **result object** (JSON with a versioned schema): findings, usages, counts, the semver advice, and where each severity came from. Every report is a **view** over that object, so all reports agree with each other and the specs are parsed only once, however many reports are produced.

### Who reads what

| Report | Reader | The question it answers | Includes | Grouped by | Formats | Where it goes |
|---|---|---|---|---|---|---|
| **`ci`** | The pipeline | What breaks, briefly? (and pass or fail, if the team gates on it) | Findings at or above `--fail-on` (or `warn` when nothing gates), excluding acknowledged ones | Severity | exit code, text, JSON | CI step log, JSON kept as a build artifact |
| **`review`** | PR author and reviewers | What does this PR change, and who does it affect? | wire + sdk findings with their affected operations, a collapsed list of docs changes, acknowledged findings marked as such; no fix advice (breaking changes are often intended) | Root cause (component or operation), worst first | text, HTML | PR comment (text), linked HTML artifact |
| **`changelog`** | API consumers | What changed for me in this release, and what do I need to do? | Plain-language entries: new, changed, deprecated (with sunset dates), removed, and migration notes. Configured exclusions applied (see *Exclusions*), no acknowledgement details, no docs-only changes unless asked | Tag, then operation | HTML, text | Release notes, developer portal |
| **`sdk`** | SDK maintainers | Which generated types or methods change? | sdk findings, a table of old → new type and method names, the SDK semver bump | Generated type / operationId | text, JSON | SDK release PR |
| **`summary`** | Release or product manager | How big and how risky is this release? | Counts by kind and severity, the semver advice, the 5 most serious findings | — | text, JSON | Release checklist, chat |
| **`audit`** | API governance | Are we following our own rules? | Everything, including acknowledged findings (who, why, expiry), expired acknowledgements, `unclassified-change`, and which policy entry set each severity | Rule | JSON, HTML | Governance reviews, dashboards (trends across releases) |
| **`explore`** | Anyone investigating | Show me every change | All findings, each finding's enclosing schema or operation, base and revision aligned as a diff (removed and added lines tinted, changed text marked, unchanged parts folded, a gap where an item was added or removed, other findings marked, `$ref` targets, and the `$ref` a side went through when only one side did), filters (kind, severity, tag, path), search, recursive schemas shown as `↻`, and links into the spec explorer. A diff view, not a spec browser | Sections as in `review`; changes by schema or operation (or flat), docs changes by rule | Self-contained HTML (one file, works offline) | CI artifact linked from the `review` comment |

### Spec browsing and payloads

`explore` is a **diff view**, not an API reference like Scalar or Swagger UI. Browsing the whole spec and generating example payloads belong to the separate spec explorer, so the two tools don't duplicate each other ([decision record](decision-records/2026-11-22T1647-explore-is-a-diff-view.md)):

- `explore` shows the findings and only the changed fragment of each side, from the source maps.
- Each finding links into the spec explorer at its base and revision pointers, through a URL template (`explorer-url: https://…/#{pointer}`).
- The spec explorer can read the result JSON to mark changed or breaking elements in its own views. The result JSON is the only interface between the two tools.

### Exclusions

Nothing is excluded by default. Every path, including internal ones, is compared and reported unless you configure otherwise. Exclusions are **named sets** in the config file, so they can be reused and changed without code changes:

```yaml
exclusions:
  internal:                      # example set; edit, rename or delete it
    paths: ["/internal/**"]
    extensions: [x-internal]     # anything with x-internal: true
    # also available: tags, operationIds, components
```

A set can be used at two levels:

- **`exclude`** (per report): still compared and counted, just left out of that report. Use it for audiences who shouldn't see something, e.g. internal paths in a public `changelog`.
- **`ignore`** (globally, in the policy): not compared at all. Use it for parts of the spec you don't own.

```yaml
reports:
  changelog: { exclude: [internal] }   # hide from consumers
  review:    {}                         # reviewers see everything
# ignore: [internal]                    # uncomment to skip internal paths entirely
```

Exclusions are never silent. Every report states what was left out, e.g. `4 changes hidden by exclusion 'internal'`, and the JSON lists the hidden finding IDs. `audit` always shows everything.

### Versions compared

Every report starts with the versions it compared, and the JSON records them under `compared`, so a report always shows what it covers.

By default the version comes from `info.version`. The config can read it from vendor extensions instead, plus any extra labels you want to record:

```yaml
versions:
  primary:                        # used for the semver advice
    from: [x-api-version, info.version]   # first one present wins
  labels:                         # extra values to record and show
    build:    x-build-id
    commit:   x-git.sha           # dotted paths reach nested fields
    released: x-release-date
```

- `from` takes a list. The first source present in the document wins, so specs without the extension fall back to `info.version`.
- Any source is either an `x-` extension at the document root, `info.<field>`, or a JSON Pointer (`/info/x-meta/version`).
- **CLI overrides** take precedence over both, e.g. a git tag from CI: `--base-version v1.4.0 --revision-version v1.5.0` (and `--base-label commit=abc123`).
- If no source gives a version, the report shows `unknown` and the semver advice is skipped with a notice. It doesn't fail the run. Only the listed sources count: `info.version` isn't a hidden fallback.
- **`git-tag`** / **`git-tag:<glob>`** reads the version from a (matching) tag on the compared commit, for git inputs and every `history` step; an untagged commit uses the next source (see decision record *Versions from git tags, and only the configured sources*).

Each side also records the file name, a SHA-256 of the file, and where its version came from, along with the tool version and a hash of the policy. This makes every report reproducible:

```
api-diff 0.15.0 · policy 3fa2c1e
base      orders.yaml  v1.4.0 (x-api-version)  build 812  commit 9d4a736
revision  orders.yaml  v1.5.0 (x-api-version)  build 845  commit c7f3e1a
advice    major bump needed (2 breaking changes); revision is a minor bump
```

### Timeline (history mode)

`api-diff history <start>..<end> <spec>` shows how a spec changed **step by step** between two commits, not just the net difference.

```sh
api-diff history v1.4.0..HEAD openapi.yaml
api-diff history v1.4.0..v2.0.0 openapi.yaml --report timeline:html:timeline.html
```

#### How it's generated

1. **Resolve the range.** `<start>` and `<end>` are any git revisions. `<start>` is the starting point (step 0), and every later version up to `<end>` becomes a step.
2. **List candidate commits** with `git log --first-parent --reverse <start>..<end> -- <paths>`, where `<paths>` is every file in the spec's `$ref` closure at `<start>` and at `<end>`, so changes to a referenced schema file count too. `--follow` tracks a renamed root file.
   - **`--first-parent` by default:** only the mainline, so each merged PR is one step and work-in-progress commits on branches don't clutter the timeline. `--all-commits` includes every commit.
   - `--tags-only` gives a release-to-release timeline instead: one step per commit in the range with a tag (`--tags-only=<glob>`: a tag matching a git-style glob), whether or not that commit changed the spec, then the end of the range if the spec changed after the last matching tag (`--no-end` leaves it out). See decision record *Release-to-release timelines: tag globs, tags on any commit, and the untagged end*.
3. **Drop commits that didn't change the spec.** For each candidate, compute a fingerprint: the git blob SHAs of every file in the spec's `$ref` closure at that commit. If it matches the previous step, the commit only touched unrelated files (or files that were later dropped from the closure), so it's skipped. This also catches referenced files added or removed over time, which a fixed path list can miss.
4. **Compare each consecutive pair** (step *n−1* → step *n*) with the normal engine and policy. Each version is parsed **once** and its index is cached by blob SHA, so *N* steps cost *N+1* parses, not *2N*. Unchanged subtrees are skipped by hash, so most steps are cheap after parsing. Parsing runs in parallel worker threads.
5. **Also compare start → end** for the **net** result. This is not the sum of the steps: a change made and then reverted shows up in two steps but not in the net result.
6. **Link findings across steps.** Findings have stable identities (kind + location, following renames), so the timeline can tell when a change was **introduced**, **changed again** or **reverted**, e.g. "removed in #420, restored in #431".
7. **Attach commit details** to each step: SHA, date, author, subject, PR number (from the merge message or a trailing `(#123)`), tags pointing at the commit (`git tag --points-at`), and the recorded versions (see *Versions compared*), so version bumps and `version-bump-too-small` show on the step where they happen.

Large ranges: a spec that changed in 200 commits means about 200 parses, roughly 50 s for an 8 MB YAML spec on one core, and less with workers and the persistent index cache. `--max-steps` and `--tags-only` keep it bounded.

#### Text output

```
api-diff history  openapi.yaml  v1.4.0 (9d4a736) → HEAD (c7f3e1a)
12 steps · 3 releases · net: 1 error, 4 warn, 27 info

2026-09-02  a1b2c3d  #412 Add refunded status              v1.4.0 → v1.4.1
            WARN   enum value 'refunded' added to Order.status   out · 14 ops
            INFO   description changed ×3
2026-09-10  d4e5f6a  #420 Remove legacy export             v1.4.1 → v1.5.0
            ERROR  operation removed: GET /exports/{id}          ↺ restored in #431
            WARN   version-bump-too-small (minor, but 1 breaking change)
── tag v1.5.0 ─────────────────────────────────────────────────────────
2026-09-15  0f9e8d7  #431 Revert "Remove legacy export"    v1.5.0 → v1.5.1
            INFO   operation added: GET /exports/{id}            ↺ reverts #420
...
Net (v1.4.0 → HEAD): 1 error, 4 warn, 27 info   (2 changes reverted within the range)
```

#### HTML output

One self-contained file, like the `explore` report:

- **Timeline strip** across the top: one marker per step along a date axis, coloured by the step's worst severity, sized by its number of changes, and split into `wire` / `sdk` / `docs`. Release tags are vertical lines with their names. Hovering shows the commit subject and counts.
- **Step panel:** clicking a marker shows that step's findings, grouped and filtered the same way as `explore`, with links to the commit and PR.
- **Net / steps toggle:** switch between the net start → end result and the step-by-step view. Reverted pairs are joined by a line in the strip.
- **Element history:** pick any operation, component or property (search or click from a finding) to see its own row of every change to it across the range: "when did `Order.status` lose `archived`, and in which PR?" Renames keep the same row.
- **Filters** apply to the strip and the panels together: severity, kind, path, tag, owner, and the report's exclusions.

#### JSON output

```jsonc
{
  "range": { "start": { "rev": "v1.4.0", "commit": "9d4a736…" }, "end": { "rev": "HEAD", "commit": "c7f3e1a…" } },
  "steps": [
    { "commit": "a1b2c3d…", "date": "2026-09-02", "author": "…", "subject": "Add refunded status",
      "pr": 412, "tags": [], "versions": { "base": "1.4.0", "revision": "1.4.1" },
      "counts": { "error": 0, "warn": 1, "info": 3 },
      "findings": [ { "id": "f-91c2…", /* change record, as in a normal report */ } ] }
  ],
  "links": [ { "finding": "f-77aa…", "step": 1, "revertedBy": "f-3b10…", "revertedIn": 3 } ],
  "net": { /* the normal start → end result object */ }
}
```

Each step carries its own finding records: an ID names a kind of change at a place, so the same ID can come up in several steps with different details (a version check, a property edited twice). A revert link names a finding by its ID and step.

### Output formats

Only three: **`json`**, **`txt`** and **`html`**. Every report supports `json`, and the table lists the others each one supports.

- **`json`**: the full result object with a versioned JSON Schema (`api-diff schema` prints it). This is the stable interface, and anything else (Markdown, SARIF, JUnit, dashboards) is built from it outside the tool.
- **`txt`**: plain text for terminals, CI logs and PR comments (inside a code block). Colour only when writing to a TTY, and `NO_COLOR` is respected.
- **`html`**: a single self-contained file (inline CSS/JS, no network), so it works as a CI artifact or opened locally.

### What's different from existing tools' reports

- **Exclusions for each audience.** Each report applies only the exclusion sets you configure (see *Exclusions*), and `changelog` never shows acknowledgement reasons or owners.
- **Each report stays the right size.** GitHub comments are limited to 65,536 characters, so `review` shows the most serious findings in full, collapses the rest and links to the `explore` HTML artifact for the remainder. It never just cuts off.
- **Comments are updated, not added.** The example workflow puts a hidden marker in the `review` comment so CI edits its own earlier comment instead of adding a new one each push.
- **Reporting, not gating, by default.** `--fail-on` defaults to `never`: breaking changes are reported and highlighted, and a team opts in to failing CI (decision record *The PR check reports changes and doesn't fail by default*).
- **Consumer impact reports.** `changelog --uses ops.txt` (a list of operations, from an SDK or from access logs) keeps only the changes that reach those operations, through the usage graph. Each consumer sees "3 changes affect you" instead of the whole release.
- **Plain language comes from data, not code.** Each `kind` has message templates per audience (`review` is technical: "enum value removed in request at `Order.status`", `changelog` is consumer-facing: "`status` no longer accepts `archived`"). Teams can edit the templates without touching the engine.

### Configuring reports

The built-in reports are presets, and the config file can change them or add new ones:

```yaml
reports:
  changelog:
    exclude: [internal]
    include: { kinds: [wire, sdk], min-severity: info }
  partner-changelog:                   # a custom report
    extends: changelog
    include: { extensions: { x-audience: partner } }
    format: html
    template: ./templates/partner.html
```

Several reports can be produced in one run, from one parse:

```sh
api-diff base.yaml rev.yaml \
  --report ci \
  --report review:txt:out/review.txt \
  --report explore:html:out/report.html \
  --report changelog:html:out/changelog.html
```

## 6. Implementation plan

### Layout

```
tools/api-diff/
  package.json  tsconfig.json  Makefile  README.md
  bin/api-diff.ts                 CLI entry
  src/
    cli/          argument parsing; commands: diff (default), history, rules, schema
    sources/      document sources: fs.ts, git.ts (cat-file --batch, rev:path, merge-base)
    load/         json.ts (jsonc-parser), yaml.ts (js-yaml), positions → source map, $ref resolution
    normalize/    3.0/3.1/3.2 → one dialect; path templates; header names
    model/        operations, parameters, bodies, responses, security, components
    index/        schema graph, iterative Tarjan, productive-cycle check, shape/full hashes, usages
    diff/         structural diff → change records (no severities)
    rules/        rule metadata registry; one file per RULES.md section
    classify/     variance, profiles, policy precedence, provenance
    aggregate/    root causes, impacts, bulk-change collapsing, acknowledgements, semver, counts
    policy/       load, JSON Schema validation, defaults
    report/       presets (ci, review, changelog, …), filters, exclusions
    render/       txt.ts, json.ts, html/ (self-contained page)
    history/      commit listing, fingerprints, step diffs, revert links
  test/
    cases/<name>/{base.yaml, revision.yaml, expected.yaml[, policy.yaml]}
    unit/         Tarjan, variance, hashing, git source, policy precedence
    bench/        generated 8 MB spec + timing script
```

Each stage in section 4 is its own folder with a pure function as its entry point, so stages can be tested alone.

### How we test

- **Golden cases** (`test/cases/`): one folder per rule or scenario. `expected.yaml` lists the findings (rule, severity, location, usages). A runner compares results and can regenerate `expected.yaml` with `--update` for review. A test fails if any rule has no case.
- **Unit tests** for the algorithms: Tarjan (including self-loops and deep graphs without stack overflow), variance, hashing stability, policy precedence, `rev:path` parsing.
- **Property tests** (`fast-check`): random schemas and random edits. Invariants: diffing a spec against itself finds nothing; key order and 3.0 vs 3.1 nullability never produce findings; every changed shape hash yields at least one finding (no silent gaps).
- **Performance budget**: the `bench/` script runs in CI (non-blocking at first) and reports parse and diff times for two 8 MB specs. Target under 1 s for the diff itself.
- CI: `.github/workflows/api-diff.yml`, the same pattern as `operation-ids` (runs only when the tool changes, `make test`).

### Milestones

Each milestone is one or a few pull requests and ends with something that runs.

| # | Milestone | Contents | Done when |
|---|---|---|---|
| **M0** ✅ | Scaffold | Package, tsconfig, Makefile, CI workflow, golden-case runner, rule metadata registry, `api-diff rules`, result JSON Schema v0 | `make test TOOL=api-diff` runs the (empty) case runner in CI |
| **M1** ✅ | Phase-1 corpus | About 45 cases (74 written, incl. 4 for M4/M5) for RULES.md sections 2–6 and 11, and the recursive-schema cases | Expected results reviewed and agreed |
| **M2** ✅ | Inputs | fs and git sources (`rev:path`, `main...`, shallow-clone detection), JSON/YAML loaders with positions, local and relative-file `$ref`s, normalise | Loads the test cases and an 8 MB spec from both files and git within the parse budget |
| **M3** ✅ | Operation-level diff | Model, diff and rules for paths, operations, security, parameters, request bodies, responses; txt and json output; `--fail-on`, `--state` | **First usable version:** M1 cases pass, and it can gate a PR on operation-level changes |
| **M4** ✅ | Schema index | Graph, iterative Tarjan, productive-cycle check, shape/full hashes, skipping unchanged subtrees, `unclassified-change` | Recursive cases load and hash, and no input causes a stack overflow |
| **M5** ✅ | Schema engine | Effective `allOf` merge, pair-cached comparison for cycles, variance, union branch and discriminator matching, schema rules (section 7), usages and direction (incl. `readOnly`/`writeOnly`), root-cause aggregation, ref rules, docs rules, profiles, bulk-change collapsing (3+ operations). Example re-validation moved to the backlog | All schema cases pass, and each shared-component change appears once |
| **M6** ✅ | Policy | Policy file and validation, rules, overrides and precedence, in-spec hints, lifecycle, extensions, exclusions and `ignore`, versions, acknowledgements (incl. stale), severity provenance, the `documents-unrelated` precheck | Every POLICY.md example is a passing test |
| **M7** ✅ | PR check | Report presets, `ci`, `review` (the default) and `summary` reports (txt/json/html), multiple `--report`, versions header with bump advice, `--fail-on never` by default, opt-in `--cache-dir` base index, a copyable GitHub Actions workflow and a self-check workflow in this repo | **Runs on every PR here and is ready to copy into an API repo** |
| **M8** ✅ | Presentation | `explore` HTML (diff view with `explorer-url` links, no spec rendering), `changelog`, `sdk`, rename detection, semver advice, migration notes for clients (instead of fix advice), history timeline | Reviewers prefer it to the tools in section 1 |
| **M9** ✅ | Governance | `audit`, custom reports and Mustache templates, per-rule message and note wording, `--uses` consumer reports, ownership routing (`x-owner`, policy `owners`, `group-by: owner`, `include.owners`, `acknowledgements.require-owner`) | Release notes and governance reviews use it without manual editing |
| **M10** (built) | Distribution | esbuild bundle (`make bundle`, deterministic, tested against the sources on every golden case), release workflow (tag `api-diff-v*` pushed, or a manual run that creates it → `api-diff.mjs` + `.sha256` on a GitHub release), generated rule docs (since M3), README and CI docs using the release; first release `0.10.0` | Another repo's CI downloads a pinned release and runs it |

Until the first release is published, other repos use a local clone or a second checkout (section 4, *Using it in other repositories*).

The backlog (section 8) is picked from after M7, except the low-effort ★ items already folded in above (bulk-change collapsing in M5, the cached base index in M7). Example re-validation is not scheduled.

Out of scope at first: **webhooks and callbacks** (if a spec has them, a single `info` notice says they weren't compared, so nothing is skipped silently; the direction model allows them to be added later by flipping direction), Swagger 2.0, external (`http://`) refs, specs split across many files (`--composed`), translations.

## 7. Decisions to make

Each decision has a full record (background, alternatives, impacts) in [decision-records/](decision-records/README.md). Summary of the main ones, decided on 2026-11-21:

1. **Language: TypeScript on Node ≥ 22.18**, run directly with Node's built-in type stripping (no build step for development and tests; `tsc --noEmit` for type checks; `erasableSyntaxOnly`, so no `enum`s or namespaces), bundled with esbuild for releases. Uses `js-yaml` / `jsonc-parser` for position-aware loading (see Performance).
2. **OpenAPI versions: 3.0, 3.1 and 3.2** from the start, using the normalise step.
3. **Ambiguous changes:** see the **Decided** defaults in RULES.md.
4. **Name: `api-diff`.** Command `api-diff`, policy file `api-diff.yaml`, acknowledgements `api-diff.ack.yaml`, in-spec extension `x-api-diff`, release tags `api-diff-v<version>`.
5. **Distribution: a single bundled release file** (`api-diff.mjs` plus a SHA-256 file) on GitHub releases of this repo. No package registry for now (see section 4, *Using it in other repositories*).

6. **Which reports first: `ci` and `review`** (built in M7), since they make the tool usable as a PR check.

Still open (not needed before M8):

7. **Counter-example payloads: delegate, share or build.** The spec explorer already generates payloads. The options: delegate generation to it entirely; share a minimal-payload generator, with `api-diff` adding the finding-specific change and checking that the old schema accepts the payload and the new one rejects it; or build one here on top of the schema index. Before choosing, check the explorer's generator for cycle and union handling, deterministic output, whether it can be bundled for Node, and 3.0–3.2 support. See the [decision record](decision-records/2026-11-22T1647-explore-is-a-diff-view.md).

## 8. Further ideas (backlog)

Ideas aimed at large enterprise specs. None of the tools in section 1 document these, as far as we found. Each idea has a rough value/effort rating so we can pick from it later. **★** marks the ones I'd do first.

Each idea has its own file in [feature-backlog/](feature-backlog/README.md) with the details: what it does, related records, options and open questions. This section keeps only a short entry per idea, what it is and why it's worth having, so the plan stays readable as ideas are worked out. New proposals follow the same pattern (see [the decision record](decision-records/2026-11-23T0157-feature-proposals-in-feature-backlog.md)).

### Review and publishing

| Idea | What it does and why | Value / effort | Status |
|---|---|---|---|
| [**Overlays, a review file and a review loop**](feature-backlog/overlays-and-review-loop.md) | Keep `x-api-diff` hints out of the published spec with OpenAPI Overlays and diff what is actually published; reviewers mark findings in the CLI or HTML report, and their decisions (acks, notes, lasting facts about nodes) feed later runs, so every lowered severity is traced and owned. | high / high | Idea |

### Evidence and accuracy

| Idea | What it does and why | Value / effort | Status |
|---|---|---|---|
| [**★ Counter-example payloads**](feature-backlog/counter-example-payloads.md) | For each `wire` finding, a small JSON value the old schema accepts and the new one rejects, as proof the change breaks something. | high / medium | Idea |
| [**Re-validate examples**](feature-backlog/re-validate-examples.md) | Check every base `example`/`examples` against the revision schema; an example that no longer validates is a concrete breaking change. | high / low | Idea |
| [**Constraint maths**](feature-backlog/constraint-maths.md) | Compare numeric, length and item-count constraints as intervals, and simple `pattern`s as automata, so narrowed vs widened is exact. | medium / medium | Idea |
| [**Versioning-scheme aware matching**](feature-backlog/versioning-scheme-matching.md) | Match `/v1/…` with `/v2/…`, or versioned media types, when a new API version is published alongside the old one. | medium / low | Idea |

### Large specs and noise

| Idea | What it does and why | Value / effort | Status |
|---|---|---|---|
| [**★ Bulk-change collapsing**](feature-backlog/bulk-change-collapsing.md) | Group the same change made in many places without a shared `$ref` into one "N operations" finding. | high / low | Built |
| [**★ Cached base index**](feature-backlog/cached-base-index.md) | Cache the parsed base by content hash so CI only parses the revision. | high / low | Built |
| [**One entry per change in requests and responses**](feature-backlog/merge-request-response-findings.md) | Show a schema change's `…-in-request` and `…-in-response` findings as one entry in `review` and `explore`, with each direction's severity and ID, so reviewers don't read every schema change twice. IDs and acknowledgements stay per finding. | high / low | Built |
| [**Explore page: sections, grouping and folded documentation changes**](feature-backlog/explore-sections-and-grouping.md) | Lay the `explore` page out like `review`: changes grouped by schema or operation (or flat, by a remembered control) and documentation changes folded into one group per rule, so a reviewer sees each schema once and docs edits as a line each. | high / low | Built |
| [**Explore page: expand to the enclosing schema**](feature-backlog/explore-expand-to-enclosing-schema.md) | Each side of a finding shows a breadcrumb (`components › schemas › Order › …`), expands from the 9-line window to the whole enclosing schema or operation, and jumps to a `$ref`'s target, so a reviewer sees which schema a deep change is in without opening the spec. | high / low | Built |
| [**Explore page: clearer context in the before/after panes**](feature-backlog/explore-context-panes.md) | When a property's inline schema becomes a `$ref` (or the reverse), the revision pane shows only the new component, so the two panes don't look like the same place. Show the shared enclosing schema on both sides with the component as a second block, open scopes by default with unchanged siblings folded rather than a 9-line window, and align the sides, so a reviewer reads each change in context without clicking around. | high / medium | Built (in part) |
| [**Explore page: a reviewer's UX pass over the finding panes**](feature-backlog/explore-reviewer-ux-pass.md) | A review of every finding on a realistic spec pair found the panes often hide the change (cut off at the edge, whole-line highlights) or highlight a line that didn't change (the parent of an added or removed item). Wrap lines and mark changed characters, show a gap where an item was added or removed, tint and align the panes as a diff, name parameters in messages and breadcrumbs, put the evidence before the IDs, and use a unified diff on phones. | high / medium | Built (except the phone layout) |
| [**Discriminated-union variants as one change**](feature-backlog/discriminated-union-variants.md) | A branch and its mapping value are already one finding, but the discriminator property's enum value is still a second finding per direction, and `x-api-diff: { enum: open }` lowers only that one. Fold the enum value into the variant, apply the open hint to all of it, match branches by discriminator value, and report enum values with no branch. | medium / medium | Idea |
| [**Changesets: group related changes**](feature-backlog/changesets.md) | A new property whose type brings four new schemas is reported today as just "property added", and the operation added for the same feature is a separate entry. Group related findings into changesets: new or removed schema subgraphs with their attachment points (exact, from base and revision alone), shared new references, labelled heuristics, and commits or PRs when history is available. | high / medium | Idea |
| [**Spec quality side-report**](feature-backlog/spec-quality-side-report.md) | List identical inline schemas found by the content hashes ("appears inline 42 times; consider a component"). | medium / low | Idea |
| [**Portfolio mode**](feature-backlog/portfolio-mode.md) | Compare many specs in one run and report which APIs a change to a shared schema file affects. | high / high | Idea |

### Ownership and governance

| Idea | What it does and why | Value / effort | Status |
|---|---|---|---|
| [**★ Ownership routing**](feature-backlog/ownership-routing.md) | Owners from `x-owner` or the policy's `owners.assign` list, listed on each finding, with reports split per team. | high / medium | Built (M9) |
| [**Release-to-release timelines: tag globs and the unreleased end**](feature-backlog/release-timeline-tag-globs.md) | `history --tags-only=<glob>` keeps only matching release tags, shows every release (even one tagged on a commit that didn't change the spec) and ends with unreleased changes, so release managers see what each release changed and what's waiting to ship. | high / low | Built |
| [**Versions from git tags**](feature-backlog/versions-from-git-tags.md) | A `git-tag:<glob>` version source reads the release tag on the compared commit, for teams that version by tag rather than in the spec, including in `history` timelines. | high / low | Built |
| [**Git blame for findings**](feature-backlog/git-blame-for-findings.md) | Use the source maps to find the commit and author that introduced each change. | medium / low | Idea |
| [**Deprecation ledger**](feature-backlog/deprecation-ledger.md) | A standing report of everything deprecated, with sunset dates, overdue removals and `Deprecation`/`Sunset` header checks. | medium / low | Idea |
| [**Breaking-change budget**](feature-backlog/breaking-change-budget.md) | A policy limit on breaking changes per release or audience. | low / low | Idea |
| [**Usage-weighted severity**](feature-backlog/usage-weighted-severity.md) | Import call counts per operation to rank findings or lower severity for unused operations. | high / medium | Idea |

### Developer experience

| Idea | What it does and why | Value / effort | Status |
|---|---|---|---|
| [**Editor integration (LSP)**](feature-backlog/editor-integration-lsp.md) | Run the engine as a language server so breaking changes show up in the editor before a PR exists. | high / medium | Idea |
| [**`api-diff explain <finding-id>`**](feature-backlog/explain-command.md) | Print the full reasoning for one finding: rule, usages, severity source, counter-example and fix. | medium / low | Idea |
| [**Extensions: your own data in the result JSON**](feature-backlog/result-extensions.md) | Teams keep data about a commit or a change that the spec doesn't have (PR labels, ticket IDs, release notes, deploys). Named `extensions` slots on each history step, finding and result hold it, filled from git trailers, git notes, the spec or a script, shown in the timeline and in templates; `api-diff render` renders a saved JSON file again, so any script can add data and api-diff still draws the report. | high / medium | Idea |
| [**Rule plugins**](feature-backlog/rule-plugins.md) | Custom TypeScript rules against the change-record API, tested with the golden-case format. | high / medium | Idea |
| [**Lint only what changed**](feature-backlog/lint-only-what-changed.md) | Let plugin rules declare `scope: changed` so house rules apply only to new and changed parts. | high / low | Idea |
| [**Watch mode**](feature-backlog/watch-mode.md) | `api-diff --watch` re-runs on save. | low / low | Idea |
| [**Policy file JSON Schema**](feature-backlog/policy-json-schema.md) | `api-diff schema policy` prints a JSON Schema for `api-diff.yaml`, so editors validate and autocomplete the policy file instead of authors finding typos only when they run the tool. | medium / medium | Idea |

### Enterprise operation

| Idea | What it does and why | Value / effort | Status |
|---|---|---|---|
| [**Offline and deterministic**](feature-backlog/offline-and-deterministic.md) | No network calls or telemetry, and byte-identical output for the same inputs, so it works in air-gapped CI. | required / low | Idea |
| [**Example value redaction**](feature-backlog/example-value-redaction.md) | Mask `example` values in reports, keeping their type and shape, since they can hold real customer data. | medium / low | Idea |
| [**Signed reports**](feature-backlog/signed-reports.md) | Hash (and optionally sign) the inputs and the report so audit records can be shown to be unchanged. | low / medium | Idea |
| [**Memory-lean index**](feature-backlog/memory-lean-index.md) | Intern strings and store graph edges in typed arrays so 50 MB+ specs fit in small CI runners. | medium / medium | Idea |

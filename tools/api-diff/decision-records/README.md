# Decision records

One file per decision, oldest first. Each record has a status, background, the alternatives considered, the decision and its impacts. See [use-decision-records](2026-11-21T0417-use-decision-records.md) for the format, and copy [TEMPLATE.md](TEMPLATE.md) for a new record.

**File names:** `<YYYY-MM-DDTHHMM>-<slug>.md`, in UTC, so files sort chronologically.

**Statuses:**

- **Proposed**: suggested, not yet agreed.
- **Accepted**: agreed; the current decision.
- **Superseded**: replaced. The record links to the one that replaced it, and the new record links back with **Supersedes**.

To change a decision, don't edit the old record's decision. Add a new record that supersedes it, and change only the old record's status line.

| Date (UTC) | Decision | Status | Summary |
|---|---|---|---|
| 2026-11-21 02:32 | [Build our own OpenAPI diff tool](2026-11-21T0232-build-our-own-diff-tool.md) | Accepted | Build and maintain `api-diff` in this repo instead of adopting an existing diff tool. |
| 2026-11-21 02:32 | [TypeScript on Node 20](2026-11-21T0232-typescript-on-node-20.md) | Superseded → [TypeScript on Node ≥ 22.18 with type stripping](2026-11-21T0407-typescript-on-node-22.md) | Initial proposal: write the tool in TypeScript on Node ≥ 20. |
| 2026-11-21 02:32 | [Load YAML with the `yaml` package](2026-11-21T0232-yaml-package-for-loading.md) | Superseded → [Use js-yaml and jsonc-parser for position-aware loading](2026-11-21T0236-fast-position-aware-parsers.md) | Use the `yaml` package (already used by `operation-ids`) to load specs and get node positions. |
| 2026-11-21 02:36 | [Use js-yaml and jsonc-parser for position-aware loading](2026-11-21T0236-fast-position-aware-parsers.md) | Accepted | Load YAML with `js-yaml` and JSON with `JSON.parse` + `jsonc-parser`, and get positions from their offsets. |
| 2026-11-21 02:37 | [Severity precedence and configurable rules](2026-11-21T0237-severity-precedence.md) | Accepted | Every rule's severity is configurable; when several settings apply, the most specific wins. |
| 2026-11-21 02:41 | [Classify schema changes by variance and usage direction](2026-11-21T0241-direction-aware-classification.md) | Accepted | Label each schema change as widened, narrowed or incompatible once, then decide severity per usage from whether the client sends (`in`) or receives (`out`) the data. |
| 2026-11-21 02:44 | [Separate wire and SDK compatibility](2026-11-21T0244-wire-and-sdk-compatibility.md) | Accepted | Every rule declares whether it affects the wire (JSON) or generated SDKs; profiles set defaults for each. |
| 2026-11-21 02:46 | [Leave webhooks and callbacks out of scope](2026-11-21T0246-webhooks-and-callbacks-out-of-scope.md) | Accepted | Don't compare webhooks or callbacks at first, but say so in reports. |
| 2026-11-21 02:49 | [Schema index with Tarjan's SCCs for recursive schemas](2026-11-21T0249-schema-index-with-tarjan.md) | Accepted | Never inline `$ref`s; build a schema graph per document and find cycles with an iterative Tarjan's algorithm. |
| 2026-11-21 02:55 | [Shape and full content hashes, with an unclassified-change safety net](2026-11-21T0255-content-hashes-and-unclassified-change.md) | Accepted | Hash every node twice (shape only, and shape plus annotations) to skip unchanged parts, detect annotation-only changes and catch changes no rule handled. |
| 2026-11-21 02:55 | [Report annotation changes as a docs kind](2026-11-21T0255-docs-kind-for-annotations.md) | Accepted | Changes to descriptions, examples, titles and unclassified `x-` extensions are reported as kind `docs`, severity `info`. |
| 2026-11-21 02:58 | [Output formats: JSON, text and HTML only](2026-11-21T0258-output-formats-json-txt-html.md) | Accepted | Support only `json`, `txt` and `html` output. |
| 2026-11-21 02:58 | [Reports by audience as views over one result](2026-11-21T0258-reports-by-audience.md) | Accepted | Produce one result object per comparison and render audience-specific reports (`ci`, `review`, `changelog`, `sdk`, `summary`, `audit`, `explore`) from it. |
| 2026-11-21 03:03 | [Exclusions are configurable named sets](2026-11-21T0303-configurable-exclusions.md) | Accepted | Nothing is excluded by default; exclusions are named sets in the config, with `internal` only as an example. |
| 2026-11-21 03:03 | [Record the compared versions in every report](2026-11-21T0303-record-compared-versions.md) | Accepted | Every report records the versions it compared, from `info.version` by default or from configured vendor extensions. |
| 2026-11-21 03:19 | [Policy file validated strictly, rule docs generated from code](2026-11-21T0319-policy-file-design.md) | Accepted | Unknown policy keys and rule IDs are errors, and rule documentation is generated from rule metadata in code. |
| 2026-11-21 03:20 | [Split parameter rules by location](2026-11-21T0320-parameter-rules-by-location.md) | Accepted | Parameter rules have location-specific IDs (`query-…`, `header-…`, `cookie-…`); path parameter changes are operation changes. |
| 2026-11-21 03:22 | [Defaults for judgement-call rules](2026-11-21T0322-judgement-call-defaults.md) | Accepted | Keep the proposed defaults for the five rules where teams commonly disagree. |
| 2026-11-21 03:45 | [Design around a survey of existing tools](2026-11-21T0345-survey-other-diff-tools.md) | Accepted | Base the design on a survey of oasdiff, openapi-changes, OpenAPITools openapi-diff, Azure openapi-diff, Bump.sh and Speakeasy, not on one tool. |
| 2026-11-21 03:52 | [Read git revisions in the tool through document sources](2026-11-21T0352-git-revision-inputs.md) | Accepted | Support `rev:path` inputs inside the tool, but keep git out of the engine behind a document-source interface. |
| 2026-11-21 03:55 | [Distribute through an npm registry plus a release file](2026-11-21T0355-npm-and-release-distribution.md) | Superseded → [Distribute as a single bundled release file](2026-11-21T0407-release-file-distribution.md) | Proposed: publish to an npm registry, plus a bundled file on GitHub releases. |
| 2026-11-21 04:00 | [History timeline from consecutive comparisons](2026-11-21T0400-history-timeline.md) | Accepted | `api-diff history <start>..<end> <spec>` compares each consecutive version of the spec in the range and links findings across steps. |
| 2026-11-21 04:05 | [Build the ci and review reports first](2026-11-21T0405-ci-and-review-reports-first.md) | Proposed | Build the `ci` and `review` reports before the other reports. |
| 2026-11-21 04:05 | [Implementation milestones M0–M10](2026-11-21T0405-implementation-milestones.md) | Accepted | Build in eleven milestones, each ending with something that runs. |
| 2026-11-21 04:07 | [Name the tool api-diff](2026-11-21T0407-name-api-diff.md) | Accepted | Keep `api-diff` as the tool's name. |
| 2026-11-21 04:07 | [Support OpenAPI 3.0, 3.1 and 3.2](2026-11-21T0407-openapi-3-0-to-3-2.md) | Accepted | Support OpenAPI 3.0, 3.1 and 3.2 from the start through a normalise step. |
| 2026-11-21 04:07 | [Distribute as a single bundled release file](2026-11-21T0407-release-file-distribution.md) | Accepted | Publish `api-diff.mjs` (bundled, with a SHA-256 file) on GitHub releases of this repo; no package registry. |
| 2026-11-21 04:07 | [TypeScript on Node ≥ 22.18 with type stripping](2026-11-21T0407-typescript-on-node-22.md) | Accepted | Write the tool in TypeScript and run it directly on Node ≥ 22.18 using Node's built-in type stripping. |
| 2026-11-21 04:17 | [Record decisions as decision records](2026-11-21T0417-use-decision-records.md) | Accepted | Keep a `decision-records/` directory with one dated record per decision. |
| 2026-11-21 04:36 | [Command-line syntax for files and git revisions](2026-11-21T0436-cli-input-syntax.md) | Accepted | Inputs are files or `rev:path`; `--base <rev>` and `--revision <rev>` take one shared path; `<rev>...` means the merge-base. |
| 2026-11-21 04:36 | [Golden test cases define what each rule does](2026-11-21T0436-golden-test-cases.md) | Accepted | Each rule is defined by test cases (base, revision, expected findings); every implemented rule needs at least one. |
| 2026-11-21 04:36 | [Problems in either document are findings](2026-11-21T0436-problems-in-either-document.md) | Accepted | Invalid documents and unresolved `$ref`s are reported as `spec-invalid` / `ref-unresolved` findings for the side they're on, instead of stopping the run. |
| 2026-11-21 04:36 | [Only 2xx responses count as success statuses](2026-11-21T0436-response-status-classes.md) | Accepted | `response-success-status-*` rules apply to 2xx and `2XX`; every other status except `default` uses the `response-error-status-*` rules. |
| 2026-11-21 04:36 | [Get YAML positions from js-yaml 5 parser events](2026-11-21T0436-yaml-positions-from-parser-events.md) | Accepted | Use js-yaml 5's `parseEvents` stream for both values and positions, with merge keys enabled. |

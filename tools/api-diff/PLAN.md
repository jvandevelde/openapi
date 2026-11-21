# api-diff: plan

Status: **planning**. No code yet. The initial rule set is in [RULES.md](RULES.md), and the policy file reference in [POLICY.md](POLICY.md). This directory has no `Makefile`, so the root `make` ignores it for now.

`api-diff` compares two OpenAPI documents (a *base* and a *revision*), finds what changed, and decides which changes break clients. Several tools already do parts of this (section 1). We're building our own so that we decide what counts as breaking and how results are shown, and so the tool is built around the problems those tools leave open (section 3): shared and recursive schemas, request vs response direction, wire vs SDK compatibility, and reports for different readers.

---

## 1. Existing tools

Surveyed in November 2026 from each project's own README and docs. "Not documented" means we didn't find it in the pages we read, not that the feature is missing.

| Tool | Type | Status | What stands out |
|---|---|---|---|
| [oasdiff](https://github.com/oasdiff/oasdiff) | Go CLI, Apache-2.0 | Active | `breaking`, `changelog` and `diff` views; `ERR`/`WARN`/`INFO` levels; a large set of checks, each with an ID whose level can be changed; deprecation periods and stability levels; path prefix and filter options |
| [openapi-changes](https://github.com/pb33f/openapi-changes) (pb33f) | Go CLI, Apache-2.0 | Active | Reads specs straight from git (`HEAD~1:openapi.yaml`) and walks a file's git history; interactive terminal UI; offline HTML report with a timeline, change graph and side-by-side/unified diff views; OpenAPI 3.0–3.2 and AsyncAPI 3; rule file toggles `added`/`modified`/`removed` per change type |
| [openapi-diff](https://github.com/OpenAPITools/openapi-diff) (OpenAPITools) | Java CLI, Maven plugin and library, Apache-2.0 | Active | One-word result (`no_changes` / `compatible` / `incompatible`); per-check config properties (e.g. `incompatible.response.enum.increased`); pluggable path matcher; extension diffing via plugins; HTML, Markdown, AsciiDoc, JSON, text |
| [Optic](https://github.com/opticdev/optic) | Node CLI, MIT | **Archived** January 2026 (Optic Labs joined Atlassian) | Breaking-change checks and lint rules in one tool; "forwards-only governance" (rules applied to new and changed parts only); generating and testing specs from captured traffic |
| [Azure openapi-diff](https://github.com/Azure/openapi-diff) (`oad`) | TypeScript CLI, MIT | **Retired** July 2026 | About 50 numbered rules (1000–1050), each with its own docs page (description, cause, example); version-aware rules (a breaking change needs a new `api-version`; a changed spec without a version change is flagged); Azure `x-ms-*` extension rules; Swagger 2.0 |
| [Bump.sh](https://docs.bump.sh/help/changes-management/) | Hosted service, with CLI and GitHub Action | Active | Changelog published with the API docs; changes labelled documentation, structural or breaking; PR comments; `fail_on_breaking`; consumers subscribe by email or RSS; any two releases can be compared through a shareable link. Breaking-change rules aren't documented as configurable |
| [Speakeasy](https://www.speakeasy.com/docs) | SDK generation platform | Active | Computes OpenAPI and SDK diffs internally (per its changelog), but has no documented standalone diff feature |

### What most tools agree on (our baseline)

- A **breaking / non-breaking** classification, usually with a middle "might break" level.
- An **exit code** for CI.
- A **stable ID per check**, so checks can be documented and tuned.
- Matching `/users/{id}` and `/users/{userId}` as the same path.
- At least **JSON** and **HTML** output.

## 2. Ideas we take from other tools

| Idea | Seen in | How we use it |
|---|---|---|
| Read specs from git revisions (`main:openapi.yaml`) without a checkout | openapi-changes | Accepted anywhere a file path is: `api-diff main:openapi.yaml openapi.yaml` (phase 1) |
| Walk a spec's history and show a timeline | openapi-changes | `--history <range>` compares each consecutive pair of commits, and the `explore` report shows the timeline (backlog) |
| Side-by-side, unified and inline diff views | openapi-changes | Options in the `explore` HTML report (phase 4) |
| A one-word result for scripts | openapi-diff | `--state` prints `no-changes`, `compatible` or `breaking` (phase 1) |
| Pluggable path matching | openapi-diff | Configurable matcher, including versioning-aware matching (backlog) |
| A docs page per rule with cause and example | Azure openapi-diff | Generated from rule metadata: `api-diff rules <id>` (see POLICY.md section 13) |
| Version-aware rules | Azure openapi-diff, oasdiff | `version-bump-too-small` and `version-unchanged` (RULES.md section 9) |
| Separate documentation, structural and breaking changes | Bump.sh | Our `docs` / `wire` / `sdk` kinds, plus severity |
| Lint only what changed | Optic | Rule plugins can declare `scope: changed`, so house rules apply to new and changed parts only and legacy parts don't block a PR (backlog) |
| Deprecation periods and stability levels | oasdiff | `operation-removed` options and the `lifecycle` policy section |

**Out of scope:** hosted changelog pages and email/RSS subscriptions (Bump.sh); traffic capture (Optic); AsyncAPI (openapi-changes). The JSON output is enough for someone to build the first two on top.

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

Each usage carries a full path (`POST /orders → requestBody → Order.items[] → LineItem.sku`), so `readOnly`/`writeOnly` and nested `$ref`s resolve per property, not per component. Cycles are handled by memoising on *(component, direction)*.

**Step 3: score each usage, then combine.** Every usage gets its own severity from the rules (`enum-value-added-in-request` → info, `…-in-response` → warn). The finding's severity is the **worst** usage, and the output lists all of them:

```
WARN  enum value 'refunded' added to Order.status            components/schemas/Order (orders.yaml:212)
      used as  out  in 14 operations   → warn  (enum-value-added-in-response)
               in   in  3 operations   → info  (enum-value-added-in-request)
      fix: mark the enum open (x-api-diff: { enum: open }) or split into OrderRequest / OrderResponse
```

Policy overrides apply **per usage**. An override for one path turns off only those usages, and the rest still count.

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

- **Nodes**: every component schema, plus inline schemas keyed by their JSON pointer.
- **Edges**: every `$ref` and subschema, labelled with how it's reached (`property:name`, `items`, `oneOf[i]`, `anyOf[i]`, `allOf[i]`, `additionalProperties`, discriminator mapping) and with `readOnly`/`writeOnly`.
- **Reverse edges**: who refers to me (for working out usages).
- **Tarjan's strongly connected components (SCCs)**, implemented **iteratively** with an explicit stack. A recursive implementation can itself overflow on deep graphs. Each node records `sccId`, whether it's recursive (an SCC of more than one node, **or** a single node with an edge to itself, which Tarjan doesn't flag on its own) and its topological order.

Tarjan gives us the SCCs in reverse topological order, which is exactly the order the later stages need:

| Stage | How the index is used |
|---|---|
| **Cycle validity** | A cycle is *productive* if it passes through at least one `property`, `items` or `additionalProperties` edge, meaning the data actually nests (fine). A cycle made only of `allOf`/`oneOf`/`anyOf`/`$ref` edges (e.g. `A: allOf [$ref A]`) describes nothing valid. It's reported as a spec error instead of looping. |
| **Effective schemas** (allOf merge) | Computed bottom-up in topological order and stored per node. Inside a recursive SCC, a `$ref` that closes a cycle stays a reference and is never expanded. |
| **Diff** | Compares pairs (base node, revision node), cached per pair. If a pair comes up again while it's still being compared, we **assume they're equal** and stop there (the standard way to compare recursive types). Any real difference is still found on the non-cyclic part of the path. Pairs not on a cycle just use the cache. |
| **Usages / direction** | Propagated over the **condensation** (each SCC collapsed to one node). Every member of an SCC reaches every other, so they share one usage set. Directions form a tiny set (`{in, out}`), so propagation always ends. |
| **Impact paths** | No list of every path. Each usage stores **one shortest example path** (found by breadth-first search) and a **count**, e.g. `GET /shapes → 200 → Shape.oneOf[1] Group.children[] → Shape (+11 more paths)`. |
| **Structural hashing** (rename detection, equality, completeness) | A Merkle hash over the condensation. Each recursive SCC is hashed as one unit in a canonical order, so self-referencing schemas get a stable hash. See *Content hashes* below. |
| **Rendering** | Nothing is expanded past a back-edge. It's shown as `↻ Shape (recursive)`. A configurable `--max-depth` limits how deep the output goes, purely for readability. |

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
  "id": "c7f3e1a2",                         // stable hash of kind + locations
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
- finding: c7f3e1a2
  reason: "Only the mobile app sends 'archived', and it's already updated."
  owner: "@orders-team"
  expires: 2027-01-31
```

## 5. Reports by audience

The engine produces one **result object** (JSON with a versioned schema): findings, usages, counts, the semver advice, and where each severity came from. Every report is a **view** over that object, so all reports agree with each other and the specs are parsed only once, however many reports are produced.

### Who reads what

| Report | Reader | The question it answers | Includes | Grouped by | Formats | Where it goes |
|---|---|---|---|---|---|---|
| **`ci`** | The pipeline | Pass or fail? | Findings at or above `--fail-on`, excluding acknowledged ones | Severity | exit code, text, JSON | CI step log, JSON kept as a build artifact |
| **`review`** | PR author and reviewers | What does this PR break, and how do I fix or accept it? | wire + sdk findings with fixes, a collapsed list of docs changes, acknowledged findings marked as such | Root cause (component or operation), worst first | text, HTML | PR comment (text), linked HTML artifact |
| **`changelog`** | API consumers | What changed for me in this release, and what do I need to do? | Plain-language entries: new, changed, deprecated (with sunset dates), removed, and migration notes. Configured exclusions applied (see *Exclusions*), no acknowledgement details, no docs-only changes unless asked | Tag, then operation | HTML, text | Release notes, developer portal |
| **`sdk`** | SDK maintainers | Which generated types or methods change? | sdk findings, a table of old → new type and method names, the SDK semver bump | Generated type / operationId | text, JSON | SDK release PR |
| **`summary`** | Release or product manager | How big and how risky is this release? | Counts by kind and severity, the semver advice, the 5 most serious findings | — | text, JSON | Release checklist, chat |
| **`audit`** | API governance | Are we following our own rules? | Everything, including acknowledged findings (who, why, expiry), expired acknowledgements, `unclassified-change`, and which policy entry set each severity | Rule | JSON, HTML | Governance reviews, dashboards (trends across releases) |
| **`explore`** | Anyone investigating | Show me everything | All findings plus a side-by-side spec view, filters (kind, severity, tag, path), search, recursive schemas shown as `↻` | Interactive | Self-contained HTML (one file, works offline) | CI artifact linked from the `review` comment |

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
- If no source gives a version, the report shows `unknown` and the semver advice is skipped with a notice. It doesn't fail the run.

Each side also records the file name, a SHA-256 of the file, and where its version came from, along with the tool version and a hash of the policy. This makes every report reproducible:

```
api-diff 0.1.0 · policy 3fa2c1e
base      orders.yaml  v1.4.0 (x-api-version)  build 812  commit 9d4a736
revision  orders.yaml  v1.5.0 (x-api-version)  build 845  commit c7f3e1a
advice    major bump needed (2 breaking changes); revision is a minor bump
```

### Output formats

Only three: **`json`**, **`txt`** and **`html`**. Every report supports `json`, and the table lists the others each one supports.

- **`json`**: the full result object with a versioned JSON Schema (`api-diff schema` prints it). This is the stable interface, and anything else (Markdown, SARIF, JUnit, dashboards) is built from it outside the tool.
- **`txt`**: plain text for terminals, CI logs and PR comments (inside a code block). Colour only when writing to a TTY, and `NO_COLOR` is respected.
- **`html`**: a single self-contained file (inline CSS/JS, no network), so it works as a CI artifact or opened locally.

### What's different from existing tools' reports

- **Exclusions for each audience.** Each report applies only the exclusion sets you configure (see *Exclusions*), and `changelog` never shows acknowledgement reasons or owners.
- **Each report stays the right size.** GitHub comments are limited to 65,536 characters, so `review` shows the most serious findings in full, collapses the rest and links to the `explore` HTML artifact for the remainder. It never just cuts off.
- **Comments are updated, not added.** `review` writes a hidden marker so CI edits its own earlier comment, and shows "fixed since last push" and "new since last push".
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

## 6. Phases

| Phase | Deliverable | Done when |
|---|---|---|
| **0. Corpus** | `test/cases/<name>/{base,revision}.yaml` plus `expected.yaml` (the findings we want). Start with about 40 cases covering every row in section 3, plus recursive schemas: one that refers to itself, a union whose member refers back to the base type in a collection, a cycle that passes through three schemas, an invalid `allOf` cycle, and a change deep inside a cycle. Optionally run oasdiff and openapi-diff on each case and record what they say, to compare. | We agree on the expected results. This is where we settle what "breaking" means. |
| **1. Skeleton** | load → model → diff for paths, operations, parameters, request bodies, responses and security. Text and JSON output. `--fail-on`, `--state`, and git revision inputs (`main:openapi.yaml`). | Phase 1 cases pass. |
| **2. Schema engine** | Effective-schema merge (allOf), variance classifier, oneOf/anyOf branch matching, `$ref` root-cause aggregation. | All schema cases pass, and each shared-component change appears once. |
| **3. Policy & CI** | Policy file, acknowledgements, source maps. The `ci` and `review` reports, `summary`. | Usable as a required PR check. |
| **4. Presentation** | The `explore` HTML report, `changelog` (with redaction), `sdk`, rename detection, semver advice, explanations and fixes. | Reviewers prefer it to the output of the tools in section 1. |
| **5. Governance & consumers** | `audit`, custom reports and templates, consumer impact reports (`--uses`). | Release notes and governance reviews use it without manual editing. |

Out of scope at first: **webhooks and callbacks** (if a spec has them, a single `info` notice says they weren't compared, so nothing is skipped silently; the direction model allows them to be added later by flipping direction), Swagger 2.0, external (`http://`) refs, specs split across many files (`--composed`), translations.

## 7. Decisions to make

1. **Language.** Proposal: **TypeScript on Node ≥ 20**, matching `operation-ids` and using `js-yaml` / `jsonc-parser` for position-aware loading (see Performance). Go (like oasdiff and openapi-changes) would produce a single binary, but we'd need our own position-aware YAML handling.
2. **OpenAPI versions.** Proposal: 3.0, 3.1 and 3.2 from the start, using the normalise step.
3. **Default stance on ambiguous changes.** Examples: a new enum value in a response, a new optional request property where the server sets `additionalProperties: false`, a new required response header. Proposal: `warn` by default, and the policy can change it.
4. **Which reports first.** Proposal: `ci` and `review` first (phase 3), since they make the tool usable as a PR check. Is there an audience in section 5 that matters more to you, or one that's missing?
5. **Name.** `api-diff` is a placeholder.

## 8. Further ideas (backlog)

Ideas aimed at large enterprise specs. None of the tools in section 1 document these, as far as we found. Each idea has a rough value/effort rating so we can pick from it later. **★** marks the ones I'd do first.

### Evidence and accuracy

| Idea | What it does | Value / effort |
|---|---|---|
| **★ Counter-example payloads** | For each `wire` finding, generate a small JSON value that the old schema accepts and the new one rejects (for requests) or the other way round (for responses), e.g. `{"status": "archived"}`. Shown in reports and exportable as test fixtures. Proof that the change really breaks something, instead of only a rule saying so. | high / medium |
| **Re-validate examples** | Check every `example`/`examples` in the base against the revision schema. An old example that no longer validates is a concrete breaking change, even if no rule caught it. | high / low |
| **Constraint maths** | Treat `minimum`/`maximum`/`multipleOf`, `minLength`/`maxLength` and `minItems`/`maxItems` as intervals, so "narrowed" vs "widened" is exact. Compare simple `pattern` regexes by converting them to automata, and fall back to "can't tell" (`warn`) for complex ones. | medium / medium |
| **Versioning-scheme aware matching** | Match `/v1/orders` in the base with `/v2/orders` in the revision, or match media-type versions (`application/vnd.acme.v2+json`), when a new version is published alongside the old one. Configured with a path or media-type template. | medium / low |

### Large specs and noise

| Idea | What it does | Value / effort |
|---|---|---|
| **★ Bulk-change collapsing** | The same change made in many places without a shared `$ref` (e.g. a new `X-Request-Id` header added inline to 300 operations) is grouped into **one** finding: "header added to 300 operations (list)". Detected by grouping change records by kind and normalised value. This extends root-cause grouping to copy-pasted specs. | high / low |
| **★ Cached base index** | Store the parsed base's index and hashes in a content-addressed cache, keyed by the file's SHA-256. In CI the base (main) is usually unchanged between runs, so only the revision is parsed. | high / low |
| **Spec quality side-report** | The hashes already find identical inline schemas, so list them ("this object appears inline 42 times; consider a component"). They're the root cause of the bulk changes above. | medium / low |
| **Portfolio mode** | Compare many specs in one run, including shared schema files (`common/errors.yaml`) that several APIs reference. A change to a shared file reports **which APIs** it affects. This needs external file `$ref`s, which are out of scope for now. | high / high |

### Ownership and governance

| Idea | What it does | Value / effort |
|---|---|---|
| **★ Ownership routing** | Read owners from `x-owner` on operations or tags, or from a CODEOWNERS-style file mapping paths to teams. Each finding lists the owning teams, and reports can be split per team ("findings for @payments"). An acknowledgement can require an owner of the affected operations. | high / medium |
| **Git blame for findings** | Using the source maps, find the commit and author that introduced each change in the revision file. Useful when one PR or release covers many commits. | medium / low |
| **Deprecation ledger** | A standing report of everything deprecated: since which version, the sunset date, and overdue removals. It also checks that deprecated operations document the `Deprecation` and `Sunset` response headers (RFC 9745 / RFC 8594). | medium / low |
| **Breaking-change budget** | A policy limit per release or per audience, e.g. "at most 0 breaking changes for `partner`, 3 for `internal`". | low / low |
| **Usage-weighted severity** | Import call counts per operation (from gateway logs or analytics, as a simple CSV/JSON) and use them to rank findings or lower their severity: "removed operation had 0 calls in 30 days". | high / medium |

### Developer experience

| Idea | What it does | Value / effort |
|---|---|---|
| **Editor integration (LSP)** | Run the engine as a language server against `main`, so breaking changes show up as editor warnings while the spec is edited, before a PR exists. The engine is pure functions, so this is mostly a wrapper. | high / medium |
| **`api-diff explain <finding-id>`** | Prints the full reasoning for one finding: the rule, the usages, where the severity came from, the counter-example and the fix. | medium / low |
| **Rule plugins** | Custom rules written in TypeScript against the change-record API, tested with the same `base/revision/expected` corpus format as the built-in rules. Covers house rules such as "every list operation must keep its pagination parameters". | high / medium |
| **History mode** | `--history v1.0..HEAD` compares each consecutive pair of commits that touched the spec, and the `explore` report shows a timeline of when each change landed (idea from openapi-changes). Cheap with the cached index. | medium / medium |
| **Lint only what changed** | Rule plugins can declare `scope: changed`, so house rules apply only to new and changed parts and legacy parts don't block a PR (idea from Optic's forwards-only governance). | high / low |
| **Watch mode** | `api-diff --watch` re-runs on save. Cheap with the cached base index. | low / low |

### Enterprise operation

| Idea | What it does | Value / effort |
|---|---|---|
| **Offline and deterministic** | No network calls, no telemetry, byte-identical output for the same inputs. Works in air-gapped CI. | required / low |
| **Example value redaction** | `example` values can contain real customer data. A config option masks example values in reports (keeps their type and shape). | medium / low |
| **Signed reports** | The recorded hashes (files, policy, tool) plus a hash of the report, optionally signed, so audit records can be shown to be unchanged. | low / medium |
| **Memory-lean index** | Intern strings and store graph edges in typed arrays, so very large specs (50 MB+) fit in CI runners with little memory. | medium / medium |

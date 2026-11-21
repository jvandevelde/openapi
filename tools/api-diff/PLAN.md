# api-diff: plan

Status: **planning**. No code yet. This directory has no `Makefile`, so the root `make` ignores it for now.

`api-diff` compares two OpenAPI documents (a *base* and a *revision*), finds what changed, and decides which changes break clients. It does the same job as [oasdiff](https://github.com/oasdiff/oasdiff), but we own it. That means we decide what counts as breaking and how results are shown, and we can change either without forking someone else's project.

---

## 1. What oasdiff does well (and we should keep)

- Three views of one comparison: **diff** (everything), **changelog** (changes clients can see), **breaking** (changes that break clients).
- Three severity levels: `ERR` (definitely breaking), `WARN` (might break, can't tell from the spec), `INFO` (safe).
- `--fail-on <level>` for CI exit codes.
- A stable ID for every check (e.g. `api-security-scope-removed`), so you can change a check's level or turn it off.
- Lifecycle rules: a deprecation period before removal, and stability levels (`draft`/`alpha`/`beta`/`stable`).
- Path tools: filter by path, add or strip prefixes, and treat a renamed path parameter as the same endpoint.
- Output as JSON, YAML, Markdown, HTML, JUnit and GitHub Actions annotations.

## 2. Where oasdiff falls short (and how we can do better)

| # | oasdiff today | Our approach |
|---|---|---|
| 1 | **Hundreds of hand-written checks.** Each keyword in each position (request, response, parameter) is its own rule, so gaps are easy to miss and behaviour is uneven. | **Variance-based classification.** Every schema change is first labelled *widened*, *narrowed*, *incompatible* or *neutral*. Then its **position** decides whether it breaks: data clients **send** (requests, parameters) may only widen, and data clients **receive** (responses) may only narrow. One core rule covers most cases. Named rules stay as overrides and for non-schema changes. |
| 2 | **A shared `$ref` change is repeated** once for every operation that uses it, which buries the real change. | **Report root causes.** One finding per changed component, with an *impact* list of the affected operations and positions. Renderers can expand or collapse it. |
| 3 | **Limited customisation.** One flat `check-id level` file, plus ignore files that match on free-text descriptions. | **Policy file.** Severity per rule, scoped by path, tag, operation, stability level or `x-` extension, with conditions. **Acknowledgements** point at a stable finding ID and carry a reason, owner and expiry date. Expired acknowledgements fail again. |
| 4 | **No source locations.** Findings name an endpoint, not a file and line. | **Source maps.** Every finding has a JSON Pointer and a file/line/column in **both** documents, which feeds PR inline comments, SARIF and links in the HTML report. |
| 5 | **Fixed message text and plain renderers.** | **Typed change records → separate renderers.** The engine never writes prose. Renderers for terminal, Markdown (PR comment with collapsible sections), HTML (side-by-side, filterable), JSON (versioned schema), SARIF and GitHub annotations. |
| 6 | **Known gaps:** no checks for parameters that use `content` instead of `schema`. `$dynamicRef` isn't resolved. 3.2 support is partial. | Model `content` parameters from the start. Normalise 3.0/3.1/3.2 into one internal model, so `nullable: true` and `type: [x, "null"]` don't show up as a diff. |
| 7 | **allOf is approximate** unless you pass `--flatten-allof`. oneOf/anyOf changes often come out as WARN. | Always compare **effective** schemas (allOf merged), and keep the original structure for display. Match oneOf/anyOf branches by discriminator value, `$ref` target or structural similarity, not by array index. |
| 8 | **Renames read as remove + add.** | **Rename detection:** an operation with the same `operationId` at a new path, a component with a new name but the same structure, a renamed path parameter. Reported as one *renamed* change. |
| 9 | Says *what* broke. | Each finding also says **why** it breaks (an example client that fails) and **how to fix** it (e.g. "make the new property optional", "deprecate first"). |
| 10 | Version-bump checking is a single flag. | **Semver advice:** the bump the changes need (major/minor/patch), compared with `info.version`. |

## 3. Architecture

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

Policy overrides apply **per usage**. An override on `/internal/**` turns off only those usages, and the rest still count.

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
- **`x-` extensions** can matter to code generators (e.g. `x-enum-varnames`, `x-go-type`). The policy file says which kind each extension is, e.g. `extensions: { x-enum-varnames: sdk, x-internal: wire }`, and the rest default to `docs`.

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
  - match: { path: "/internal/**" }
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

## 4. Phases

| Phase | Deliverable | Done when |
|---|---|---|
| **0. Corpus** | `test/cases/<name>/{base,revision}.yaml` plus `expected.yaml` (the findings we want). Start with about 40 cases covering every row in section 2, plus recursive schemas: one that refers to itself, a union whose member refers back to the base type in a collection, a cycle that passes through three schemas, an invalid `allOf` cycle, and a change deep inside a cycle. Optionally record what oasdiff says for each case to compare. | We agree on the expected results. This is where we settle what "breaking" means. |
| **1. Skeleton** | load → model → diff for paths, operations, parameters, request bodies, responses and security. Text and JSON output. `--fail-on`. | Phase 1 cases pass. |
| **2. Schema engine** | Effective-schema merge (allOf), variance classifier, oneOf/anyOf branch matching, `$ref` root-cause aggregation. | All schema cases pass, and each shared-component change appears once. |
| **3. Policy & CI** | Policy file, acknowledgements, source maps, Markdown, SARIF and GitHub annotations. | Usable as a required PR check. |
| **4. Presentation** | HTML report, rename detection, semver advice, explanations and fixes. | Reviewers prefer it to oasdiff output. |

Out of scope at first: **webhooks and callbacks** (if a spec has them, a single `info` notice says they weren't compared, so nothing is skipped silently; the direction model allows them to be added later by flipping direction), Swagger 2.0, external (`http://`) refs, specs split across many files (`--composed`), translations.

## 5. Decisions to make

1. **Language.** Proposal: **TypeScript on Node ≥ 20**, matching `operation-ids` and using `js-yaml` / `jsonc-parser` for position-aware loading (see Performance). Go would match oasdiff and produce a single binary, but we'd need our own position-aware YAML handling.
2. **OpenAPI versions.** Proposal: 3.0, 3.1 and 3.2 from the start, using the normalise step.
3. **Default stance on ambiguous changes.** Examples: a new enum value in a response, a new optional request property where the server sets `additionalProperties: false`, a new required response header. Proposal: `warn` by default, and the policy can change it.
4. **Main audience for the output.** PR reviewers (Markdown/annotations), API consumers (changelog/HTML) or CI (exit code/SARIF)? This sets which renderers come first.
5. **Name.** `api-diff` is a placeholder.

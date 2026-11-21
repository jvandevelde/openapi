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
| 6 | **Known gaps:** no checks for callbacks, or for parameters that use `content` instead of `schema`. `$dynamicRef` isn't resolved. 3.2 support is partial. | Model callbacks, webhooks and `content` parameters from the start. Normalise 3.0/3.1/3.2 into one internal model, so `nullable: true` and `type: [x, "null"]` don't show up as a diff. |
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
3. **model**: operations keyed by `METHOD normalised-path`, plus webhooks, callbacks, components and security schemes.
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
| **0. Corpus** | `test/cases/<name>/{base,revision}.yaml` plus `expected.yaml` (the findings we want). Start with about 40 cases covering every row in section 2. Optionally record what oasdiff says for each case to compare. | We agree on the expected results. This is where we settle what "breaking" means. |
| **1. Skeleton** | load → model → diff for paths, operations, parameters, request bodies, responses and security. Text and JSON output. `--fail-on`. | Phase 1 cases pass. |
| **2. Schema engine** | Effective-schema merge (allOf), variance classifier, oneOf/anyOf branch matching, `$ref` root-cause aggregation. | All schema cases pass, and each shared-component change appears once. |
| **3. Policy & CI** | Policy file, acknowledgements, source maps, Markdown, SARIF and GitHub annotations. | Usable as a required PR check. |
| **4. Presentation** | HTML report, rename detection, semver advice, explanations and fixes. | Reviewers prefer it to oasdiff output. |

Out of scope at first: Swagger 2.0, external (`http://`) refs, specs split across many files (`--composed`), translations.

## 5. Decisions to make

1. **Language.** Proposal: **TypeScript on Node ≥ 20**, matching `operation-ids` and using `js-yaml` / `jsonc-parser` for position-aware loading (see Performance). Go would match oasdiff and produce a single binary, but we'd need our own position-aware YAML handling.
2. **OpenAPI versions.** Proposal: 3.0, 3.1 and 3.2 from the start, using the normalise step.
3. **Default stance on ambiguous changes.** Examples: a new enum value in a response, a new optional request property where the server sets `additionalProperties: false`, a new required response header. Proposal: `warn` by default, and the policy can change it.
4. **Main audience for the output.** PR reviewers (Markdown/annotations), API consumers (changelog/HTML) or CI (exit code/SARIF)? This sets which renderers come first.
5. **Name.** `api-diff` is a placeholder.

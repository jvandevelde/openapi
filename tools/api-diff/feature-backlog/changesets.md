# Changesets: group related changes

| | |
|---|---|
| **Status** | Idea |
| **Summary** | Group findings that belong to one logical change (a new property whose type brings its own graph of schemas, a new resource, a field replaced by another, an auth rollout) into a named changeset: from the `$ref` graph alone with base and revision, and from commits and PRs when git history is available. |
| **Value / effort** | high / medium |
| **Plan entry** | [PLAN.md section 8, *Large specs and noise*](../PLAN.md#large-specs-and-noise) |

## Background

Existing grouping collapses **one change seen in many places**: root-cause aggregation (one finding per changed component, with an impact list), [bulk-change collapsing](bulk-change-collapsing.md) (the same edit in 3+ operations), [request/response merging](merge-request-response-findings.md) in the reports, and rename detection. Nothing groups **different changes that belong together**.

Checked with api-diff 0.12.0. The revision adds `Pet.owner: $ref Owner`, where `Owner` brings `Contact`, a `Tier` enum and `Address`, and adds `GET /owners/{id}` returning `Owner`:

```
property-added-optional-in-request   info  #/components/schemas/Pet  new optional property 'owner'
property-added-optional-in-response  info  #/components/schemas/Pet  new optional property 'owner'
operation-added                      info  GET /owners/{id}
```

- The four new schemas produce no findings: `component-added` fires only for components nothing uses. The new graph is absorbed into its attachment points, which avoids noise but hides what was added.
- The changelog says "new optional property 'owner'" without saying what an `Owner` is, and lists `GET /owners/{id}` in another section.
- The reverse (removing the feature) gives `property-removed` (error in responses) and `operation-removed` (error) as unrelated findings.

## Changes that would benefit

| Pattern | Today | What links the parts |
|---|---|---|
| New feature graph | property added + operation added; new schemas invisible | both attach to the same new subgraph |
| Feature removed | property removed + operation removed | the same subgraph disappears |
| New resource (tag, CRUD operations, schemas) | N × `operation-added`, `tag-added` | same tag and path prefix, shared new schemas |
| Field replaced (`ownerName` deprecated, `owner` added) | `deprecated-added` + `property-added-optional` | same parent; description often names the replacement |
| Type promoted (`address: string` → `$ref Address`) | `type-changed` | old leaf replaced by a new subgraph at the same path |
| New union variant | branch (with its mapping value) + enum value | see [Discriminated-union variants](discriminated-union-variants.md) |
| Pagination added | `limit`/`cursor` params on N operations, responses wrapped in `Page<T>` | same operations, one new envelope schema |
| Error model changed | many response status and body changes | one new `Problem` schema reached from many responses |
| Auth rollout | new scheme + N × `security-requirement-added` | all reference the same new scheme |
| v2 alongside v1 | many `operation-added` under `/v2` | see [Versioning-scheme aware matching](versioning-scheme-matching.md) |

## What it would do

### From base and revision only

1. **New and removed subgraphs (exact).** Using the schema index on both sides (nodes, `$ref` edges, SCCs, content hashes): mark nodes that are new in the revision or gone from the base, after rename detection. Each connected component of new nodes is a *new subgraph*; each edge from an existing node into it is an *attachment point*. A changeset is the subgraph plus the findings at its attachment points. The same for removed subgraphs.
2. **Shared new references (exact).** Findings whose change introduces, or stops using, the same new or removed component, security scheme or tag.
3. **Heuristics (labelled with a confidence):** several changes to one anchor; related names (`Owner`, `OwnerTier`, `/owners`); same tag or path prefix; deprecate-and-replace pairs under one parent (stronger when the description names the new property); same `x-owner` as a tiebreak.

A diff shows only the end state, not intent: two unrelated features touching `Pet`, or a feature that only reuses existing types, can't be separated or joined by structure alone.

### With git history

`api-diff history` already compares each commit with the one before it and marks reverted changes.

- **Commits and PRs as author-made groups**: findings from the same commit, or the same merged PR (first-parent mainline commits), named from the commit message or PR title. Reverted changes drop out.
- **Mapping net findings to commits**: for a release spanning many commits, link each base → revision finding to the commit that introduced it, using the source maps ([Git blame for findings](git-blame-for-findings.md)).
- **Limits**: a commit can mix unrelated work, a feature can span many commits, and squash merges lose detail.

### Combined

Commits and PRs propose and name groups; the graph joins groups that touch the same new subgraph and flags commits whose changes have no structural link. Without git, graph grouping plus labelled heuristics.

### Output

- A changeset is a **display grouping**, like bulk collapsing: findings, IDs, severities and acknowledgements stay per finding, and a changeset's severity is its worst member's. A wrong grouping must never hide a breaking change.
- `review` and `explore`: a changeset entry ("Adds `Owner` (4 new schemas) · used by `Pet.owner`, `GET /owners/{id}`") with its findings folded inside.
- `changelog`: one entry per changeset, describing new types briefly (their properties and enums), so consumers learn what was added.
- JSON: a `changesets` list with members, how each was grouped (`graph`, `reference`, `heuristic`, `commit`) and the confidence.

## Options

- **Graph only**: exact and offline, covers the most common case (new or removed feature graphs). No names beyond the root schema's.
- **Graph + heuristics**: wider, but needs confidence labels and a way to turn heuristics off.
- **Git first**: closest to intent, needs history; weak on squash merges and mixed commits.
- **Combined** (as above).

## Related

- [Bulk-change collapsing](bulk-change-collapsing.md), [One entry per change in requests and responses](merge-request-response-findings.md): grouping one change.
- [Discriminated-union variants as one change](discriminated-union-variants.md): one specific changeset.
- [Git blame for findings](git-blame-for-findings.md): needed to map net findings to commits.
- [Spec quality side-report](spec-quality-side-report.md): uses the same content hashes.

## Open questions

- Should new subgraphs also get findings of their own (e.g. `component-added` for used components, folded in the changeset), or stay described only in the changeset?
- Which heuristics are on by default, and how is confidence shown?
- Can a finding belong to more than one changeset (an operation added for two features)?
- In the `ci` report, are changesets shown, or only findings?
- Should a policy or hint let authors name or declare changesets explicitly (e.g. `x-api-diff: { changeset: pet-owners }`)?

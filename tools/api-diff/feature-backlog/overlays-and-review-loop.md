# Overlays, a review file and a review loop

| | |
|---|---|
| **Status** | Idea: brainstormed on 2026-11-22 and 2026-11-23, not scheduled |
| **Summary** | Use OpenAPI Overlays to keep tooling hints out of the published spec and to diff the published view; replace the acknowledgements file with a typed review file; let reviewers annotate findings in the CLI or HTML report and feed their decisions into later runs. |
| **Value / effort** | high / high (can be built in the steps in [Suggested order](#11-suggested-order)) |
| **Plan entry** | [PLAN.md section 8, *Review and publishing*](../PLAN.md#review-and-publishing) |

This page collects a brainstorm. The choices marked **Leaning** were picked during it, but none of them is a decision yet. When work starts, each one is asked again and recorded in [decision-records/](../decision-records/README.md).

## Contents

1. [Why](#1-why)
2. [Overlay 1.2 in brief](#2-overlay-12-in-brief)
3. [Uses of overlays](#3-uses-of-overlays)
4. [The review file](#4-the-review-file)
5. [The review loop](#5-the-review-loop)
6. [Governance](#6-governance)
7. [Mechanics](#7-mechanics)
8. [What doesn't fit: acknowledgements as overlays](#8-what-doesnt-fit-acknowledgements-as-overlays)
9. [Choices so far](#9-choices-so-far)
10. [Open questions](#10-open-questions)
11. [Suggested order](#11-suggested-order)
12. [References](#12-references)

## 1. Why

- **Tooling hints end up in the published spec.** `x-api-diff` hints (`enum: open`, `ignore`, `rules`) and some policy-read extensions such as `x-internal` are written in the source spec, so they are published unless someone strips them.
- **Reviewer decisions have nowhere to go except acknowledgements.** Lasting facts ("this enum is open", "this operation is beta") and notes for clients ("use `status_v2`") have no home of their own.
- **Anyone who edits the spec can lower a severity inline**, and nothing shows that it happened.
- **api-diff compares the source, not what is published**, so a change to the publishing step (for example, a strip list that stops removing an internal path) is never reported.

The deciding difference: **an overlay describes a document; an acknowledgement describes a diff.** Lasting facts about nodes fit overlays. Decisions about one change don't.

## 2. Overlay 1.2 in brief

Read from the [Overlay 1.2.0 specification](https://spec.openapis.org/overlay/v1.2.0.html) (released 2026-09-22) on 2026-11-23.

| Version | Released | What it added |
|---|---|---|
| 1.0.0 | 2024-10-17 | `overlay`, `info`, `extends`, `actions` with `target`, `update`, `remove` |
| 1.1.0 | 2026-01 | `copy` action, `info.description`, updates and removals of primitive values, RFC 9535 JSONPath required |
| 1.2.0 | 2026-09-22 | Reusable actions (`components.actions`, referenced from `actions` with `$ref` + `target`), `$self`, clearer `extends` and base-URI rules, no fragments in `$self` or `extends` |

Behaviour that matters here:

- **`update` on an object** merges recursively. For a property on both sides: a primitive replaces, arrays are **concatenated**, objects merge, and any other combination is an error. On an array target the value is appended; on a primitive target it replaces. Nodes selected by one target must be all objects, all arrays or all primitives.
- **Precedence inside an action:** `remove: true` beats `update` and `copy`; `update` beats `copy`.
- **Order:** actions apply in sequence, each to the result of the previous one.
- **A target that matches nothing** "succeeds without changing the target document".
- **JSONPath:** tools "MUST fully implement RFC9535", and documents must not use tool-specific extensions.
- **Several files:** not covered. Without `extends`, tooling decides which description(s) an overlay applies to; `$ref`-following isn't mentioned. `extends` is an identifier, matched against a description's `$self` if it has one.
- **Reusable actions:** a `components.actions` entry has `fields` (an action without `target`). A reference gives `$ref` and `target`, and its `description` is used instead of the reusable action's. The spec says references "MAY" override other fields but defines only `target` and `description`, so tools are likely to differ.
- **Extensions:** `x-` fields are allowed on the overlay, actions, reusable actions and references. `x-oai-` and `x-oas-` are reserved.
- Comments in YAML may be lost when actions are applied.

## 3. Uses of overlays

### 3.1 Strip tooling extensions from the published spec

A publishing step that any Overlay tool can apply:

```yaml
overlay: 1.2.0
info: { title: Strip tooling extensions, version: 1.0.0 }
actions:
  - target: $..['x-api-diff']
    remove: true
  - target: $.paths.*[?@['x-internal'] == true]
    remove: true
```

`api-diff overlay strip` could generate this from the policy, which already knows which extensions api-diff reads and which exclusion sets exist, so the list stays in sync. Not everything api-diff reads is private (`x-sunset` and `x-deprecated-since` are probably meant for clients), so the generator needs to know which extensions are tooling-only. A self-check can assert that none is left after stripping.

### 3.2 Hints overlay: keep `x-api-diff` out of the source spec

`api-diff --overlay hints.overlay.yaml` (or an `overlays` list in the policy) applies an overlay at load time. The hints it adds behave **exactly like inline hints**: same scoping, same precedence slot, same `spec-invalid` validation. The spec stays clean, and the overlay can have its own owner (section 6).

### 3.3 Diff the published view

Apply the publishing overlay to both sides before comparing: `api-diff --overlay public.overlay.yaml main:spec.yaml spec.yaml`. The result is what external clients see, and changes that come only from the overlay are reported. Exclusion sets cover part of this today but can't see overlay-only changes.

- **One overlay per audience** (`public`, `partner`) gives one view per audience and per-audience changelogs, an alternative to tagging findings with exclusion sets.
- **Target growth warnings:** a wildcard target that matches more nodes than on the base is worth a notice: "new operation `POST /orders/bulk` matches `x-internal` and will be stripped from the public spec."

### 3.4 Other uses

- **Preview a proposed change:** `api-diff spec.yaml spec.yaml+proposal.overlay.yaml`, so a designer sees the impact before the spec is edited. A small addition to the input syntax.
- **Third-party specs:** add hints and stability levels to a spec you can't edit.
- **Golden test cases:** a case could be `base.yaml` plus `change.overlay.yaml` instead of two full files. Shorter but harder to read; only for big fixtures.
- **`operation-ids`:** an `--overlay out.yaml` mode that writes the missing `operationId`s as an overlay instead of rewriting the spec. (A separate tool; noted here because the idea came up here.)

## 4. The review file

**Leaning:** widen `api-diff.ack.yaml` into a typed `api-diff.review.yaml` for decisions about changes.

```yaml
# api-diff.review.yaml
version: 1
entries:
  - type: ack
    finding: c7f3e1a2b4d6
    reason: "Only the mobile app sends 'archived', and it's already updated."
    owner: "@orders-team"
    expires: 2027-01-31
  - type: note
    finding: 9b1e44c0d2aa
    for: clients            # picked up by changelog and migration notes
    text: "Use status_v2; status is removed in v3."
  - type: seen
    finding: 51f0a9e3c7b2
    by: "@reviewer"
```

- A bare list with no `type` reads as acks, so `api-diff.ack.yaml` keeps working unchanged.
- Strict validation, like the ack file: unknown keys and duplicate `(type, finding)` pairs are errors; only `ack` needs `expires`.
- One stale check for every type: `review-entry-stale` (info). `acknowledgement-stale` becomes a special case of it, or stays as an alias.
- Rejected during the brainstorm: acks plus a separate notes file (two files keyed by finding ID with the same stale logic), and notes in overlay action descriptions (a note is about a change, not a node).

### How long entries last

Finding IDs come from a base → revision diff. Once a PR merges, the base contains the change, the finding is gone and its entries go stale. That's fine for `seen` and arguably for `ack`, but notes matter most later, when `changelog` compares release tags.

**Leaning:** notes outlive the diff. When an entry is applied it also stores the finding's rule and pointer; `changelog` over `v1..v2` matches notes by rule and pointer when the ID differs. `api-diff review prune` removes stale `seen` and `ack` entries. To check first: whether the same change keeps its finding ID in a longer range (it should if the ID is keyed only by the change, not when it is merged with other changes on the same node). `history`'s net comparison can answer this.

## 5. The review loop

1. **Run:** findings, each with an ID, a pointer, affected operations and `severitySource`.
2. **Review:** a reviewer makes one or more decisions per finding.
3. **Save:** decisions about the change go to the review file; lasting facts about nodes go to the hints overlay.
4. **Next run:** both are loaded. Findings with a decision are shown as reviewed; new or changed ones as unreviewed.

### Decisions a reviewer can make

| Decision | Applies to | Saved to |
|---|---|---|
| Accept this change (reason, owner, expiry) | the change | review file `ack` |
| Note for clients | the change | review file `note` |
| Seen, no action needed | the change | review file `seen` |
| This enum is open | the schema | overlay: `x-api-diff: { enum: open }` |
| A different severity here | a node, operations or a group | overlay `rules` hint, or a suggested policy override |
| This is draft or beta | the operation | overlay: `x-stability-level` |
| This is internal | the operation or schema | overlay: the exclusion set's extension |
| "The rule got it wrong" | the tool | a link to report a rule bug, plus an ack meanwhile |

"A different severity" needs a scope, and each step up saves to a different place: this node (overlay at the finding's pointer) → the affected operations (a hint on each; it reaches the shared components they use) → matching operations (an overlay with a filter target) → everywhere (suggest a policy edit, not an overlay).

### One decision format, two UIs

**Leaning:** the CLI and the HTML report both produce the same `decisions.json`, and a single `api-diff review apply decisions.json` writes the review file and the hints overlay.

- **CLI:** `api-diff review` steps through unreviewed findings (`[a]ck [n]ote [s]een [o]pen-enum [l]evel [k]skip`); `api-diff annotate <id> …` does one finding at a time for scripts.
- **HTML:** buttons per finding, pending decisions kept in the page, then "Download decisions" or "Copy command". The static report can't run the engine or write files, which is why `apply` is a separate step. It stays offline and deterministic.
- **PR comments** (`/api-diff ack c7f3e1a2b4d6 "reason"`) can come later as a third producer of decisions. They need an `issue_comment` workflow with write access (not available for fork PRs) and a check that the commenter may decide; `ci/github-comment.ts` only posts today.

What `apply` does:

- **Node facts first, then re-diff, then change entries.** Changing a severity can split a finding or change its ID (see the overrides decision record), so an ack written in the same pass could be stale at once. `apply` applies the overlay in memory, runs the diff again and writes acks and notes against the new IDs. It can also say "this no longer needs acknowledging".
- **Uses Overlay 1.2 reusable actions** (leaning): one reusable action per hint kind, one reference per finding, the reason in the reference's `description`, and provenance in `x-api-diff: { finding, rule, pointer, by }` on the reference. It avoids overriding `update`/`remove` on references, where tools may differ.
- **Findings in `$ref`'d files:** with entry-file-only targets (section 7) there is no target for them, so `apply` prints the inline hint to add, with its reason, and still writes any ack or note (leaning).
- **Keeps comments.** js-yaml drops comments, so `apply` appends entries as text, or uses the `yaml` package's document API for editing only (it was rejected for parsing because it's about 10× slower, but these files are small).
- **Reports leftovers:** finding IDs in `decisions.json` that aren't in the current run (an old HTML report) are listed, not dropped.
- **Who decided:** from the git config in the CLI, asked once in the HTML report; optional, since git records who committed.
- **Bulk decisions** (for example "seen all info findings") show their scope before applying.

### Review state

Each finding gets a status: unreviewed, acknowledged, annotated, noted or seen. The `review` report leads with "4 unreviewed" and groups findings by status. An optional `--fail-on unreviewed` asks someone to *look* at every change, not to fix it, which fits [the report-not-gate decision](../decision-records/2026-11-22T0653-report-not-gate.md). It is off by default.

## 6. Governance

Overlays and the review file make severity decisions easier, so they also need to be visible and owned.

| File | Decides | Typical owner |
|---|---|---|
| spec | the API | API team |
| `api-diff.yaml` | team-wide rules | platform or governance |
| hints overlay | lasting facts about nodes, often lowering severities | governance, or the API team with limits |
| `api-diff.review.yaml` | acks, notes, seen | reviewers of the PR |

The tool doesn't enforce ownership: CODEOWNERS and required reviews on these files do. api-diff makes every decision visible and traceable.

- **Weakening vs strengthening.** Lowering a severity, `ignore`, `enum: open`, marking something draft, beta or internal, and acks weaken; raising a severity, `seen` and notes don't. Governance only needs to watch the first kind.
- **Reasons required for weakening** (leaning, as the default): a weakening overlay action needs a `description`; a weakening inline hint needs a reason, e.g. `x-api-diff: { rules: {...}, reason: "..." }`. A missing reason is a finding. `governance.inline-hints: allow | strengthen-only | deny` lets strict teams push weakening into the overlay; `allow` stays the default.
- **Severity floors** (later): `operation-removed: { severity: error, floor: warn }`, so hints and overrides can't go below a level. Acks are unaffected.
- **Report what a config change does.** A PR that only edits the policy, overlay or review file has no spec diff. Compare the changes pending release (last release tag → HEAD, falling back to the merge base) with the old and the new config, and report findings whose severity, exclusion or ack status moved: "this PR's overlay lowers 3 pending findings to `info` and hides 1 from the public changelog" (leaning).
- **Which config to trust when gating:** the PR's own files by default. `--config-from base` reads the policy and overlay from the base branch and only the review file from the PR, so a PR can't lower its own severities. An ack's owner can already be required to own the affected operations (`acknowledgements.require-owner`, built in M9 with [ownership routing](ownership-routing.md)); the review file's `ack` entries would keep that check.
- **Audit view:** every active weakening and its source (inline hint, overlay action and reason, override, ack) grouped by rule and owner; acks expiring soon; weakenings without a reason; hint conflicts; stale entries. `severitySource` gains the overlay action and review entry.
- **Layering for larger orgs:** an org policy and overlay, then team overlays, applied in a fixed order, with floors from the org policy last. This leads towards portfolio mode, which is out of scope for now.

## 7. Mechanics

### Where overlays apply

```
parse files → apply overlays → resolve $refs → normalise → index/hash → diff → classify (hints, overrides, acks)
```

- After parsing, before `$ref` resolution: overlays act on documents as written, like other overlay tools. Hashing, normalising and "changes to `x-api-diff` aren't reported" work unchanged.
- **Positions:** the overlay is parsed with the same position-aware loader. If `update` inserts the overlay's own parsed objects (not copies), their entries in the positions `WeakMap` already point into the overlay file. What's missing is which file a container came from: a container → file map, or a file field next to the offsets. Findings inside overlay-added content then point at the overlay, and `spec-invalid` lands on the action that added the hint. Merged objects keep spec positions for spec keys and overlay positions for added keys.

### Targets

- **Entry file only, for every overlay** (leaning). This matches other overlay tools and the spec's single-document model. Nodes in `$ref`'d files can't be targeted; see the `apply` fallback in section 5. Rejected during the brainstorm: targets that follow `$ref`s into other files (friendlier for hints but needs a custom JSONPath walk, and a shared node changes everywhere), and one overlay per file (precise but many files).
- **JSONPath: a subset now, full RFC 9535 later** (leaning). Supported: normalized paths (`$['paths']['/orders']['get']`, which `apply` writes), wildcards, `..` and simple filters (`[?@['x-internal'] == true]`). Anything else is rejected as `overlay-invalid: unsupported JSONPath feature 'match()'`, never misread. Documented as a partial implementation, since Overlay 1.1+ requires full RFC 9535. The RFC's compliance test suite can provide fixtures for the subset now and for full support later.

### Roles: which side gets which overlay

**Leaning:** each overlay has a role, `overlays: [{ file, role: hints | view }]` in the policy, `hints` by default.

| Role | Base gets | Revision gets | Why |
|---|---|---|---|
| `hints` | the working tree's overlay | the working tree's overlay | like inline hints counting on either side: a new hint applies to the old side too |
| `view` | its own revision's overlay (from git) | its own revision's overlay | diff what was really published at each point |

Changes that come only from a `view` overlay are reported, because the post-overlay hashes differ. Changes that come only from a `hints` overlay aren't, because `x-api-diff` isn't compared.

### Semantics to pin down

- Follow the spec: array updates append or concatenate, never replace. Document it rather than invent different behaviour.
- Read Overlay 1.0, 1.1 and 1.2; write 1.2.0. Implement `copy` and reusable actions when reading.
- Actions apply in file order; overlays in the order given.
- **Target matches nothing:** `overlay-target-unmatched`, `info` for `view` overlays and `warn` for `hints` overlays. A notice only; the spec says the action succeeds. Rename detection can suggest a new target (`api-diff overlay fix`).
- **Overlay hint vs inline hint on the same key:** the overlay wins, as overlays always do, with a notice that quotes both.
- **`extends`:** treated as an identifier and matched loosely against the entry file; a mismatch is a warning.
- **Merge type mismatches** are an overlay error (exit 2), like other invalid config.
- **`api-diff overlay extract`:** moves inline `x-api-diff` hints into a hints overlay, for teams adopting it.

### Cost, caching and tests

- Applying actions is about one tree walk each, cheap next to parsing (about 0.5 s for an 8 MB file); `..` and filter targets on big specs are the main cost.
- The `--cache-dir` key must include the overlay files and their roles.
- Golden test cases gain an optional `overlay.yaml` (and per-side view overlays). A property test checks that hints applied by an overlay give the same findings as the same hints written inline.

## 8. What doesn't fit: acknowledgements as overlays

Acks stay keyed by finding ID, in the review file. A finding ID can cover split parts (overrides), bulk "N operations" findings and component findings spanning several operations, so there is no single node to target. An ack also has a natural lifetime (stale, expired), while an overlay applies until someone removes it.

## 9. Choices so far

Picked during the brainstorm. Each is still to be confirmed and recorded as a decision record when work starts.

| Topic | Leaning |
|---|---|
| Acknowledgements | Stay keyed by finding ID, not in overlays |
| Review file | Typed `api-diff.review.yaml` (`ack`, `note`, `seen`); `api-diff.ack.yaml` still read |
| Where reviewers act first | CLI and HTML report, sharing `decisions.json` and one `review apply` step |
| Note lifetime | Notes outlive the diff (matched by rule and pointer); `review prune` for the rest |
| Inline weakening hints | Allowed, with a reason required |
| Severity floors | Later |
| Effect of config-only PRs | Measured on changes pending release, old vs new config |
| Multi-file targets | Entry file only, for every overlay |
| JSONPath | Subset now, full RFC 9535 later |
| Overlay roles | `hints` and `view` |
| Hints overlay format | Overlay 1.2 reusable actions |
| Unreachable findings in `$ref`'d files | `apply` suggests an inline hint |

## 10. Open questions

- Do finding IDs stay the same for a change across a longer range (`v1..v2`)? Decides how notes are matched.
- How many findings in real specs sit in `$ref`'d files? If many, entry-file-only targets weaken the review loop.
- Which extensions api-diff reads are tooling-only and which are public (for `overlay strip`)?
- Is `--fail-on unreviewed` wanted at all, or only the "unreviewed" count in reports?
- How to preserve comments when `apply` edits YAML: text appends or the `yaml` package.
- PR comment commands: worth the permission and fork handling?

## 11. Suggested order

A first, smaller step is built: text reports show finding IDs, and `api-diff ack <id> --reason … --expires …` appends a checked entry to `api-diff.ack.yaml` ([decision record](../decision-records/2026-11-23T0313-ack-command-and-ids-in-text.md)). The steps below are still ideas.

1. **`overlay strip`** (low effort, useful alone).
2. **Overlays as input:** `--overlay`, roles, the JSONPath subset, positions, `overlay-target-unmatched`, cache key. The foundation for the rest.
3. **Typed review file**, with back-compat for `api-diff.ack.yaml`.
4. **Review loop:** `decisions.json`, `review apply`, `api-diff review` / `annotate`, then HTML buttons; review state in the `review` report.
5. **Governance:** reasons for weakening, config-change effect report, audit view; floors later.
6. **Later:** full RFC 9535, PR comment commands, per-audience views, `overlay fix` and `overlay extract`.

## 12. References

- [Overlay Specification v1.2.0](https://spec.openapis.org/overlay/v1.2.0.html), [releases](https://github.com/OAI/Overlay-Specification/releases), [v1.0.0](https://spec.openapis.org/overlay/v1.0.0.html)
- [RFC 9535: JSONPath](https://www.rfc-editor.org/rfc/rfc9535)
- POLICY.md sections 8, 11 and 12; [docs/spec-authors.md](../docs/spec-authors.md)
- Decision records: [acknowledgements](../decision-records/2026-11-22T0319-acknowledgements.md), [in-spec hint semantics](../decision-records/2026-11-21T2109-in-spec-hint-semantics.md), [overrides per operation](../decision-records/2026-11-21T1929-overrides-per-operation.md), [exclusion sets](../decision-records/2026-11-21T2138-extension-kinds-and-exclusion-sets.md), [report, not gate](../decision-records/2026-11-22T0653-report-not-gate.md), [YAML positions](../decision-records/2026-11-21T0436-yaml-positions-from-parser-events.md), [rename detection](../decision-records/2026-11-22T1631-rename-detection.md)
- Related backlog ideas: [ownership routing](ownership-routing.md), [portfolio mode](portfolio-mode.md), [cached base index](cached-base-index.md)

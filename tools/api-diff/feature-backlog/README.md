# Feature backlog: detailed proposals

One file per proposed feature or design, including every idea in [PLAN.md section 8](../PLAN.md#8-further-ideas-backlog). PLAN.md keeps only a short entry for each one (a brief overview and the value), and this directory holds the details: background, options, sketches, choices so far and open questions. See [the decision record](../decision-records/2026-11-23T0157-feature-proposals-in-feature-backlog.md) for why.

- **File names:** `<slug>.md`, named after the feature.
- **Header table:** **Status**, **Summary**, **Value / effort** and **Plan entry** (a link back to PLAN.md).
- **Status:** *Idea* (not scheduled), *Planned* (in a milestone), *Built* (link the decision records) or *Dropped* (say why). Keep the status in PLAN.md and the table below in step.
- A proposal isn't a decision. When work starts, its choices are asked again and recorded in [decision-records/](../decision-records/README.md), and the proposal links to those records.

| Proposal | Area | Status | Summary |
|---|---|---|---|
| [Overlays, a review file and a review loop](overlays-and-review-loop.md) | Review and publishing | Idea | Keep `x-api-diff` hints out of the published spec with OpenAPI Overlays and diff what is actually published; reviewers mark findings in the CLI or HTML report, and their decisions (acks, notes, lasting facts about nodes) feed later runs, so every lowered severity is traced and owned. |
| [Counter-example payloads](counter-example-payloads.md) | Evidence and accuracy | Idea | For each `wire` finding, a small JSON value the old schema accepts and the new one rejects, as proof the change breaks something. |
| [Re-validate examples](re-validate-examples.md) | Evidence and accuracy | Idea | Check every base `example`/`examples` against the revision schema; an example that no longer validates is a concrete breaking change. |
| [Constraint maths](constraint-maths.md) | Evidence and accuracy | Idea | Compare numeric, length and item-count constraints as intervals, and simple `pattern`s as automata, so narrowed vs widened is exact. |
| [Versioning-scheme aware matching](versioning-scheme-matching.md) | Evidence and accuracy | Idea | Match `/v1/…` with `/v2/…`, or versioned media types, when a new API version is published alongside the old one. |
| [Bulk-change collapsing](bulk-change-collapsing.md) | Large specs and noise | Built | Group the same change made in many places without a shared `$ref` into one "N operations" finding. |
| [Cached base index](cached-base-index.md) | Large specs and noise | Built | Cache the parsed base by content hash so CI only parses the revision. |
| [Spec quality side-report](spec-quality-side-report.md) | Large specs and noise | Idea | List identical inline schemas found by the content hashes ("appears inline 42 times; consider a component"). |
| [Portfolio mode](portfolio-mode.md) | Large specs and noise | Idea | Compare many specs in one run and report which APIs a change to a shared schema file affects. |
| [Ownership routing](ownership-routing.md) | Ownership and governance | Built (M9) | Owners from `x-owner` or the policy's `owners.assign` list, listed on each finding, with reports split per team. |
| [Git blame for findings](git-blame-for-findings.md) | Ownership and governance | Idea | Use the source maps to find the commit and author that introduced each change. |
| [Deprecation ledger](deprecation-ledger.md) | Ownership and governance | Idea | A standing report of everything deprecated, with sunset dates, overdue removals and `Deprecation`/`Sunset` header checks. |
| [Breaking-change budget](breaking-change-budget.md) | Ownership and governance | Idea | A policy limit on breaking changes per release or audience. |
| [Usage-weighted severity](usage-weighted-severity.md) | Ownership and governance | Idea | Import call counts per operation to rank findings or lower severity for unused operations. |
| [Editor integration (LSP)](editor-integration-lsp.md) | Developer experience | Idea | Run the engine as a language server so breaking changes show up in the editor before a PR exists. |
| [`api-diff explain <finding-id>`](explain-command.md) | Developer experience | Idea | Print the full reasoning for one finding: rule, usages, severity source, counter-example and fix. |
| [Rule plugins](rule-plugins.md) | Developer experience | Idea | Custom TypeScript rules against the change-record API, tested with the golden-case format. |
| [Lint only what changed](lint-only-what-changed.md) | Developer experience | Idea | Let plugin rules declare `scope: changed` so house rules apply only to new and changed parts. |
| [Watch mode](watch-mode.md) | Developer experience | Idea | `api-diff --watch` re-runs on save. |
| [Policy file JSON Schema](policy-json-schema.md) | Developer experience | Idea | Publish a JSON Schema for `api-diff.yaml`, printed by `api-diff schema policy`, so editors validate and autocomplete the policy file. |
| [Offline and deterministic](offline-and-deterministic.md) | Enterprise operation | Idea | No network calls or telemetry, and byte-identical output for the same inputs, so it works in air-gapped CI. |
| [Example value redaction](example-value-redaction.md) | Enterprise operation | Idea | Mask `example` values in reports, keeping their type and shape, since they can hold real customer data. |
| [Signed reports](signed-reports.md) | Enterprise operation | Idea | Hash (and optionally sign) the inputs and the report so audit records can be shown to be unchanged. |
| [Memory-lean index](memory-lean-index.md) | Enterprise operation | Idea | Intern strings and store graph edges in typed arrays so 50 MB+ specs fit in small CI runners. |

# Feature backlog: detailed proposals

One file per proposed feature or design that is too big for a row in [PLAN.md section 8](../PLAN.md#8-further-ideas-backlog). PLAN.md keeps a short entry for each one (a brief overview and the value), and this directory holds the details: background, options, sketches, choices so far and open questions. See [the decision record](../decision-records/2026-11-23T0157-feature-proposals-in-feature-backlog.md) for why.

- **File names:** `<slug>.md`, named after the feature.
- **Header table:** **Status**, **Summary**, **Value / effort** and **Plan entry** (a link back to PLAN.md).
- **Status:** *Idea* (not scheduled), *Planned* (in a milestone), *Built* (link the decision records) or *Dropped* (say why).
- A proposal isn't a decision. When work starts, its choices are asked again and recorded in [decision-records/](../decision-records/README.md), and the proposal links to those records.

| Proposal | Status | Summary |
|---|---|---|
| [Overlays, a review file and a review loop](overlays-and-review-loop.md) | Idea | Overlays keep tooling hints out of the published spec and diff the published view; a typed review file; reviewers annotate findings in the CLI or HTML report and feed decisions into later runs. |

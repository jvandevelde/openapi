# Build our own OpenAPI diff tool

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 02:32 UTC |
| **Summary** | Build and maintain `api-diff` in this repo instead of adopting an existing diff tool. |
| **Milestone** | — |

## Background

We want to decide for ourselves what counts as a breaking change and how changes are presented, and to change either without forking another project. Existing tools classify changes with fixed or coarsely configurable rules, and report every change to a shared schema once per endpoint.

## Alternatives considered

- **Use oasdiff as-is**: Largest check set and actively maintained, but customisation is one level per check for the whole spec, with no scoping by path, tag or audience.
- **Fork oasdiff**: Gives control, but we'd carry a large Go codebase and its architecture (hand-written checks per keyword and position).
- **Wrap an existing tool and post-process its output**: Cheap to start, but the output lacks the information we need (usage direction, root causes, source locations in both documents).
- **Hosted service (e.g. Bump.sh)**: Good consumer changelogs, but specs leave our network and the rules aren't configurable.

## Decision

Build `api-diff` as a new tool under `tools/api-diff/`, designed around the gaps in PLAN.md section 3.

## Impacts

- We own the maintenance of the rules and engine.
- The design can target our needs directly: direction-aware rules, root-cause reporting, audience-specific reports.

## References

- PLAN.md sections 1–3
- [Survey of other tools](2026-11-21T0345-survey-other-diff-tools.md)

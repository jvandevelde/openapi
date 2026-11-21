# Design around a survey of existing tools

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 03:45 UTC |
| **Summary** | Base the design on a survey of oasdiff, openapi-changes, OpenAPITools openapi-diff, Azure openapi-diff, Bump.sh and Speakeasy, not on one tool. |
| **Milestone** | — |

## Background

The plan read too much like a copy of oasdiff. Other tools have ideas worth taking.

## Alternatives considered

- **Compare only with oasdiff**: Narrow, and reads as a copy.

## Decision

PLAN.md sections 1–3 list each tool's features, pros and cons, the ideas we take (git revisions, history timeline, one-word state, rule docs pages, version-aware rules) and the gaps we aim to close. Optic was left out because it's archived.

## Impacts

- `--state` and git revision inputs moved into M3/M2; history timeline into M8.

## References

- PLAN.md sections 1–3

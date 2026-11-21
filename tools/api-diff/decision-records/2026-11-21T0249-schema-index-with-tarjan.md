# Schema index with Tarjan's SCCs for recursive schemas

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 02:49 UTC |
| **Summary** | Never inline `$ref`s; build a schema graph per document and find cycles with an iterative Tarjan's algorithm. |
| **Milestone** | M4 |

## Background

Specs have self-referencing schemas and unions whose members refer back to the base type in a collection. These commonly crash diff tools through infinite recursion, path explosion or comparisons that never end.

## Alternatives considered

- **Inline refs with a depth limit**: Truncates real differences and still explodes on wide unions.
- **Recursive Tarjan**: Can itself overflow the stack on deep graphs.

## Decision

An immutable index per document: nodes, labelled edges, reverse edges, SCCs (iterative Tarjan, plus an explicit self-loop check), topological order. Cycles must be productive (pass through a property, `items` or `additionalProperties` edge). Comparison caches pairs and assumes equality for pairs already in progress. Impact paths store one shortest example path and a count.

## Impacts

- Recursive schemas are safe in every stage.
- Invalid `allOf` cycles are reported as `cycle-not-productive`.

## References

- PLAN.md section 4, *Reference graph, deep nesting and cycles*

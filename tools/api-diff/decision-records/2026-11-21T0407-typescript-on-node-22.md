# TypeScript on Node ≥ 22.18 with type stripping

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 04:07 UTC |
| **Summary** | Write the tool in TypeScript and run it directly on Node ≥ 22.18 using Node's built-in type stripping. |
| **Milestone** | M0 |
| **Supersedes** | [TypeScript on Node 20](2026-11-21T0232-typescript-on-node-20.md) |

## Background

The user chose TypeScript. Node 20 is end of life, and Node 22.18 runs `.ts` files without a build step.

## Alternatives considered

- **Plain JavaScript (like `operation-ids`)**: Weaker typing for a much larger codebase.
- **Go**: Single binary, but our own position-aware YAML handling.

## Decision

TypeScript, run with Node's type stripping for development and tests; `tsc --noEmit` for type checks; `erasableSyntaxOnly` (no `enum`s or namespaces); esbuild bundle for releases.

## Impacts

- Imports use explicit `.ts` extensions.
- Releases are plain JavaScript, so users never need TypeScript.

## References

- PLAN.md section 7

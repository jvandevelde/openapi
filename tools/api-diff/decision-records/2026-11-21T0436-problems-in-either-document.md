# Problems in either document are findings

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 04:36 UTC |
| **Summary** | Invalid documents and unresolved `$ref`s are reported as `spec-invalid` / `ref-unresolved` findings for the side they're on, instead of stopping the run. |
| **Milestone** | M3 |

## Background

A run can hit a revision that doesn't parse, a Swagger 2.0 file, or a `$ref` that points nowhere. Stopping with an error hides every other finding, but carrying on silently would hide the problem.

## Alternatives considered

- **Stop on the first problem**: simple, but one broken `$ref` hides everything else.
- **Report only problems in the revision**: the base was already accepted, but its problems still affect what can be compared.

## Decision

- Inputs that can't be read at all (missing file, unknown revision) are usage errors: exit code 2.
- A document that can't be parsed or isn't OpenAPI 3.0–3.2 is a `spec-invalid` finding (error) on its side, and nothing else is compared.
- An unresolved `$ref` is a `ref-unresolved` finding (error) at the `$ref`, and the node it should have provided is treated as absent, so related changes still show up (e.g. a parameter that now looks removed).
- `$ref`s to external URLs aren't followed; one `not-compared` notice counts them.
- A path parameter declared but missing from its template is `spec-invalid`.

## Impacts

- Findings say which side they're about (`base document` / `revision document`).
- With the default `--fail-on error`, a broken revision fails CI with a precise location.

## References

- `src/engine.ts`, `src/load/documents.ts`, test cases `spec-invalid-*` and `ref-unresolved`

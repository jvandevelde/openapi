# Files nested too deeply to parse are spec-invalid

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 05:51 UTC |
| **Summary** | Literal nesting beyond what the parsers handle (about 1,600 levels in YAML, 3,600 in JSON) is reported as `spec-invalid` instead of crashing. |
| **Milestone** | M4 |

## Background

Testing the schema index found that js-yaml's parser and jsonc-parser's visitor recurse, so a file with thousands of levels of literal nesting overflows the call stack and crashed the tool. Everything api-diff itself does is iterative, and recursive `$ref` schemas are not affected, because cycles are never expanded. Real specs rarely nest beyond about 50 levels.

## Alternatives considered

- **Parse in a worker thread with a larger stack**: raises the limit to tens of thousands of levels, with more moving parts.
- **Own iterative JSON position scanner**: no limit for JSON, YAML still limited.

## Decision

Catch the stack overflow while parsing and report `spec-invalid` with the message "nested too deeply to parse (more than about N levels)". Measured limits on Node 22: about 1,600 levels for YAML, about 3,600 for JSON.

## Impacts

- The tool never crashes on deep files.
- Worker threads remain an option later, for the limit and for parsing both sides in parallel.

## References

- `src/load/parse.ts`, `test/unit/schema-index.test.ts`

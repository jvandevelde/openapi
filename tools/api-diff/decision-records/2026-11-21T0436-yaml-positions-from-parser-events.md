# Get YAML positions from js-yaml 5 parser events

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 04:36 UTC |
| **Summary** | Use js-yaml 5's `parseEvents` stream for both values and positions, with merge keys enabled. |
| **Milestone** | M2 |

## Background

[Use js-yaml and jsonc-parser](2026-11-21T0236-fast-position-aware-parsers.md) planned to record positions through js-yaml's `listener` option, measured with js-yaml 4. The current release, js-yaml 5, is a rewrite: `listener` is gone, and instead `parseEvents` returns a flat event stream with exact source offsets, and `constructFromEvents` builds values from it. Its `CORE_SCHEMA` (YAML 1.2) also leaves out merge keys (`<<: *anchor`), which some specs use for shared fragments.

## Alternatives considered

- **Pin js-yaml 4 and use `listener`**: works, but stays on an old major version.
- **Build values ourselves from events**: one pass, but duplicates js-yaml's tag and anchor handling.
- **Use the `yaml` package for positions**: about 10× slower.

## Decision

Parse once with `parseEvents`, build values with `constructFromEvents` using `CORE_SCHEMA.withTags(mergeTag)`, then walk the events and the built values in step to record the offset of every key and array item (`src/load/positions.ts`). Offsets are stored per container in a `WeakMap`, so no JSON Pointer strings are built for nodes that are never reported. Quoted keys point at their opening quote. Lookups that can't be matched exactly (inside merged mappings, aliases or complex keys) fall back to the nearest ancestor. JSON uses `JSON.parse` for values and jsonc-parser's `visit` with the same builder.

## Impacts

- Measured on generated 8 MB specs (Node 22): YAML about 0.45–0.56 s, JSON about 0.47 s per spec, including positions. Comparing two 8 MB YAML specs takes about 1.8 s end to end, mostly parsing.
- A property test checks offsets against the `yaml` package (YAML) and jsonc-parser's tree (JSON) on random documents.
- Merge keys are supported.

## References

- `src/load/parse.ts`, `src/load/positions.ts`, `test/unit/positions.test.ts`, `test/bench/bench.ts`
- [Use js-yaml and jsonc-parser for position-aware loading](2026-11-21T0236-fast-position-aware-parsers.md)

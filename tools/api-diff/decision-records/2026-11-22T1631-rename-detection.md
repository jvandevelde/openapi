# Rename detection: unique matches only, renames replace the ref change

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-22 16:31 UTC |
| **Summary** | A component is renamed when exactly one removed and one added component share a shape hash (or, with `match: similar`, type and property names and types); a parameter when exactly one removed and one added parameter share location, schema, requiredness and position. Ambiguous cases are left as they are. |
| **Milestone** | M8 |

## Background

RULES.md defines `component-renamed` ("same structure, new name") and `parameter-renamed` ("same schema and position, new name; also reported as removed + added on the wire"). Building them (M8 step 1) needed exact matching rules, and a decision on what happens to the `ref-target-changed` that a component rename causes. These were decided while building and are listed for review.

## Alternatives considered

### Matching

- **✅ Chosen: one-to-one, unique matches only.** If two removed components share a structure with two added ones, nothing is guessed; the changes are reported as they are. A wrong rename is worse than none, because it hides a real removal.
- **Rejected: best match by similarity score.** Needs thresholds nobody can explain, and fails quietly.
- **✅ `match: exact`** (default) uses the shape hash, then the component's own content (so a rename isn't missed when a schema it references also changed in the same release), so descriptions and examples may differ. **`similar`** also matches on the schema's type and the names and types of its properties, so a rename that also changed a limit is still found, and the limit change is reported on the new component.
- **✅ Parameters** match on location, requiredness, position among that location's parameters, and the schema (or `content`). Path parameters are left to `path-param-renamed`.

### What a rename replaces

- **✅ Components: `component-renamed` replaces `component-removed`/`component-added` and the `ref-target-changed` findings for the same old → new pair.** On the wire nothing changed; for SDKs the type name changed, which is what `component-renamed` (sdk; error under `--profile sdk`) says. Other changes to the component are still compared and reported on the new name.
- **✅ Parameters: `parameter-renamed` is added alongside `parameter-removed` and `parameter-added-*`,** as RULES.md specifies: old clients still send the old name, so the wire findings stay.

## Decision

As chosen above. With these two rules every rule in the registry is implemented.

## Impacts

- `src/diff/schema-engine.ts` (`#renames`), `src/diff/operations.ts` (`renamedParams`), `src/engine.ts` (dropping ref changes explained by a rename); `component-renamed.match` is validated.
- Golden cases: component-renamed, component-renamed-ambiguous, component-renamed-similar, parameter-renamed.

## References

- RULES.md sections 4 and 8; PLAN.md section 3, gap 8

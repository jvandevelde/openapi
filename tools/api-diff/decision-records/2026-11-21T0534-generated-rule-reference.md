# Generated rule reference, one page per rule

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 05:34 UTC |
| **Summary** | Generate `docs/rules/<rule-id>.md` pages and an index from the rule registry, rule docs and test cases; RULES.md stays the hand-written design doc and links to them. |
| **Milestone** | M3 |

## Background

The user asked for a complete, maintained list of rules with descriptions and default behaviour. RULES.md has the design reasoning and default severities, but no per-rule description, example, options or fix, and keeping a hand-written list current as rules change would drift.

## Alternatives considered

- **Generate RULES.md itself**: one file, but loses it as a readable design doc.
- **One generated file next to RULES.md**: simpler, but a 127-rule file is long to navigate.
- **One page per rule** (chosen by the user, keeping RULES.md as the design doc).

## Decision

- `src/rules/docs.ts` holds each rule's description, why it has its default, how to fix it, and its policy options. The registry holds ID, kind, severities and status.
- `scripts/rule-docs.ts` (`npm run docs`) writes `docs/rules/README.md` (index by group) and one page per rule: kind, default severity (request/response and `--profile sdk`), variant IDs, status, description, why, an example, policy options and fix.
- Each example is a diff of the rule's real test case (the case named after the rule, else the first case that expects it) with its expected findings, so examples are always tested.
- Tests fail if a rule has no docs entry, or if `docs/rules/` doesn't match the generator's output.
- RULES.md links each rule ID to its page. `api-diff rules <id>` prints the same description, reason and fix.

## Impacts

- Adding or changing a rule means updating the registry, `src/rules/docs.ts` and its test case, then running `npm run docs`.
- Planned rules have pages too, marked *Planned* with no example until their test case exists.

## References

- `src/rules/docs.ts`, `scripts/rule-docs.ts`, `docs/rules/`, `test/unit/rule-docs.test.ts`

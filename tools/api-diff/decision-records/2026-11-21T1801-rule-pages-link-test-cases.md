# Rule pages list every test case for the rule

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 18:01 UTC |
| **Summary** | Each generated rule page gets a "Test cases" section listing every test case that expects the rule, with the finding it expects and what it shows. |
| **Milestone** | M5 |

## Background

The user asked whether linking rule pages to their tests adds anything, since each page already shows one example inline. For 88 of the 118 implemented rules it doesn't: that example is the only test case. For the other 30, the extra cases cover variants the single example can't show: other locations or directions, `--profile sdk` severities, conditional severities (e.g. a closed object), inheritance (document-level security) and follow-on effects (a broken `$ref`).

## Alternatives considered

- **Inline example only**: shorter pages, but the variants are invisible.
- **Inline every case's diff**: complete, but long pages for little gain over links.

## Decision

Keep the inline example (a diff of one case). Add a generated "Test cases" section: for rules with several cases, a table with each case (linked to its folder), the finding it expects for this rule (rule ID, severity, subject) and its description; for one case, a note that the example is the only one; otherwise "None yet". Case descriptions should say why the rule appears, so they read well in that table.

## Impacts

- Generated with the rest of `docs/rules/`, so it stays in sync with the test cases (the existing staleness test covers it).

## References

- `scripts/rule-docs.ts`, `docs/rules/`
- [Generated rule reference, one page per rule](2026-11-21T0534-generated-rule-reference.md)

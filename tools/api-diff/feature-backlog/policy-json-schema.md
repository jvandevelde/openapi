# Policy file JSON Schema

| | |
|---|---|
| **Status** | Idea |
| **Summary** | Publish a JSON Schema for `api-diff.yaml`, printed by `api-diff schema policy`, so editors validate and autocomplete the policy file. |
| **Value / effort** | medium / medium |
| **Plan entry** | [PLAN.md section 8, *Developer experience*](../PLAN.md#developer-experience) |

## What it does

`api-diff schema policy` prints a JSON Schema for the policy file. Teams point their editor at it (for example with a `# yaml-language-server: $schema=…` comment, or a schema mapping in the editor's settings) and get validation, autocomplete and hover docs for every key, rule ID and rule option while they write `api-diff.yaml`.

## Background

POLICY.md section 13 promised this command, but until 2026-11-23 `api-diff schema policy` ignored its argument and printed the result schema. The command now prints the result schema only for `api-diff schema` or `api-diff schema result`, and `schema policy` exits 2 saying there's no policy schema yet ([decision record](../decision-records/2026-11-23T0331-adoption-fixes-ids-outputs-unreadable-inputs.md)).

The policy is validated by hand-written code in `src/policy/policy.ts`, with "did you mean" suggestions that a JSON Schema validator can't give. So the schema would sit beside that code, not replace it.

## Options

- **Hand-written schema** in `schema/policy-v1.schema.json`, with a test that every POLICY.md example and every test-case policy is valid against it, and that every key the loader accepts appears in it.
- **Generated from the rule registry** for the parts that come from code (rule IDs, paired `-in-request`/`-in-response` IDs, location-specific parameter IDs, per-rule options and their types), with the fixed top-level keys written by hand. This keeps the rule part in step with the registry automatically, like the generated rule docs.

## Open questions

- Hand-written, generated, or both (above)?
- Should `version: 1` in the policy map to the schema version, and how will a change to the policy format be versioned?
- Publish the schema as a release asset next to `api-diff.mjs`, so editors can reference a pinned URL?

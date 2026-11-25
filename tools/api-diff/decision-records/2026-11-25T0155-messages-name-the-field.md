# Schema change messages name the field and don't repeat the keyword

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-25 01:55 UTC |
| **Summary** | A schema change inside an operation's parameter, header or body starts with that field (`query parameter 'limit': maximum decreased (100 → 50)`); the `at` path drops a last step the title already names (`at /properties/note`, not `/properties/note/maxLength`) and is relative to the operation for operation subjects; type lists print as words (`number → integer`); and the version check's example is the finding's subject and message. In every report. |
| **Milestone** | — (follow-up to M8) |

## Background

In the UX review of the `explore` page ([feature proposal](../feature-backlog/explore-reviewer-ux-pass.md), item 5), rows in an operation's group read `maximum decreased (100 → 50) at /maximum` and `format added (none → 'uuid') at /format`: they didn't say which parameter. The client note did, but only once the row was opened. Messages also showed `(["number"] → ["integer"])`, `at /paths/~1orders/get/summary` for an operation's summary, and the version check's example as a rule ID and pointer (`e.g. max-length-decreased-in-request at #/components/schemas/NewOrder`).

The user chose to change the messages everywhere rather than only on the `explore` page.

## Alternatives considered

- **✅ Chosen: change the message in the registry**, so `review`, `ci`, `changelog`, `sdk`, `audit` and `explore` all say the same thing.
- **Only on the explore page.** The other reports would keep the unclear form, and the same change would read differently per report.

## Decision

1. `schemaMessage` prefixes `details.usage` when the engine set it (an inline schema in an operation: `query parameter 'limit'`, `request body (application/json)`, `response 200 (application/json)`).
2. `wherePath` renders the `at` path: relative to the operation when the subject is an operation, without a last step that is a keyword the title names (case-insensitively) unless it's a property name. Nothing left: no `at`. Documentation messages use it too (`GET /orders summary changed`).
3. A `type` value that is a list of strings prints joined with `or`.
4. `version-bump-too-small`'s `because` is `<subject>: <message>`, with a component subject shortened to its name, and `details.becauseId` holds that finding's ID.
5. Finding IDs don't change: they don't include the message.

## Impacts

- `src/rules/registry.ts` (`wherePath`, `schemaMessage`, docs messages), `src/diff/versions.ts`.
- Messages change in every report; anything matching message text (scripts, policy `message` templates that embed `{{message}}`) sees the new wording. Rule IDs, finding IDs, details and severities are unchanged.
- Updated tests and sample output in README.md, docs/getting-started.md, docs/workflows.md and PLAN.md.

## References

- [Feature proposal: a reviewer's UX pass](../feature-backlog/explore-reviewer-ux-pass.md)
- [Explore shows each finding as an aligned diff](2026-11-25T0154-explore-shows-findings-as-aligned-diff.md)

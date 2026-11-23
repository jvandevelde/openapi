# Adoption fixes: finding IDs in text reports, report folders, unreadable inputs, the schema command and unknown commands

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-23 03:31 UTC |
| **Summary** | `review` and `ci` text show each finding's ID; missing report folders are created and write errors exit 2; an unreadable document exits 2 whatever `--fail-on` says; `api-diff schema` takes only `result`; an unknown command word is reported as one. |
| **Milestone** | — (after M10) |

## Background

An adoption review of the tool, looking at governance and hands-on use, found five small problems that get in the way of a team's first weeks with it. Each was asked about separately and these answers were chosen:

1. **No finding IDs in the text reports.** Acknowledging a finding needs its 12-character ID, but `review` (the PR comment and the default terminal report) and `ci` didn't show it. The only documented way to get it was piping the JSON through `jq`.
2. **Report files in missing folders crashed.** `--report review:html:out/x/review.html` with no `out/x` ended with a Node stack trace and exit code 1, the code that means "findings at or above `--fail-on`", so a script would read the crash as breaking changes.
3. **An unreadable spec passed CI.** Broken YAML, Swagger 2.0 or a document that isn't OpenAPI gave a `spec-invalid` ERROR but exit 0 under the default `--fail-on never`, so a PR that broke the spec file got a green check.
4. **`api-diff schema policy` printed the result schema.** POLICY.md section 13 said it prints a JSON Schema for the policy file, but the command ignored its argument.
5. **Unknown commands read as missing files.** `api-diff explain 1fcf7e50b775` said `file not found: explain`.

## Alternatives considered

- **IDs: review only**, keeping `ci` lines short. Not chosen: the `ci` report is what a failing check prints, which is exactly when an author needs the ID.
- **IDs: skip.** Not chosen: acknowledgements are the documented way to accept an intended breaking change, and they should be reachable from the report people read.
- **Report folders: clean error, no folder creation.** Not chosen: CI recipes write to `out/…`, and creating the folder is what most report tools do.
- **Unreadable inputs: exit 2 for any `spec-invalid` or `ref-unresolved` finding**, including an invalid `x-api-diff` hint or lifecycle date. Not chosen: stricter than needed, and it would turn small problems in a spec that was otherwise compared into hard failures for existing users.
- **Unreadable inputs: keep exit 0.** Not chosen: "report, don't gate" ([decision record](2026-11-22T0653-report-not-gate.md)) is about intended breaking changes; when nothing could be compared, there is no report to trust.
- **Schema: write the policy schema now.** Not chosen for this change: it is a medium-sized job, since the policy is validated by hand-written code. It is a backlog item instead.
- **New or deleted specs in a PR** (the base or revision doesn't exist at its revision, which fails the copyable workflow with exit 2) were also considered and **skipped** for now.

## Decision

1. **Finding IDs.** In the `review` and `ci` text reports, every finding line ends with ` · id <12 hex characters>` after the rule ID, including input problems, version checks and notes. The `audit`, `explore` and JSON outputs already showed IDs and are unchanged; `summary` is unchanged.
2. **Report files.** Every report file (`--report <name>:<format>:<file>`, `-o`, and the `history` timeline file) is written after creating any missing parent folders. Any other write error is `api-diff: can't write <path>: <code>` with exit code 2, without a stack trace.
3. **Unreadable inputs.** A side is *unreadable* when it can't be loaded (a YAML or JSON syntax error, an unreadable `$ref`'d root) or can't be modelled as OpenAPI 3.x (Swagger 2.0, not OpenAPI). The result records it as `compared.<side>.unreadable: true` (added to the result schema; version 0 only adds fields). The CLI writes every requested report as before, then prints `api-diff: the <side> document couldn't be read as OpenAPI 3.x, so nothing was compared (see "Problems with the inputs")` on stderr and exits 2, whatever `--fail-on` says. Smaller `spec-invalid` problems in a document that was read (a path template clash, an invalid hint, owner or lifecycle value) keep the usual exit code. `history` is unchanged: an old commit with a broken spec doesn't fail a timeline.
4. **`api-diff schema`.** `api-diff schema` and `api-diff schema result` print the result schema. `api-diff schema policy` exits 2 with "there's no JSON Schema for the policy file yet"; any other name exits 2 as an unknown schema. POLICY.md section 13 is corrected, and the policy schema is a backlog item ([Policy file JSON Schema](../feature-backlog/policy-json-schema.md)).
5. **Unknown commands.** Without `--base`/`--revision`, if the first input is a single word (letters, digits, `-`, `_`; no `.`, `/` or `:`) and no such file exists, it's reported as `'<word>' isn't a command or a file`, with "did you mean" for a close subcommand, and the list of commands. Exit code 2, as before. Such a word could never be a valid input: without `:` it's read as a file path.

## Impacts

- `src/render/common.ts` (`findingLine` takes `id`), `src/render/review.ts`, `src/render/ci.ts`; `src/cli/main.ts` (`writeOutput`, the schema command, the unknown-command check, the exit code for unreadable inputs); `src/engine.ts` and `src/types.ts` (`ComparedSide.unreadable`); `schema/result-v0.schema.json`; `src/render/template.ts` (templates can use `compared.<side>.unreadable`).
- Scripts that parse `review` or `ci` text lines see a new ` · id …` suffix. The JSON result is the stable interface for scripts.
- CI: a PR with a spec that can't be read now fails the check. The workflow in `docs/ci.md` runs the artifact upload and the comment step with `if: ${{ !cancelled() }}`, so the comment still explains why.
- Docs: README (example output, exit codes), `docs/getting-started.md`, `docs/workflows.md` (recipe 8 and the pre-commit example), `docs/ci.md`, POLICY.md section 13; a new backlog proposal and PLAN.md section 8 entry.
- Tests: `test/unit/cli.test.ts` covers each of the five changes.

## References

- [The PR check reports changes and doesn't fail by default](2026-11-22T0653-report-not-gate.md)
- [Acknowledgements](2026-11-22T0319-acknowledgements.md)
- [Policy file validated strictly, rule docs generated from code](2026-11-21T0319-policy-file-design.md)
- [Feature proposal: Policy file JSON Schema](../feature-backlog/policy-json-schema.md)
- POLICY.md sections 11 and 13; `docs/ci.md`

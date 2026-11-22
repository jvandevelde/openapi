# M9 governance: Mustache templates, owners from the spec and the policy, --uses for every report

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-22 20:27 UTC |
| **Summary** | Report templates use the `mustache` package with a name check before rendering; owners come from `x-owner` and a policy `owners` list; `--uses` filters every report and the exit code; `acknowledgements.require-owner` is an optional switch, off by default. |
| **Milestone** | M9 |

## Background

M9 (PLAN.md section 6) adds the `audit` report, custom reports and templates, `--uses` consumer reports and ownership routing. Four choices change what gets built, so they were asked before building.

## Alternatives considered

### Report templates

- **✅ The `mustache` package (4.2.0, MIT, no dependencies).** Logic-less, a published spec that teams already know, and it can't run code, which matters because a template sits next to a policy file in someone else's repository. Bundled with esbuild it adds about 6.5 KB to the release file, so distribution stays one file ([Distribute as a single bundled release file](2026-11-21T0407-release-file-distribution.md)). Its weakness, a missing name rendering as empty text, is closed by checking every name against the report's data shape before rendering.
- **Our own Mustache subset:** no dependency, but we would define, document and keep a template language for the same result.
- **Handlebars:** about 3 MB with 5 dependencies, compiles templates to code, and has had prototype-pollution advisories. Its helpers aren't needed.
- **JS module templates:** full control, but runs any code next to the policy file and is hard to keep deterministic.
- **Message wording only:** too little for release notes that need no manual editing. Kept as well: per-rule `message` and `note` wording is part of the chosen option.

### Where owners come from

- **✅ `x-owner` in the spec plus an `owners` section in the policy** that matches paths, tags, operations and components like overrides do. A shared component's change is owned by the component's team and by the teams of every operation it affects.
- **`x-owner` only:** every spec would have to be annotated.
- **A CODEOWNERS-style file:** one more file and format, when the policy already has a match syntax.

### `--uses`

- **✅ A view filter for every report**, like `exclude`, also applied to the exit code; changes about the whole API are always kept.
- **`changelog` only:** narrower, and the review report couldn't answer "what affects this consumer".

### Acknowledgements and owners

- **✅ `acknowledgements.require-owner: true` (off by default):** an acknowledgement whose `owner` isn't one of the finding's owners doesn't apply, and `acknowledgement-not-owner` says why.
- **Leave for later:** owners would only be shown, not used.

## Decision

As chosen above.

## Impacts

- New runtime dependency `mustache` (and `@types/mustache` for type checks).
- `src/policy/owners.ts`, `src/render/template.ts`, `src/render/audit.ts`; the views in `src/render/config.ts`; `--uses` in the CLI.
- POLICY.md sections 3, 10, 11 and 14; the new rule `acknowledgement-not-owner`.

## References

- PLAN.md sections 5, 6 and 8 (ownership routing)
- [Report settings: per-report views, the ci view decides the exit code](2026-11-22T0701-report-settings.md)
- [Migration notes for clients instead of fix advice](2026-11-22T1634-client-migration-notes.md)

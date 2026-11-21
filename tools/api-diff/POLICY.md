# api-diff: policy reference

Status: **draft**. This is the full reference for the policy file. The rules themselves are listed in [RULES.md](RULES.md), and the design is in [PLAN.md](PLAN.md).

The policy file is YAML or JSON, `api-diff.yaml` in the working directory by default (or `--policy <file>`; `--no-policy` ignores it). Every key is optional: an empty file means "built-in defaults".

Command-line options beat the file: `--profile` and `--fail-on` replace `profile` and `defaults.fail-on`, and `--rule <rule-id>=<severity>` (repeatable) sets a rule's severity, e.g. `--rule documents-unrelated=off` for a one-off run.

## 1. Top-level keys

| Key | What it sets | Section |
|---|---|---|
| `version` | Policy format version. Currently `1` | — |
| `profile` | `wire` (default) or `sdk` | 2 |
| `defaults` | Run-wide settings such as `fail-on` | 2 |
| `rules` | Severity and options per rule | 3, 4 |
| `overrides` | Severity changes for matching parts of the spec | 5 |
| `extensions` | Which kind each `x-` extension is (`wire`, `sdk`, `docs`) | 6 |
| `lifecycle` | Where deprecation dates, sunset dates and stability levels are read from | 7 |
| `exclusions`, `ignore` | Named sets of things to leave out of reports, or out of the comparison | 8 |
| `versions` | Where the compared versions are read from | 9 |
| `reports` | Report presets and custom reports | 10 |

Acknowledgements live in a separate file (`api-diff.ack.yaml` or `--acknowledgements <file>`), described in section 11.

**Unknown keys and unknown rule IDs are errors.** A typo like `enum-value-aded` fails with a suggestion (`did you mean enum-value-added?`) instead of being silently ignored.

## 2. Profile and defaults

```yaml
profile: wire            # or sdk: raises the sdk-kind rules (see RULES.md)
defaults:
  fail-on: error         # error | warn | info | never; exit code 1 at or above this
  min-severity: info     # findings below this are dropped from every report
```

## 3. Options every rule supports

| Option | Values | Meaning |
|---|---|---|
| `severity` | `error`, `warn`, `info`, `off` | The rule's severity. `off` disables it. The short form `rule-id: warn` is the same as `rule-id: { severity: warn }` |
| `fix` | text | Your own fix advice, shown instead of the built-in text, e.g. a link to your API guidelines |
| `explanation` | text | Your own explanation of why this breaks clients |

**Paired rules** (the schema rules in RULES.md section 7, plus the core fallbacks) have three IDs. The more specific one wins:

```yaml
rules:
  enum-value-added: warn                 # both directions
  enum-value-added-in-request: info      # only data clients send
  enum-value-added-in-response: error    # only data clients receive
```

Every finding records where its severity came from (`severitySource` in JSON), e.g. `policy api-diff.yaml: rules.query-parameter-removed`, `--rule: rules.operation-removed`, `profile sdk` or `default`.

## 4. Rule-specific options

Only these rules take options beyond those in section 3. Every other rule takes `severity`, `fix` and `explanation` only.

`response-header-removed` and `property-removed` have a severity that depends on the change (a required header; a closed object). Their `severity` applies to the other findings, and `required-severity` / `closed-object-severity` set the dependent case. `format-changed` keeps widening formats at `info` whatever its `severity` is; `off` turns off every finding of a rule.

| Rule | Option | Default | Meaning |
|---|---|---|---|
| `operation-removed` | `unless.deprecated-for-days` | `90` | Removal is allowed (reported as `operation-removed-after-deprecation`) once the operation was deprecated at least this long. Can be per stability level: `{ stable: 90, beta: 30, alpha: 0 }` |
| `operation-removed` | `unless.past-sunset` | `true` | Removal is also allowed once the operation's sunset date has passed |
| `operation-removed` | `unless.undated-deprecation` | `allow` | For an operation marked `deprecated` with no deprecation date: `allow` counts it as deprecated long enough, `block` keeps the removal an error (the period can't be checked) |
| `enum-value-added` | `honour-open-hint` | `true` | Treat enums marked open in the spec (`x-api-diff: { enum: open }`) as `info` |
| `enum-value-added` | `open-extensions` | `[]` | Other extensions that mean "open enum", e.g. `[x-extensible-enum]` |
| `property-added-optional` | `strict-clients` | `false` | `true` raises `…-in-response` to `warn`, for clients that reject unknown fields |
| `property-removed` | `closed-object-severity` | `error` | Severity of `…-in-request` when the object has `additionalProperties: false` (clients still sending it will be rejected) |
| `parameter-removed` | `strict-servers` | `false` | `true` means the server rejects unknown parameters, so removals are `error`. Can be per location: `{ query: true, header: false, cookie: false }` |
| `parameter-*` | — | — | Every parameter rule also has location-specific IDs (`query-…`, `header-…`, `cookie-…`). The more specific ID wins |
| `response-success-status-added` | `ignore-statuses` | `[]` | Statuses that never warn when added, e.g. `[202, 204]` |
| `response-header-removed` | `required-severity` | `error` | Severity when the removed header was `required` |
| `server-url-changed` | `compare` | `full` | `full`, `path` (ignore host changes, e.g. per environment) or `off` |
| `format-changed` | `widening` | `{ int32: int64, float: double }` | Format changes treated as widening (so `int32` → `int64` in a request is `info`, not `error`) |
| `format-changed` | `equivalent` | `[]` | Formats that count as the same, e.g. `[[date-time, datetime]]` |
| `component-renamed` | `match` | `exact` | `exact` (same shape hash) or `similar` (same properties, different docs) |
| `stability-decreased` | `levels` | `[draft, alpha, beta, stable]` | Order of stability levels, lowest first |
| `version-bump-too-small`, `version-unchanged` | `scheme` | `semver` | `semver`, `calver` or `none` (`none` turns off both rules) |
| `documents-unrelated` | `min-overlap` | `0.1` | The documents count as related if any signal reaches this share: shared items ÷ the smaller document's count (the overlap coefficient) |
| `documents-unrelated` | `signals` | `[operations, operation-ids, schemas]` | Which overlaps to measure. One signal at or above `min-overlap` is enough; a signal empty on either side is skipped |
| `documents-unrelated` | `min-size` | `5` | Skip the check when the smaller document has fewer operations and fewer schemas than this |
| `documents-unrelated` | `ignore-path-segments` | `['^v\d+((alpha\|beta\|rc)\d*)?$', '^\d{4}-\d{2}-\d{2}$']` | Path segments dropped before comparing paths, anywhere in the path (`v1`, `v2beta1`, `2024-01-01`), so any number of different prefixes work |
| `documents-unrelated` | `strip-prefixes` | `[]` | Extra path prefixes removed before comparing, e.g. `[/api, /internal]` |
| `documents-unrelated` | `when` | `manual` | `manual` skips the check when both inputs are the same path at two git revisions; `always` checks those too |
| `unclassified-change` | — | — | Severity only. Set it to `error` for a strict CI gate |

## 5. Overrides

Overrides change severities for matching parts of the spec. They're checked in order and **the last match wins**. They apply per usage, so a shared component used under several paths can be affected differently in each.

```yaml
overrides:
  - match: { stability: [draft, alpha] }
    severity: info                                     # every rule
  - match: { path: "/legacy/**", method: [delete] }
    severity: off
  - match: { extension: { x-audience: partner } }
    rules: { enum-value-added-in-response: error }     # only these rules
  - match: { component: "Internal*", direction: out }
    rules: { property-removed: warn }
```

| `match` key | Matches | Example |
|---|---|---|
| `path` | Path template glob (`*` one segment, `**` any) | `"/orders/**"` |
| `method` | HTTP methods | `[get, post]` |
| `operationId` | Glob | `"admin*"` |
| `tag` | Operation tags | `[billing]` |
| `stability` | Stability level (see section 7) | `[beta]` |
| `extension` | An `x-` extension and value on the operation, schema or document | `{ x-audience: partner }` |
| `component` | Component name glob | `"Legacy*"` |
| `direction` | `in` (client sends) or `out` (client receives) | `out` |
| `kind` | `wire`, `sdk` or `docs` | `docs` |
| `rule` | Rule ID glob | `"enum-*"` |

All keys in one `match` must match (AND). A list value means any of them (OR). An override sets either `severity` (all rules) or `rules` (a map of rule IDs, same format as the top-level `rules`), not both.

How matching works:

- **Operation keys** (`path`, `method`, `operationId`, `tag`, `stability`) match the operation a finding is in. A finding about a shared component matches through the operations that use it (its `impact`). Findings with no operation (the document, a security scheme) never match operation keys.
- **Per operation:** when the operations behind one finding get different severities, the finding is split into one finding per severity, each listing its operations. A split part has its own stable finding ID.
- **`extension`** matches if the operation (or its path item), the component schema or the document root has that extension with one of the listed values.
- **Last match wins**, counting only overrides that set something for the finding's rule: an override whose `rules` map doesn't name the rule is skipped, so an earlier one can still apply.
- **`severity`** applies to every finding of every rule, including the conditional cases in section 4 (a draft operation's removed required header is `info` too). An override's `rules` map behaves like the top-level `rules`: it can set `severity` and the conditional-case option (`required-severity`, `closed-object-severity`), but no other rule options, which only the top-level `rules` can set.
- The finding's `severitySource` names the override, e.g. `policy api-diff.yaml: overrides #2 (path /legacy/**, method ["delete"])`.

## 6. Extensions

```yaml
extensions:
  x-enum-varnames: sdk      # changes are sdk findings (extension-changed, kind sdk)
  x-go-type: sdk
  x-internal: wire
  # any extension not listed is docs
```

A change to an extension listed as `sdk` is `extension-changed-sdk` (`info`, `warn` under `--profile sdk`); as `wire`, `extension-changed-wire` (`warn`). Unlisted extensions, and those listed as `docs`, are `extension-changed` (`docs`, `info`). The lifecycle extensions (section 7) and `x-api-diff` are interpreted, not classified.

## 7. Lifecycle

Where lifecycle information is read from. These settings are used by `operation-removed`, `sunset-moved-earlier`, `stability-decreased` and the stability `match` key.

```yaml
lifecycle:
  stability: x-stability-level        # extension holding draft/alpha/beta/stable
  default-stability: stable           # when the extension is missing
  deprecated-since: x-deprecated-since   # date (YYYY-MM-DD) the operation was deprecated
  sunset: x-sunset                    # date it will be removed
```

- The extensions are read from the operation, or else its path item. Dates are `YYYY-MM-DD`; anything else is `spec-invalid` at the extension.
- A stability level must be one of `stability-decreased`'s `levels` (`draft`, `alpha`, `beta`, `stable` by default); anything else, such as a typo, is `spec-invalid`. `default-stability` must be one of them too.
- Deprecation periods and sunset dates are checked against today's date (UTC), or `--as-of <YYYY-MM-DD>` for reproducible runs.
- These extensions are interpreted by the lifecycle rules, so changing them isn't also reported as `extension-changed`.

## 8. Exclusions

```yaml
exclusions:
  internal:
    paths: ["/internal/**"]
    extensions: [x-internal]          # x-internal: true
    tags: []
    operationIds: []
    components: []
ignore: []                            # sets not compared at all, e.g. [internal]
```

Nothing is excluded unless configured.

- **Membership:** an operation is in a set if any of its keys match: a `paths` glob (`*` one segment, a trailing `/**` any depth), an `operationIds` glob, one of its `tags`, or an `extensions` entry on the operation or its path item. `extensions` is a list of names (`[x-internal]`: any value except `false`) or a mapping of names to values (`{ x-audience: [internal, ops] }`). A component schema is in a set if a `components` glob or an `extensions` entry on the schema matches.
- **`ignore`:** sets listed here aren't compared. Their operations and components produce no findings; a shared component is still compared for the operations outside the set. One `not-compared` notice per set lists what was skipped.
- **Every other set** is recorded on each finding that belongs to it (`exclusions` in JSON): the finding's operation, its component, or, for a component used by several operations, only when all of them are in the set. Reports leave sets out with `exclude` (section 10, milestone M7).

## 9. Versions

```yaml
versions:
  primary:
    from: [x-api-version, info.version]   # first one present wins
  labels:
    build: x-build-id
    commit: x-git.sha
```

Sources: an `x-` extension at the document root (dots step into it: `x-git.sha` is `sha` inside `x-git`), `info.<field>`, or a JSON Pointer (`/info/x-meta/version`). The CLI options `--base-version`, `--revision-version` and `--base-label`/`--revision-label key=value` take precedence. For git inputs, `commit` is filled in automatically. Each side's `version`, `versionSource` and `labels` are in the JSON result's `compared` section.

The recorded versions are checked against the findings:

- **`version-unchanged`** (`warn`): the spec changed but the version didn't. Notices (`spec-invalid`, `ref-unresolved`, `not-compared`, `cycle-not-productive`, `documents-unrelated`) don't count as changes.
- **`version-bump-too-small`** (`warn`, semver only): any `error` finding needs a major bump, any other `wire` or `sdk` finding a minor bump, `docs`-only changes a patch bump. Below 1.0.0, each need is one level lower (breaking changes need a minor bump, as semver allows). Findings turned `off` or below `min-severity` don't count; lowered severities do. A lower version counts as no bump.
- **`scheme`** (option on either rule): `semver` (default), `calver` (only `version-unchanged` applies), or `none` (both off). A version that isn't semver under `semver` gives a `not-compared` notice rather than a guess.

## 10. Reports

```yaml
reports:
  changelog:
    exclude: [internal]                   # exclusion set names
    include:
      kinds: [wire, sdk]                  # wire | sdk | docs
      min-severity: info
      extensions: { x-audience: partner } # only findings under this
    group-by: tag                         # severity | root-cause | tag | operation | rule | owner
    format: html                          # json | txt | html
    template: ./templates/changelog.html  # html and txt only
  partner-changelog:
    extends: changelog                    # inherits everything, then overrides
    include: { extensions: { x-audience: partner } }
```

The built-in reports (`ci`, `review`, `changelog`, `sdk`, `summary`, `audit`, `explore`) are presets with these keys, so the same keys change them.

## 11. Acknowledgements file

```yaml
- finding: c7f3e1a2                       # stable finding ID from any report
  reason: "Only the mobile app sends 'archived', and it's already updated."
  owner: "@orders-team"
  expires: 2027-01-31                     # after this date the finding counts again
```

`finding`, `reason` and `expires` are required. An acknowledgement whose finding no longer appears is reported as stale (`info`), so the file can be cleaned up.

## 12. In-spec hints

Set on a schema, operation or the document, using the `x-api-diff` extension:

| Hint | Effect |
|---|---|
| `x-api-diff: { enum: open }` | Adding enum values is `info` (if `honour-open-hint` is on) |
| `x-api-diff: { ignore: true }` | This node is not compared (reported as `not-compared`) |
| `x-api-diff: { rules: { <rule-id>: <severity> } }` | Rule severities for this node and everything under it |

- **`enum: open`** goes on the schema that has the `enum`. The policy can list other extensions that mean the same, e.g. `open-extensions: [x-extensible-enum]` (section 4).
- **`ignore: true`** works on an operation, a path item or any schema. Changes inside the node are not reported, on whichever side has the hint, and an operation marked ignored is removed from other findings' affected operations; a component used only by ignored operations is not reported either. One `not-compared` notice per ignored node says what was skipped.
- **`rules`** takes the same severities as an override's `rules` (section 5): `severity` and the conditional-case option, no other rule options. For a finding, the hints checked are, in order: the nodes containing the change, nearest first; the affected operation and its path item (so an operation's hint covers the shared components it uses); then the document root. The first that names the finding's rule wins.
- **Invalid hints** (an unknown key, rule ID or value) are `spec-invalid` findings at the hint, like other problems in the spec.
- **Changes to `x-api-diff` itself** are not reported as `extension-changed`: they configure this tool, not the API.

**Precedence**, highest first: acknowledgement → in-spec hint → `overrides` (last match) → `rules` → profile default → built-in default.

For every extension a spec author can use, with defaults and examples, see [docs/spec-authors.md](docs/spec-authors.md).

## 13. Keeping these docs in sync

The docs should come from the code, not be written separately:

- Each rule is defined once in code with its metadata: ID, kind, paired or not, default severities, options (name, type, default, description), explanation and fix text. RULES.md tables and section 4 of this file are **generated** from that metadata.
- `api-diff rules` lists every rule (`--format json|txt|html`). `api-diff rules <id>` prints one rule with its options, defaults and an example.
- `api-diff schema policy` prints a JSON Schema for the policy file, for editor validation and autocomplete.
- A test fails if any rule has no description, no test case, or an option without a default.

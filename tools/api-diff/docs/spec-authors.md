# api-diff for spec authors: vendor extensions

Most of `api-diff`'s behaviour is set in the team's policy file (`api-diff.yaml`, see [POLICY.md](../POLICY.md)). Spec authors can also influence it from inside the OpenAPI document, with `x-` extensions. This page lists every one of them in one place.

Two kinds of extension matter:

- **`x-api-diff`** is `api-diff`'s own extension. Its name is fixed. It gives hints about the node it is on (section 1).
- **Everything else** is an ordinary extension your team may already use (`x-stability-level`, `x-internal`, `x-audience`, …). `api-diff` reads them because the policy tells it to. The names below are the **defaults**; your team's policy can use other names, so check `api-diff.yaml` if an extension seems to have no effect.

Status: some of these are still being built in milestone M6. Each section says whether it works today.

## At a glance

| Extension | Put it on | Effect | Policy setting | Status |
|---|---|---|---|---|
| `x-api-diff: { enum: open }` | A schema with an `enum` | Adding a value is `info`: clients must accept unknown values | `enum-value-added.honour-open-hint` | Available |
| `x-api-diff: { ignore: true }` | An operation, path item or schema | Changes inside it aren't reported; a `not-compared` notice says so | — | Available |
| `x-api-diff: { rules: { … } }` | Any operation, path item, schema, or the document | Rule severities for that node and everything under it | — | Available |
| `x-extensible-enum` (or any listed extension) | A schema with an `enum` | Same as `enum: open` | `enum-value-added.open-extensions` (empty by default) | Available |
| `x-stability-level` | An operation or path item | Its stability level (`draft`, `alpha`, `beta`, `stable`); lowering it is `stability-decreased`; overrides can match it | `lifecycle.stability`, `lifecycle.default-stability`, `stability-decreased.levels` | Available |
| Any `x-…`, e.g. `x-audience: partner` | An operation, path item, component schema or the document | Policy overrides can match on it | `overrides[].match.extension` | Available |
| `x-deprecated-since` | An operation | Date it was deprecated; removal is allowed after `deprecated-for-days` | `lifecycle.deprecated-since`, `operation-removed.unless` | Available |
| `x-sunset` | An operation | Date it will be removed; removal is allowed once it passes, and moving it earlier is a finding | `lifecycle.sunset`, `operation-removed.unless.past-sunset` | Available |
| `x-enum-varnames`, `x-go-type`, … | Anywhere | Changes to them count as `sdk` (or `wire`) changes instead of `docs` | `extensions` | M6 step 6 |
| `x-internal` | An operation, path item or schema | Puts it in an exclusion set, left out of chosen reports (or not compared) | `exclusions.<set>.extensions` | M6 step 6 |
| `x-api-version`, `x-build-id`, `x-git.sha` | The document root | The version and labels recorded in reports | `versions` | M6 step 7 |
| `x-owner` | An operation or schema | Routes findings to an owner | — | Backlog (M9) |

## 1. `x-api-diff` hints

### `enum: open`

```yaml
components:
  schemas:
    OrderStatus:
      type: string
      enum: [pending, shipped, delivered]
      x-api-diff: { enum: open }     # clients are told to handle unknown values
```

Adding a value to an enum in a response is `warn` by default, because clients with exhaustive `switch` statements may break. If your API documents that clients must accept unknown values, mark the enum open and adding values is `info`. Put the hint on the schema that has the `enum`.

Teams that already use another extension for this (for example Zalando's `x-extensible-enum`) can list it in the policy instead of adding `x-api-diff`:

```yaml
# api-diff.yaml
rules:
  enum-value-added:
    open-extensions: [x-extensible-enum]
```

A team can turn the hint off with `honour-open-hint: false`.

### `ignore: true`

```yaml
paths:
  /internal/debug:
    get:
      x-api-diff: { ignore: true }
```

Nothing inside the node is compared: no findings for the operation, its parameters or its inline schemas. A component schema used only by ignored operations isn't reported either, and ignored operations are left out of other findings' lists of affected operations. A single `not-compared` notice (`info`) records what was skipped, so it's never silent. The hint counts on whichever side has it, so marking a node ignored in a PR also hides that PR's changes to it.

Prefer the policy's exclusion sets (section 4) for whole areas of the API, such as everything internal. Use `ignore` for one-off nodes.

### `rules`

```yaml
paths:
  /pets:
    get:
      x-api-diff:
        rules:
          parameter-removed: error             # this operation's clients can't cope
          enum-value-added-in-response: info
```

Sets rule severities (`error`, `warn`, `info` or `off`) for the node and everything under it. Use the same rule IDs as the policy file; `api-diff rules` lists them, and [docs/rules/](rules/README.md) has a page for each. For rules whose severity depends on the change, the extra option is also allowed: `response-header-removed: { required-severity: warn }`, `property-removed: { closed-object-severity: warn }`.

Which hint applies, in order (the first that names the rule wins):

1. Hints on the nodes containing the change, nearest first.
2. The affected operation, then its path item. This is how an operation's hint covers a shared component it uses; if several operations use the component and their hints differ, the finding is split per operation.
3. The document root.

Hints beat the policy file (overrides and rules); only acknowledgements beat hints.

### Mistakes and changes

- An unknown key, rule ID or severity in `x-api-diff` is reported as `spec-invalid` (`error`) at the hint, with a suggestion such as `did you mean parameter-removed?`.
- Adding, changing or removing `x-api-diff` is never reported as a change to the API.

## 2. Lifecycle: stability, deprecation and sunset

```yaml
paths:
  /pets/{id}/photos:
    get:
      x-stability-level: beta
      deprecated: true
      x-deprecated-since: 2026-09-01
      x-sunset: 2027-03-01
```

- **`x-stability-level`** (`draft`, `alpha`, `beta`, `stable`) on an operation or its path item. Without it, the operation counts as `default-stability` (`stable` by default). Lowering the level (`stable` → `beta`) is `stability-decreased` (`error`). A level that isn't in the policy's list (`stability-decreased.levels`), such as a typo, is `spec-invalid`. Policy overrides can match it, for example "anything goes before beta": `match: { stability: [draft, alpha] }`, `severity: info`.
- **`deprecated: true`** (standard OpenAPI) on an operation, parameter, schema or property is `deprecated-added` (`info`); removing it is `deprecated-removed` (`info`).
- **`x-deprecated-since`** (a `YYYY-MM-DD` date) on a deprecated operation: removing it is allowed once it was deprecated at least `deprecated-for-days` (90 by default; the policy can set it per stability level), and is reported as `operation-removed-after-deprecation` (`info`) instead of `operation-removed` (`error`). If the date is missing, the deprecation counts as long enough unless the policy sets `undated-deprecation: block`; adding the date is still good practice.
- **`x-sunset`** (a `YYYY-MM-DD` date): removal is also allowed once the sunset date has passed, even without `deprecated`. Moving the date earlier is `sunset-moved-earlier` (`warn`).
- Dates are checked against the day `api-diff` runs (UTC), or the date given with `--as-of`. A value that isn't a real `YYYY-MM-DD` date is `spec-invalid`.
- Changing these extensions isn't also reported as `extension-changed`.

The extension names are set in the policy's `lifecycle` section.

## 3. Extensions that overrides match

```yaml
paths:
  /partners/orders:
    get:
      x-audience: partner
```

```yaml
# api-diff.yaml
overrides:
  - match: { extension: { x-audience: partner } }
    rules: { enum-value-added-in-response: error }   # partners use strict clients
```

Any `x-` extension on an operation, its path item, a component schema or the document root can be matched by a policy override. The value must be equal (a list in the policy means any of them). *Available.* See [POLICY.md section 5](../POLICY.md).

## 4. Exclusions

```yaml
paths:
  /internal/metrics:
    get:
      x-internal: true
```

The policy defines named exclusion sets, for example `internal` by path, tag or extension. Reports can leave a set out (the public changelog skips internal operations), or the policy can `ignore` a set so it isn't compared at all. Nothing is excluded unless the policy says so. *M6 step 6.*

## 5. Extensions that change the kind of a change

Changes to `x-` extensions are normally `docs` changes (`extension-changed`, `info`). The policy can say some extensions matter to SDK generators or to the wire format instead:

```yaml
# api-diff.yaml
extensions:
  x-enum-varnames: sdk     # renaming generated enum constants breaks SDK users
  x-go-type: sdk
```

Changing such an extension is then an `sdk` finding, raised under `--profile sdk`. *M6 step 6.*

## 6. Versions and labels

```yaml
openapi: 3.1.0
x-api-version: 2.4.0
x-build-id: "8812"
info:
  version: 2.4.0
```

Every report records the versions it compared. By default that's `info.version`; the policy's `versions` section can read it from another extension (`x-api-version`) and add labels (`x-build-id`, `x-git.sha`). Comparing versions also powers `version-unchanged` and `version-bump-too-small`. *M6 step 7.*

## See also

- [POLICY.md](../POLICY.md): the policy file, including section 12 (in-spec hints)
- [docs/rules/](rules/README.md): every rule, its default severity and its options

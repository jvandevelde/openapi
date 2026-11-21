# api-diff: initial rules

Status: **design document.** This explains the rule set and its reasoning. The maintained reference, with one generated page per rule (description, defaults, an example from its test case, policy options and fix), is [docs/rules/](docs/rules/README.md); each rule ID below links to its page. Every severity can be changed in the policy file. [POLICY.md](POLICY.md) documents the options each rule supports. Judgement calls where reasonable teams disagree are marked **Decided** with the agreed default.

## How to read this

- **Rule ID**: stable, kebab-case: `<subject>-<change>`, with `-in-request` / `-in-response` when the direction matters. Here *request* means data the client **sends** (request bodies, parameters, request headers), and *response* means data the client **receives**. For shared components, direction is decided per usage (see PLAN.md, *Shared components*).
- **Kind**: `wire` (the JSON changes), `sdk` (generated code changes) or `docs` (annotations only).
- **Default**: the severity with the default `wire` profile. For `sdk` rules, **sdk** shows the severity under `--profile sdk`. Under `--profile wire`, `sdk` rules are `info`.
- **Phase**: when the rule is built (see PLAN.md, *Phases*).
- Severities: `error` (breaks clients), `warn` (might break, can't tell from the spec), `info` (safe, but reported).

Schema rules come in pairs. **in / out** shows the default for the request and response directions, e.g. `error / info` means `…-in-request` is `error` and `…-in-response` is `info`.

## 1. Core variance rules (fallbacks)

These cover any schema change that no specific rule below matches. A specific rule always wins, because it gives a clearer message and fix.

| Rule | Meaning | in / out | Phase |
|---|---|---|---|
| [`schema-narrowed`](docs/rules/schema-narrowed.md) | The schema accepts fewer values than before | error / info | 2 |
| [`schema-widened`](docs/rules/schema-widened.md) | The schema accepts more values than before | info / warn | 2 |
| [`schema-incompatible`](docs/rules/schema-incompatible.md) | Neither a subset nor a superset (e.g. `string` → `integer`) | error / error | 2 |
| [`unclassified-change`](docs/rules/unclassified-change.md) | The shape hash changed but no rule matched (safety net) | warn | 2 |

## 2. Paths and operations

| Rule | Meaning | Kind | Default | Phase |
|---|---|---|---|---|
| [`operation-added`](docs/rules/operation-added.md) | New operation | wire | info | 1 |
| [`operation-removed`](docs/rules/operation-removed.md) | Operation removed, and it wasn't deprecated for long enough first | wire | error | 1 |
| [`operation-removed-after-deprecation`](docs/rules/operation-removed-after-deprecation.md) | Removed after the configured deprecation period (default 90 days) | wire | info | 3 |
| [`operation-id-changed`](docs/rules/operation-id-changed.md) | Same method and path, different `operationId` | sdk | info · **sdk: error** | 1 |
| [`path-param-renamed`](docs/rules/path-param-renamed.md) | `/users/{id}` → `/users/{userId}` (same endpoint) | sdk | info · **sdk: warn** | 1 |
| [`operation-path-changed`](docs/rules/operation-path-changed.md) | The path template changed but the operation is the same (matched by `operationId`), e.g. a path parameter was added or removed, or `/orders/{id}` → `/v2/orders/{id}`. Old clients call a URL that no longer exists | wire | error | 1 |
| [`operation-tags-changed`](docs/rules/operation-tags-changed.md) | Tags changed (many generators group methods into classes by tag) | sdk | info · **sdk: warn** | 1 |
| [`server-url-changed`](docs/rules/server-url-changed.md) | A `servers` URL changed or was removed (document, path or operation level) | wire | warn | 1 |

## 3. Security

| Rule | Meaning | Kind | Default | Phase |
|---|---|---|---|---|
| [`security-requirement-added`](docs/rules/security-requirement-added.md) | An operation now requires auth, or an additional scheme | wire | error | 1 |
| [`security-requirement-removed`](docs/rules/security-requirement-removed.md) | Less auth required | wire | info | 1 |
| [`security-alternative-added`](docs/rules/security-alternative-added.md) | A new alternative was added to the OR list (clients can keep using the old one) | wire | info | 1 |
| [`security-alternative-removed`](docs/rules/security-alternative-removed.md) | An alternative some clients may use was removed | wire | error | 1 |
| [`security-scope-added`](docs/rules/security-scope-added.md) | A required OAuth scope was added | wire | error | 1 |
| [`security-scope-removed`](docs/rules/security-scope-removed.md) | A required scope was removed | wire | info | 1 |
| [`security-scheme-changed`](docs/rules/security-scheme-changed.md) | The scheme's type, location (`in`), name or flow URLs changed | wire | error | 1 |

## 4. Parameters (path, query, header, cookie)

The parameter's location changes what a removal or addition means, so parameter rules are **split by location**, the same way schema rules are split by direction. `parameter-removed` sets all locations, and `query-parameter-removed`, `header-parameter-removed` and `cookie-parameter-removed` set one. The more specific ID wins.

**Path parameters are different.** They're always required and part of the URL, so they can't be removed, added or made optional without changing the path template, and a changed template is a different endpoint. Those changes are reported as operation changes (`operation-path-changed`, or `operation-removed` + `operation-added`), never as parameter changes. A renamed path parameter in the same position is `path-param-renamed` (section 2). A path parameter declared but missing from the template is `spec-invalid`.

Parameters are matched by location and name. Header names are compared case-insensitively. `Accept`, `Content-Type` and `Authorization` declared as header parameters are skipped, because OpenAPI says to ignore them. They're covered by media type and security rules instead.

| Rule | Meaning | query | header | cookie | Phase |
|---|---|---|---|---|---|
| [`parameter-added-required`](docs/rules/parameter-added-required.md) | New required parameter: old clients don't send it | error | error | error | 1 |
| [`parameter-added-optional`](docs/rules/parameter-added-optional.md) | New optional parameter | info | info | info | 1 |
| [`parameter-removed`](docs/rules/parameter-removed.md) | Clients still send it. Usually the server ignores it, so behaviour silently changes (e.g. a removed `?status=` filter now returns everything). If the server rejects unknown parameters, the request fails. **Decided:** servers are assumed lenient (`strict-servers: false`) | warn | warn | warn | 1 |
| [`parameter-became-required`](docs/rules/parameter-became-required.md) | Optional → required | error | error | error | 1 |
| [`parameter-became-optional`](docs/rules/parameter-became-optional.md) | Required → optional | info | info | info | 1 |
| [`parameter-location-changed`](docs/rules/parameter-location-changed.md) | e.g. `query` → `header`. Old clients send it in the wrong place. Changes to or from `path` are reported as `operation-path-changed` | error | error | error | 1 |
| [`parameter-serialization-changed`](docs/rules/parameter-serialization-changed.md) | `style`, `explode`, `allowReserved` or the `content` media type changed | error | error | error | 1 |
| [`parameter-renamed`](docs/rules/parameter-renamed.md) | A detected rename (same schema and position in the list, new name). Wire: old clients send the old name, so it's also reported as removed + added | sdk: error | sdk: error | sdk: error | 4 |

All of these except `parameter-renamed` are kind `wire`. Under `--profile sdk`, `parameter-removed` is `error` in every location, because the parameter disappears from the generated method signature.

Parameter **schemas** are always *request* direction, so they use the schema rules in section 7.

## 5. Request bodies

| Rule | Meaning | Kind | Default | Phase |
|---|---|---|---|---|
| [`request-body-added-required`](docs/rules/request-body-added-required.md) | An operation that had no body now requires one | wire | error | 1 |
| [`request-body-added-optional`](docs/rules/request-body-added-optional.md) | New optional body | wire | info | 1 |
| [`request-body-became-required`](docs/rules/request-body-became-required.md) | Optional → required | wire | error | 1 |
| [`request-body-became-optional`](docs/rules/request-body-became-optional.md) | Required → optional | wire | info | 1 |
| [`request-body-removed`](docs/rules/request-body-removed.md) | Body removed; clients still send one. **Decided** | wire | warn | 1 |
| [`request-media-type-added`](docs/rules/request-media-type-added.md) | e.g. `application/xml` added | wire | info | 1 |
| [`request-media-type-removed`](docs/rules/request-media-type-removed.md) | A media type clients may send was removed | wire | error | 1 |

## 6. Responses

| Rule | Meaning | Kind | Default | Phase |
|---|---|---|---|---|
| [`response-success-status-added`](docs/rules/response-success-status-added.md) | New 1xx/2xx/3xx, e.g. 202 alongside 200 (clients may only handle 200). **Decided** | wire | warn | 1 |
| [`response-success-status-removed`](docs/rules/response-success-status-removed.md) | A 1xx/2xx/3xx clients rely on was removed. **Decided:** 1xx and 3xx count as success statuses | wire | error | 1 |
| [`response-error-status-added`](docs/rules/response-error-status-added.md) | New 4xx/5xx documented | wire | info | 1 |
| [`response-error-status-removed`](docs/rules/response-error-status-removed.md) | A documented 4xx/5xx was removed | wire | info | 1 |
| [`response-status-range-widened`](docs/rules/response-status-range-widened.md) | Specific codes replaced by their range (`200` → `2XX`): not a removal, but clients may now get other codes in the range. The two responses are compared. **Decided** | wire | info | 1 |
| [`response-status-range-narrowed`](docs/rules/response-status-range-narrowed.md) | A range replaced by specific codes (`2XX` → `200`): not a removal; the range response is compared with each code. **Decided** | wire | info | 1 |
| [`response-default-removed`](docs/rules/response-default-removed.md) | The `default` response was removed | wire | warn | 1 |
| [`response-media-type-added`](docs/rules/response-media-type-added.md) | New media type (only sent if the client asks for it) | wire | info | 1 |
| [`response-media-type-removed`](docs/rules/response-media-type-removed.md) | A media type clients may request was removed | wire | error | 1 |
| [`response-body-removed`](docs/rules/response-body-removed.md) | A response that had a body now has none | wire | error | 1 |
| [`response-header-added`](docs/rules/response-header-added.md) | New response header | wire | info | 1 |
| [`response-header-removed`](docs/rules/response-header-removed.md) | A response header was removed (`error` if it was `required`) | wire | warn | 1 |
| [`response-header-became-optional`](docs/rules/response-header-became-optional.md) | Required → optional | wire | error | 1 |

## 7. Schemas (bodies, parameters, headers; per usage)

### Properties and objects

| Rule | Meaning | in / out | Phase |
|---|---|---|---|
| [`property-added-required`](docs/rules/property-added-required.md) | New required property | error / info | 2 |
| [`property-added-optional`](docs/rules/property-added-optional.md) | New optional property. In responses this assumes clients ignore unknown fields. **Decided** | info / info | 2 |
| [`property-removed`](docs/rules/property-removed.md) | Property removed. In requests clients keep sending it; `error` if the object disallows additional properties | warn / error | 2 |
| [`property-became-required`](docs/rules/property-became-required.md) | Optional → required | error / info | 2 |
| [`property-became-optional`](docs/rules/property-became-optional.md) | Required → optional (clients may assume it's always there) | info / error | 2 |
| [`property-became-read-only`](docs/rules/property-became-read-only.md) | `readOnly: true` added: it disappears from the request side | warn / info | 2 |
| [`property-became-write-only`](docs/rules/property-became-write-only.md) | `writeOnly: true` added: it disappears from the response side | info / error | 2 |
| [`additional-properties-restricted`](docs/rules/additional-properties-restricted.md) | `additionalProperties` became `false` or a narrower schema | error / info | 2 |
| [`additional-properties-allowed`](docs/rules/additional-properties-allowed.md) | `additionalProperties` became `true` or wider | info / warn | 2 |
| [`min-properties-increased`](docs/rules/min-properties-increased.md) / [`max-properties-decreased`](docs/rules/max-properties-decreased.md) | Fewer objects are valid | error / info | 2 |
| [`min-properties-decreased`](docs/rules/min-properties-decreased.md) / [`max-properties-increased`](docs/rules/max-properties-increased.md) | More objects are valid | info / warn | 2 |

### Types, formats and nullability

| Rule | Meaning | in / out | Phase |
|---|---|---|---|
| [`type-changed`](docs/rules/type-changed.md) | Incompatible type, e.g. `string` → `integer` | error / error | 2 |
| [`type-widened`](docs/rules/type-widened.md) | e.g. `integer` → `number`, or a type added to a type array | info / error | 2 |
| [`type-narrowed`](docs/rules/type-narrowed.md) | e.g. `number` → `integer` | error / info | 2 |
| [`nullable-added`](docs/rules/nullable-added.md) | `null` now allowed (3.0 `nullable` or 3.1 `type: [.., "null"]`) | info / error | 2 |
| [`nullable-removed`](docs/rules/nullable-removed.md) | `null` no longer allowed | error / info | 2 |
| [`format-added`](docs/rules/format-added.md) | e.g. a plain `string` becomes `format: uuid` | error / info | 2 |
| [`format-removed`](docs/rules/format-removed.md) | e.g. `format: date-time` dropped | info / warn | 2 |
| [`format-changed`](docs/rules/format-changed.md) | e.g. `date-time` → `date` | error / error | 2 |
| [`const-changed`](docs/rules/const-changed.md) | `const` value changed | error / error | 2 |
| [`default-changed`](docs/rules/default-changed.md) | `default` changed: server behaviour changes when the field is omitted | warn / warn | 2 |

### Enums

| Rule | Meaning | in / out | Phase |
|---|---|---|---|
| [`enum-value-added`](docs/rules/enum-value-added.md) | A new allowed value. In responses, clients with exhaustive switches break. **Decided** | info / warn | 2 |
| [`enum-value-removed`](docs/rules/enum-value-removed.md) | A value is no longer allowed | error / info | 2 |
| [`enum-added`](docs/rules/enum-added.md) | A free value became a closed set | error / info | 2 |
| [`enum-removed`](docs/rules/enum-removed.md) | A closed set became a free value | info / warn | 2 |

An enum marked open in the spec (`x-api-diff: { enum: open }`) makes `enum-value-added-in-response` `info` for that schema.

### Limits (strings, numbers, arrays)

| Rule | Meaning | in / out | Phase |
|---|---|---|---|
| [`max-length-decreased`](docs/rules/max-length-decreased.md), [`min-length-increased`](docs/rules/min-length-increased.md) | Fewer strings are valid | error / info | 2 |
| [`max-length-increased`](docs/rules/max-length-increased.md), [`min-length-decreased`](docs/rules/min-length-decreased.md) | More strings are valid (in responses: buffers, DB columns) | info / warn | 2 |
| [`maximum-decreased`](docs/rules/maximum-decreased.md), [`minimum-increased`](docs/rules/minimum-increased.md) (incl. exclusive) | Fewer numbers are valid | error / info | 2 |
| [`maximum-increased`](docs/rules/maximum-increased.md), [`minimum-decreased`](docs/rules/minimum-decreased.md) (incl. exclusive) | More numbers are valid | info / warn | 2 |
| [`multiple-of-changed`](docs/rules/multiple-of-changed.md) | `multipleOf` changed (narrowed or widened is worked out) | error / warn | 2 |
| [`max-items-decreased`](docs/rules/max-items-decreased.md), [`min-items-increased`](docs/rules/min-items-increased.md) | Fewer arrays are valid | error / info | 2 |
| [`max-items-increased`](docs/rules/max-items-increased.md), [`min-items-decreased`](docs/rules/min-items-decreased.md) | More arrays are valid | info / warn | 2 |
| [`unique-items-added`](docs/rules/unique-items-added.md) | `uniqueItems: true` added | error / info | 2 |
| [`unique-items-removed`](docs/rules/unique-items-removed.md) | `uniqueItems` dropped | info / warn | 2 |
| [`pattern-added`](docs/rules/pattern-added.md) | A pattern was added to a string | error / info | 2 |
| [`pattern-removed`](docs/rules/pattern-removed.md) | Pattern dropped | info / warn | 2 |
| [`pattern-changed`](docs/rules/pattern-changed.md) | Pattern changed. `warn` both ways until regex comparison exists (backlog) | warn / warn | 2 |

### Composition (`oneOf`, `anyOf`, `allOf`, discriminator)

`allOf` has no rules of its own: we compare the merged (effective) schema, so its changes show up as the property and keyword rules above.

| Rule | Meaning | in / out | Phase |
|---|---|---|---|
| [`union-branch-added`](docs/rules/union-branch-added.md) | New `oneOf`/`anyOf` branch | info / warn | 2 |
| [`union-branch-removed`](docs/rules/union-branch-removed.md) | A branch was removed | error / info | 2 |
| [`union-kind-changed`](docs/rules/union-kind-changed.md) | `anyOf` ↔ `oneOf`. wire: values that match several branches change validity. sdk: generated union types change | warn / warn · **sdk: error** | 2 |
| [`discriminator-property-changed`](docs/rules/discriminator-property-changed.md) | `discriminator.propertyName` changed | error / error | 2 |
| [`discriminator-mapping-added`](docs/rules/discriminator-mapping-added.md) | New mapping value | info / warn | 2 |
| [`discriminator-mapping-removed`](docs/rules/discriminator-mapping-removed.md) | A mapping value was removed | error / info | 2 |
| [`discriminator-mapping-changed`](docs/rules/discriminator-mapping-changed.md) | A value now maps to a different schema | error / error | 2 |

## 8. References and components

| Rule | Meaning | Kind | Default | Phase |
|---|---|---|---|---|
| [`ref-target-changed`](docs/rules/ref-target-changed.md) | `$ref: Customer` → `$ref: CustomerV2`. Field-level differences appear as child findings | sdk | info · **sdk: error** | 2 |
| [`ref-inlined`](docs/rules/ref-inlined.md) | A `$ref` was replaced by an identical inline schema (the named type disappears) | sdk | info · **sdk: error** | 2 |
| [`ref-extracted`](docs/rules/ref-extracted.md) | An inline schema became a `$ref` (a new named type appears) | sdk | info · **sdk: warn** | 2 |
| [`component-renamed`](docs/rules/component-renamed.md) | Same structure, new name (detected by hash) | sdk | info · **sdk: error** | 4 |
| [`schema-title-changed`](docs/rules/schema-title-changed.md) | `title` changed (some generators name types from it) | sdk | info · **sdk: warn** | 2 |
| [`component-added`](docs/rules/component-added.md) / [`component-removed`](docs/rules/component-removed.md) | An unused component was added or removed | wire | info | 2 |
| [`component-unused`](docs/rules/component-unused.md) | A changed component has no usages | wire | info | 2 |

## 9. Lifecycle and versions

| Rule | Meaning | Kind | Default | Phase |
|---|---|---|---|---|
| [`deprecated-added`](docs/rules/deprecated-added.md) | An operation, parameter, property or schema was marked deprecated | wire | info | 3 |
| [`deprecated-removed`](docs/rules/deprecated-removed.md) | Deprecation was withdrawn | wire | info | 3 |
| [`sunset-moved-earlier`](docs/rules/sunset-moved-earlier.md) | A sunset date (`x-sunset` or configured extension) moved earlier | wire | warn | 3 |
| [`stability-decreased`](docs/rules/stability-decreased.md) | e.g. `stable` → `beta` | wire | error | 3 |
| [`version-bump-too-small`](docs/rules/version-bump-too-small.md) | The recorded version bump is smaller than the changes need (e.g. minor bump with breaking changes) | wire | warn | 3 |
| [`version-unchanged`](docs/rules/version-unchanged.md) | The spec changed but the version didn't | wire | warn | 3 |

Changes to operations marked `draft` or `alpha` are lowered to `info` by default policy (`x-stability-level`, or a configured extension).

## 10. Docs (annotations only)

All `docs` kind, default `info`, phase 2. They appear in the **diff** view and in `audit`, not in **breaking**.

[`description-changed`](docs/rules/description-changed.md), [`summary-changed`](docs/rules/summary-changed.md), [`title-changed`](docs/rules/title-changed.md) (outside schemas; schema titles are in section 8), [`example-changed`](docs/rules/example-changed.md), [`external-docs-changed`](docs/rules/external-docs-changed.md), [`tag-added`](docs/rules/tag-added.md), [`tag-removed`](docs/rules/tag-removed.md), [`tag-description-changed`](docs/rules/tag-description-changed.md), [`info-changed`](docs/rules/info-changed.md) (contact, license, terms), [`extension-changed`](docs/rules/extension-changed.md) (any `x-` extension the policy doesn't classify as `wire` or `sdk`).

## 11. Spec and engine notices

| Rule | Meaning | Default | Phase |
|---|---|---|---|
| [`spec-invalid`](docs/rules/spec-invalid.md) | A document failed to load or validate (with location) | error | 1 |
| [`ref-unresolved`](docs/rules/ref-unresolved.md) | A `$ref` points nowhere | error | 1 |
| [`cycle-not-productive`](docs/rules/cycle-not-productive.md) | A cycle with no property or `items` step, e.g. `A: allOf [$ref A]` | error | 2 |
| [`documents-unrelated`](docs/rules/documents-unrelated.md) | The two documents share almost no operations, `operationId`s or schema names, and the title or server hosts differ, so they look like different APIs (usually a wrong path). Measured per signal as shared items ÷ the smaller document's count. The diff stops and this is the only finding; set it to `off` for an intentional rewrite | error | 3 |
| [`not-compared`](docs/rules/not-compared.md) | Parts of the spec that weren't compared: webhooks, callbacks, `ignore`d exclusions | info | 1 |

## Counts

| Section | Rule IDs |
|---|---|
| 1. Core fallbacks | 4 |
| 2–6. Operations, security, parameters, request bodies, responses | 41 (parameter rules count once, not once per location) |
| 7. Schemas (each one is a request/response pair) | 52 |
| 8–11. References, lifecycle, docs, notices | 29 |
| **Total** | **about 125** (about 180 counting both directions of each pair) |

Phase 1 builds sections 2–6 and the notices. Phase 2 builds the schema, reference and docs rules.

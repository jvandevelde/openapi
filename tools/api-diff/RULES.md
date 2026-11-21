# api-diff: initial rules

Status: **draft for review**. This is the first set of rules, with their default severities. Every severity can be changed in the policy file (see [PLAN.md](PLAN.md)). **⚑** marks a judgement call where reasonable teams disagree; these are the ones to agree on in phase 0.

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
| `schema-narrowed` | The schema accepts fewer values than before | error / info | 2 |
| `schema-widened` | The schema accepts more values than before | info / warn | 2 |
| `schema-incompatible` | Neither a subset nor a superset (e.g. `string` → `integer`) | error / error | 2 |
| `unclassified-change` | The shape hash changed but no rule matched (safety net) | warn | 2 |

## 2. Paths and operations

| Rule | Meaning | Kind | Default | Phase |
|---|---|---|---|---|
| `operation-added` | New operation | wire | info | 1 |
| `operation-removed` | Operation removed, and it wasn't deprecated for long enough first | wire | error | 1 |
| `operation-removed-after-deprecation` | Removed after the configured deprecation period (default 90 days) | wire | info | 3 |
| `operation-id-changed` | Same method and path, different `operationId` | sdk | info · **sdk: error** | 1 |
| `path-param-renamed` | `/users/{id}` → `/users/{userId}` (same endpoint) | sdk | info · **sdk: warn** | 1 |
| `operation-tags-changed` | Tags changed (many generators group methods into classes by tag) | sdk | info · **sdk: warn** | 1 |
| `server-url-changed` | A `servers` URL changed or was removed (document, path or operation level) | wire | warn | 1 |

## 3. Security

| Rule | Meaning | Kind | Default | Phase |
|---|---|---|---|---|
| `security-requirement-added` | An operation now requires auth, or an additional scheme | wire | error | 1 |
| `security-requirement-removed` | Less auth required | wire | info | 1 |
| `security-alternative-added` | A new alternative was added to the OR list (clients can keep using the old one) | wire | info | 1 |
| `security-alternative-removed` | An alternative some clients may use was removed | wire | error | 1 |
| `security-scope-added` | A required OAuth scope was added | wire | error | 1 |
| `security-scope-removed` | A required scope was removed | wire | info | 1 |
| `security-scheme-changed` | The scheme's type, location (`in`), name or flow URLs changed | wire | error | 1 |

## 4. Parameters (path, query, header, cookie)

| Rule | Meaning | Kind | Default | Phase |
|---|---|---|---|---|
| `parameter-added-required` | New required parameter | wire | error | 1 |
| `parameter-added-optional` | New optional parameter | wire | info | 1 |
| `parameter-removed` | Parameter removed; clients that still send it may be rejected or ignored ⚑ | wire | warn · **sdk: error** | 1 |
| `parameter-became-required` | Optional → required | wire | error | 1 |
| `parameter-became-optional` | Required → optional | wire | info | 1 |
| `parameter-location-changed` | e.g. `query` → `header` | wire | error | 1 |
| `parameter-serialization-changed` | `style`, `explode`, `allowReserved` or the `content` media type changed | wire | error | 1 |
| `parameter-renamed` | Same position (path) or detected rename, new name | sdk | **sdk: error** (wire: see `parameter-removed` + `parameter-added-*`) | 4 |

Parameter **schemas** are always *request* direction, so they use the schema rules in section 7.

## 5. Request bodies

| Rule | Meaning | Kind | Default | Phase |
|---|---|---|---|---|
| `request-body-added-required` | An operation that had no body now requires one | wire | error | 1 |
| `request-body-added-optional` | New optional body | wire | info | 1 |
| `request-body-became-required` | Optional → required | wire | error | 1 |
| `request-body-became-optional` | Required → optional | wire | info | 1 |
| `request-body-removed` | Body removed; clients still send one ⚑ | wire | warn | 1 |
| `request-media-type-added` | e.g. `application/xml` added | wire | info | 1 |
| `request-media-type-removed` | A media type clients may send was removed | wire | error | 1 |

## 6. Responses

| Rule | Meaning | Kind | Default | Phase |
|---|---|---|---|---|
| `response-success-status-added` | New 2xx, e.g. 202 alongside 200 (clients may only handle 200) ⚑ | wire | warn | 1 |
| `response-success-status-removed` | A 2xx clients rely on was removed | wire | error | 1 |
| `response-error-status-added` | New 4xx/5xx documented | wire | info | 1 |
| `response-error-status-removed` | A documented 4xx/5xx was removed | wire | info | 1 |
| `response-default-removed` | The `default` response was removed | wire | warn | 1 |
| `response-media-type-added` | New media type (only sent if the client asks for it) | wire | info | 1 |
| `response-media-type-removed` | A media type clients may request was removed | wire | error | 1 |
| `response-body-removed` | A response that had a body now has none | wire | error | 1 |
| `response-header-added` | New response header | wire | info | 1 |
| `response-header-removed` | A response header was removed (`error` if it was `required`) | wire | warn | 1 |
| `response-header-became-optional` | Required → optional | wire | error | 1 |

## 7. Schemas (bodies, parameters, headers; per usage)

### Properties and objects

| Rule | Meaning | in / out | Phase |
|---|---|---|---|
| `property-added-required` | New required property | error / info | 2 |
| `property-added-optional` | New optional property. In responses this assumes clients ignore unknown fields ⚑ | info / info | 2 |
| `property-removed` | Property removed. In requests clients keep sending it; `error` if the object disallows additional properties | warn / error | 2 |
| `property-became-required` | Optional → required | error / info | 2 |
| `property-became-optional` | Required → optional (clients may assume it's always there) | info / error | 2 |
| `property-became-read-only` | `readOnly: true` added: it disappears from the request side | warn / info | 2 |
| `property-became-write-only` | `writeOnly: true` added: it disappears from the response side | info / error | 2 |
| `additional-properties-restricted` | `additionalProperties` became `false` or a narrower schema | error / info | 2 |
| `additional-properties-allowed` | `additionalProperties` became `true` or wider | info / warn | 2 |
| `min-properties-increased` / `max-properties-decreased` | Fewer objects are valid | error / info | 2 |
| `min-properties-decreased` / `max-properties-increased` | More objects are valid | info / warn | 2 |

### Types, formats and nullability

| Rule | Meaning | in / out | Phase |
|---|---|---|---|
| `type-changed` | Incompatible type, e.g. `string` → `integer` | error / error | 2 |
| `type-widened` | e.g. `integer` → `number`, or a type added to a type array | info / error | 2 |
| `type-narrowed` | e.g. `number` → `integer` | error / info | 2 |
| `nullable-added` | `null` now allowed (3.0 `nullable` or 3.1 `type: [.., "null"]`) | info / error | 2 |
| `nullable-removed` | `null` no longer allowed | error / info | 2 |
| `format-added` | e.g. a plain `string` becomes `format: uuid` | error / info | 2 |
| `format-removed` | e.g. `format: date-time` dropped | info / warn | 2 |
| `format-changed` | e.g. `date-time` → `date` | error / error | 2 |
| `const-changed` | `const` value changed | error / error | 2 |
| `default-changed` | `default` changed: server behaviour changes when the field is omitted | warn / warn | 2 |

### Enums

| Rule | Meaning | in / out | Phase |
|---|---|---|---|
| `enum-value-added` | A new allowed value. In responses, clients with exhaustive switches break ⚑ | info / warn | 2 |
| `enum-value-removed` | A value is no longer allowed | error / info | 2 |
| `enum-added` | A free value became a closed set | error / info | 2 |
| `enum-removed` | A closed set became a free value | info / warn | 2 |

An enum marked open in the spec (`x-api-diff: { enum: open }`) makes `enum-value-added-in-response` `info` for that schema.

### Limits (strings, numbers, arrays)

| Rule | Meaning | in / out | Phase |
|---|---|---|---|
| `max-length-decreased`, `min-length-increased` | Fewer strings are valid | error / info | 2 |
| `max-length-increased`, `min-length-decreased` | More strings are valid (in responses: buffers, DB columns) | info / warn | 2 |
| `maximum-decreased`, `minimum-increased` (incl. exclusive) | Fewer numbers are valid | error / info | 2 |
| `maximum-increased`, `minimum-decreased` (incl. exclusive) | More numbers are valid | info / warn | 2 |
| `multiple-of-changed` | `multipleOf` changed (narrowed or widened is worked out) | error / warn | 2 |
| `max-items-decreased`, `min-items-increased` | Fewer arrays are valid | error / info | 2 |
| `max-items-increased`, `min-items-decreased` | More arrays are valid | info / warn | 2 |
| `unique-items-added` | `uniqueItems: true` added | error / info | 2 |
| `unique-items-removed` | `uniqueItems` dropped | info / warn | 2 |
| `pattern-added` | A pattern was added to a string | error / info | 2 |
| `pattern-removed` | Pattern dropped | info / warn | 2 |
| `pattern-changed` | Pattern changed. `warn` both ways until regex comparison exists (backlog) | warn / warn | 2 |

### Composition (`oneOf`, `anyOf`, `allOf`, discriminator)

`allOf` has no rules of its own: we compare the merged (effective) schema, so its changes show up as the property and keyword rules above.

| Rule | Meaning | in / out | Phase |
|---|---|---|---|
| `union-branch-added` | New `oneOf`/`anyOf` branch | info / warn | 2 |
| `union-branch-removed` | A branch was removed | error / info | 2 |
| `union-kind-changed` | `anyOf` ↔ `oneOf`. wire: values that match several branches change validity. sdk: generated union types change | warn / warn · **sdk: error** | 2 |
| `discriminator-property-changed` | `discriminator.propertyName` changed | error / error | 2 |
| `discriminator-mapping-added` | New mapping value | info / warn | 2 |
| `discriminator-mapping-removed` | A mapping value was removed | error / info | 2 |
| `discriminator-mapping-changed` | A value now maps to a different schema | error / error | 2 |

## 8. References and components

| Rule | Meaning | Kind | Default | Phase |
|---|---|---|---|---|
| `ref-target-changed` | `$ref: Customer` → `$ref: CustomerV2`. Field-level differences appear as child findings | sdk | info · **sdk: error** | 2 |
| `ref-inlined` | A `$ref` was replaced by an identical inline schema (the named type disappears) | sdk | info · **sdk: error** | 2 |
| `ref-extracted` | An inline schema became a `$ref` (a new named type appears) | sdk | info · **sdk: warn** | 2 |
| `component-renamed` | Same structure, new name (detected by hash) | sdk | info · **sdk: error** | 4 |
| `schema-title-changed` | `title` changed (some generators name types from it) | sdk | info · **sdk: warn** | 2 |
| `component-added` / `component-removed` | An unused component was added or removed | wire | info | 2 |
| `component-unused` | A changed component has no usages | wire | info | 2 |

## 9. Lifecycle and versions

| Rule | Meaning | Kind | Default | Phase |
|---|---|---|---|---|
| `deprecated-added` | An operation, parameter, property or schema was marked deprecated | wire | info | 3 |
| `deprecated-removed` | Deprecation was withdrawn | wire | info | 3 |
| `sunset-moved-earlier` | A sunset date (`x-sunset` or configured extension) moved earlier | wire | warn | 3 |
| `stability-decreased` | e.g. `stable` → `beta` | wire | error | 3 |
| `version-bump-too-small` | The recorded version bump is smaller than the changes need (e.g. minor bump with breaking changes) | wire | warn | 3 |
| `version-unchanged` | The spec changed but the version didn't | wire | warn | 3 |

Changes to operations marked `draft` or `alpha` are lowered to `info` by default policy (`x-stability-level`, or a configured extension).

## 10. Docs (annotations only)

All `docs` kind, default `info`, phase 2. They appear in the **diff** view and in `audit`, not in **breaking**.

`description-changed`, `summary-changed`, `title-changed` (outside schemas; schema titles are in section 8), `example-changed`, `external-docs-changed`, `tag-added`, `tag-removed`, `tag-description-changed`, `info-changed` (contact, license, terms), `extension-changed` (any `x-` extension the policy doesn't classify as `wire` or `sdk`).

## 11. Spec and engine notices

| Rule | Meaning | Default | Phase |
|---|---|---|---|
| `spec-invalid` | A document failed to load or validate (with location) | error | 1 |
| `ref-unresolved` | A `$ref` points nowhere | error | 1 |
| `cycle-not-productive` | A cycle with no property or `items` step, e.g. `A: allOf [$ref A]` | error | 2 |
| `not-compared` | Parts of the spec that weren't compared: webhooks, callbacks, `ignore`d exclusions | info | 1 |

## Counts

| Section | Rule IDs |
|---|---|
| 1. Core fallbacks | 4 |
| 2–6. Operations, security, parameters, request bodies, responses | 40 |
| 7. Schemas (each one is a request/response pair) | 52 |
| 8–11. References, lifecycle, docs, notices | 28 |
| **Total** | **about 125** (about 180 counting both directions of each pair) |

Phase 1 builds sections 2–6 and the notices. Phase 2 builds the schema, reference and docs rules.

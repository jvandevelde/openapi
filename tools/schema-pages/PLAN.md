# schema-pages: plan

Status: **Plan** (nothing built yet). Working name `schema-pages`; see section 9 for the choices still open.

`schema-pages` reads an OpenAPI document (3.0–3.2) and writes one Mintlify MDX page per schema, plus a navigation fragment for `docs.json`. It replaces Mintlify's built-in schema display (`openapi-schema` pages and the request/response panels on endpoint pages) for the two cases where that display stops working:

- **Deep nesting.** The built-in display nests an `<Expandable>` per object level. Four or five levels down, the reader has clicked open a column that is a few words wide, has lost which parent they are in, and can't link anyone to the field.
- **Unions.** `oneOf`/`anyOf` are shown as tabs, one per branch. Tabs hide all but one variant, give no way to see what the variants share or how they differ, show generated names ("Option 1") for inline branches, and nest badly (a union inside a union inside an object).

The idea in one line: **every section on a page is flat (one level of fields), and depth becomes links.** A `$ref` is a link to that schema's page; an inline nested object is a section further down the same page with its own anchor; a union is a section that lists its variants side by side.

---

## 1. What Mintlify gives us

From Mintlify's docs (November 2026):

| Feature | What it does | Use here |
|---|---|---|
| `openapi-schema: "<file> <Schema>"` frontmatter | Renders a schema page with the built-in display | What we replace |
| `<ResponseField name type required deprecated default pre post>` | One field: name, type string, labels, a Markdown body | The field list, without `<Expandable>` |
| `<Expandable title defaultOpen>` | Collapsible children | Not used for nesting; at most for long enum lists |
| `<Tabs>`, `<Accordion>`, `<Card>`, `<Tooltip>`, `<Badge>`, `<Note>`, `<Warning>` | Layout components | `<Warning>` for deprecated schemas; no tabs for unions |
| Custom React components in `/snippets/*.jsx` | Named exports, hooks injected; no cross-snippet imports, no JSON imports, no dynamic imports | Optional (section 9, decision 2). Most render client-side only |
| `.md` URLs and `llms-full.txt` | A Markdown copy of each page for agents | Static content (Markdown and built-in fields) is kept; interactive components keep only their children or are dropped |
| `docs.json` `navigation` groups | `{ "group": "…", "pages": [ … ] }` | We write the group for the schema pages |

Two things follow from this:

1. **Static output is better than a smart component.** Pages built from Markdown, headings, tables and `<ResponseField>` render on the server, are searchable, show up in the `.md` / `llms-full.txt` copies, and work without our JavaScript. A custom component would render client-side only and vanish from the agent copy.
2. **`<ResponseField>`'s `type` is a plain string**, so it can't be a link. A field whose type is another schema puts the link in the first line of its body (`→ [Address](/schemas/address)`), or we render fields as a table instead (decision 2).

## 2. Existing tools

From memory, not yet checked against each project's current docs (to do before M0, as for api-diff's survey):

| Tool | What it does | Why not |
|---|---|---|
| Mintlify built-in (`openapi-schema`, endpoint pages) | Nested expandables, union tabs | The problem we're solving |
| `@mintlify/scraping` / `mint openapi` page generation | Writes endpoint MDX stubs that point back at the spec (`openapi: GET /x`) | Still renders with the built-in display |
| Redocly, Scalar, Stoplight Elements | Full API reference renderers with their own schema views | Separate sites, not Mintlify pages |
| `widdershins`, `openapi-to-md` | Spec to Markdown | Inline the whole schema tree (the depth problem again), no union model, no Mintlify components |

None of them break a schema into flat linked sections, so we build our own. The schema-graph work in `api-diff` (reference graph, reverse edges, `allOf` merge, union type sets) solved most of the hard parts already; per the repo conventions we **copy** what we need rather than import it.

## 3. Output: what a page looks like

### 3.1 An object schema

Spec:

```yaml
Order:
  type: object
  required: [id, status, items, shipping]
  properties:
    id:       { type: string, format: uuid, readOnly: true }
    status:   { type: string, enum: [pending, paid, shipped] }
    items:    { type: array, minItems: 1, items: { $ref: '#/components/schemas/LineItem' } }
    shipping:
      type: object
      required: [address]
      properties:
        address: { $ref: '#/components/schemas/Address' }
        window:
          type: object
          properties:
            from: { type: string, format: date-time }
            to:   { type: string, format: date-time }
    payment: { $ref: '#/components/schemas/PaymentMethod' }
    metadata: { type: object, additionalProperties: { type: string } }
```

Generated `schemas/order.mdx` (ResponseField style):

```mdx
---
title: "Order"
description: "An order placed by a customer."
---

{/* Generated by schema-pages from openapi.yaml#/components/schemas/Order. Do not edit. */}

An order placed by a customer.

**Type:** object

## Fields

<ResponseField name="id" type="string<uuid>" required post={["read-only"]}>
  Not sent in requests.
</ResponseField>

<ResponseField name="status" type="enum<string>" required>
  One of: `pending`, `paid`, `shipped`.
</ResponseField>

<ResponseField name="items" type="LineItem[]" required>
  → [LineItem](/schemas/line-item) · At least 1 item.
</ResponseField>

<ResponseField name="shipping" type="object" required>
  → [shipping](#shipping) below.
</ResponseField>

<ResponseField name="payment" type="PaymentMethod (one of 3)">
  → [PaymentMethod](/schemas/payment-method): `card`, `bank_account` or `wallet`.
</ResponseField>

<ResponseField name="metadata" type="map<string, string>">
</ResponseField>

## shipping

<small>Order › shipping</small>

<ResponseField name="address" type="Address" required>
  → [Address](/schemas/address)
</ResponseField>

<ResponseField name="window" type="object">
  → [shipping.window](#shipping-window) below.
</ResponseField>

## shipping.window

<small>Order › shipping › window</small>

<ResponseField name="from" type="string<date-time>" />
<ResponseField name="to" type="string<date-time>" />

## Used by

- [`POST /orders`](/api-reference/orders/create-order) — request body
- [`GET /orders/{id}`](/api-reference/orders/get-order) — response `200`
- [Invoice](/schemas/invoice) › `order`
```

What this does about depth:

- Every section has **one level** of fields. A nested inline object gets its own `##` section, named by its path (`shipping.window`), with a breadcrumb, so its anchor (`#shipping-window`) can be linked.
- Sections are written **in depth-first order** of the fields, so a reader scrolling down meets them in the order they'd expect.
- A `$ref` is never expanded: it's a link. Recursion is no problem (a `TreeNode.children` field links to its own page).
- An inline object that is big (more than *N* fields, configurable) or used in several places can be **promoted** to its own page (decision 4).

### 3.2 A union

```yaml
PaymentMethod:
  oneOf:
    - $ref: '#/components/schemas/Card'
    - $ref: '#/components/schemas/BankAccount'
    - title: Wallet
      type: object
      required: [type, provider]
      properties:
        type: { const: wallet }
        provider: { type: string, enum: [apple_pay, google_pay] }
  discriminator:
    propertyName: type
    mapping: { card: '#/components/schemas/Card', bank_account: '#/components/schemas/BankAccount' }
```

Generated `schemas/payment-method.mdx`:

```mdx
**Type:** one of 3 variants, chosen by `type`.

## Variants

| `type` | Variant | Description |
|---|---|---|
| `card` | [Card](/schemas/card) | A credit or debit card. |
| `bank_account` | [BankAccount](/schemas/bank-account) | A bank account for direct debit. |
| `wallet` | [Wallet](#wallet) | Apple Pay or Google Pay. |

## Fields by variant

| Field | Card | BankAccount | Wallet |
|---|---|---|---|
| `type` | `"card"` ✱ | `"bank_account"` ✱ | `"wallet"` ✱ |
| `id` | string ✱ | string ✱ | — |
| `last4` | string ✱ | string ✱ | — |
| `brand` | enum ✱ | — | — |
| `iban` | — | string | — |
| `provider` | — | — | enum ✱ |

✱ required · — not in this variant

## Wallet

<small>PaymentMethod › Wallet</small>

<ResponseField name="type" type='"wallet"' required />
<ResponseField name="provider" type="enum<string>" required>
  One of: `apple_pay`, `google_pay`.
</ResponseField>
```

What this does about unions:

- **All variants are visible at once**, in a table keyed by the discriminator value when there is one.
- The **fields-by-variant matrix** shows what the variants share and where they differ, which tabs can't. Fields in every variant come first, then by how many variants have them, then alphabetically. Wide unions (more than *K* variants, configurable) drop the matrix and list shared fields once, then each variant's own fields.
- Inline variants get a name from, in order: `title`, the discriminator value (`const`/single `enum` on the discriminator property), the variant's only type (`string`, `integer`), then `Variant 3`. Each gets its own section.
- `anyOf` gets the same layout with a note that several variants can match. A union of scalars (`oneOf: [string, integer]`) renders as a type (`string | integer`) on the field, with no section.
- A union inside an object field shows `A | B | C` as the field type, linking to the schema page or to an inline section listing the variants.
- `allOf` is merged into one field list (copying api-diff's effective-schema merge). Each field inherited from a `$ref`'d member shows where it came from (`post={["from Resource"]}`), and the page says *Extends [Resource](/schemas/resource)*.

### 3.3 Everything else on a field

| Spec | Shown as |
|---|---|
| `type`, `format` | `type="string<uuid>"`, like Mintlify's own display |
| `nullable: true` (3.0), `type: [string, "null"]` (3.1) | `string \| null` |
| `enum` | `enum<string>`, values in the body; more than 10 values in a table (with descriptions from `x-enum-descriptions` / `x-enumDescriptions` when present) |
| `const` | `"wallet"` as the type |
| `default`, `example` | `default=` prop; example in the body |
| `minimum`/`maximum`/`exclusive*`/`multipleOf`, `minLength`/`maxLength`/`pattern`, `minItems`/`maxItems`/`uniqueItems`, `minProperties`/`maxProperties` | One line of plain words: "1–100 characters", "At least 1 item", "Matches `^[A-Z]{2}$`" |
| `readOnly` / `writeOnly` | `post={["read-only"]}` and a line: "Not sent in requests" / "Never returned" |
| `deprecated` | `deprecated` prop; a deprecated schema gets a `<Warning>` at the top |
| `additionalProperties`, `patternProperties` | `map<string, X>`; `additionalProperties: false` noted as "No other fields allowed" |
| `items`, `prefixItems` | `X[]`; tuples listed by position |
| `not`, `if`/`then`/`else`, `dependentRequired`, `dependentSchemas` | A short note and the raw JSON Schema in a collapsed code block (rare; not worth a layout) |
| `x-*` extensions | Ignored, except those configured (`x-internal` to exclude, `x-enum-descriptions`) |

### 3.4 Descriptions are Markdown, pages are MDX

OpenAPI descriptions are CommonMark. MDX parses `{`, `}`, `<` and some HTML as code, so a description like `Use {id} here` or `a < b` breaks the Mintlify build. We parse each description as Markdown and escape what MDX would misread, keeping links, emphasis, code and lists intact. Every golden case is also compiled with `@mdx-js/mdx` in the tests, so an unescaped character fails a test, not the user's docs build.

## 4. Navigation, links and files

- **One file per component schema**, `<out>/<slug>.mdx`, slug = kebab-case of the name (`PaymentMethod` → `payment-method`). Collisions after kebab-casing get a stable numeric suffix and a warning.
- **`nav.json`**: the `docs.json` group with every page, grouped by (configurable) `x-tags` on the schema, a name prefix, or the first tag of the operations that use it; otherwise one alphabetical group. With `--docs-json docs.json --group Schemas`, the tool replaces that group's `pages` in place and leaves the rest of the file untouched.
- **Endpoint links**: "Used by" needs the URL of each operation's Mintlify page. Mintlify derives it from the tag and summary; we compute the same slug by default, and a template (`/api-reference/{tag}/{operationId}`) covers sites that set it differently.
- **Stale files**: a manifest (`<out>/.schema-pages.json`) lists the files the last run wrote. Files no longer generated are deleted; files without our header comment are never touched or overwritten.
- **`--check`**: writes nothing and exits 1 if any file would change, so CI can fail a PR that changed the spec without regenerating the pages.
- **Deterministic**: same input, byte-identical output (sorted keys where the spec has no order, stable slugs, no timestamps).

## 5. Architecture

```
spec.yaml ─► load (+ $ref resolution) ─► normalise (3.0/3.1/3.2 → one dialect)
          ─► schema index (nodes, $ref edges, reverse edges, usages by operation)
          ─► page model (pages → sections → fields; names, slugs, anchors, links)
          ─► render (MDX per page, nav.json)  ─► write (manifest, --check, stale cleanup)
```

- **load / normalise / index**: copied and trimmed from api-diff (`src/load`, `src/normalize`, `src/index`), keeping the iterative graph walk so very deep or recursive specs can't overflow the stack.
- **page model**: the interesting part, and pure data. It decides which schemas get pages, which inline objects become sections or promoted pages, names inline variants, merges `allOf`, and builds the variant matrix. It knows nothing about MDX, so a second renderer (plain Markdown, or a custom-component style) is a new `render/*.ts`, not a rewrite.
- **render**: string templates per section kind, plus the MDX escaper.

Layout:

```
tools/schema-pages/
  package.json  tsconfig.json  Makefile  README.md  PLAN.md
  bin/schema-pages.ts       CLI
  src/load/ normalize/ index/    (copied from api-diff)
  src/model/                pages, sections, fields, naming, unions, allOf merge, usages
  src/render/               mdx.ts, escape.ts, nav.ts
  src/write/                manifest, check mode, docs.json patch
  test/cases/<name>/{spec.yaml, config.yaml?, expected/…}
```

**Language: TypeScript on Node ≥ 22.18** with type stripping, the same as api-diff, so the copied code works as is. Dependencies: `js-yaml`, `jsonc-parser` (loading, as in api-diff), a Markdown parser for the escaper (`mdast-util-from-markdown`), and `@mdx-js/mdx` as a dev dependency for tests only.

## 6. Configuration

A `schema-pages.yaml` (all optional), validated strictly like api-diff's policy file:

```yaml
spec: openapi.yaml
out: schemas                      # directory in the Mintlify repo
url-prefix: /schemas              # page URLs
style: fields                     # fields (ResponseField) | table   (decision 2)
include: ['*']                    # schema name globs
exclude: ['Internal*']
exclude-extension: x-internal     # skip schemas and fields marked with it
promote-inline:                   # decision 4
  min-fields: 8
  when-used-in: 2
union-matrix-max-variants: 6
nav:
  group: Schemas
  group-by: x-tags                # x-tags | prefix | operation-tag | none
endpoint-url: /api-reference/{tag}/{operationId}
```

## 7. Testing

- **Golden cases** (`test/cases/`): a small spec, an optional config and the expected output directory. The runner compares every file and can regenerate them with `--update` for review. Cases at least for: flat object, three-level inline nesting, `$ref` chains, self- and mutually-recursive schemas, `allOf` inheritance (including `allOf` + union), discriminated `oneOf` with `$ref` and inline variants, `anyOf`, scalar unions, nested unions, nullable in 3.0 and 3.1, every keyword in section 3.3, `readOnly`/`writeOnly`, deprecated, MDX-hostile descriptions, slug collisions, stale-file cleanup and `--check`.
- **MDX compiles**: every generated file is compiled with `@mdx-js/mdx` in the test run.
- **Mintlify preview** (manual, per milestone): a throwaway Mintlify site in `examples/` rendered with `mint dev`, with screenshots in the PR, since only the real site shows whether the layout reads well.
- **Large spec**: the 8 MB benchmark spec from api-diff's `test/bench` must generate in a few seconds.

## 8. Milestones

| # | Milestone | Contents | Done when |
|---|---|---|---|
| **M0** | Scaffold | Package, Makefile (`install`/`test`/`run`), CI workflow, golden-case runner, root README row | `make test TOOL=schema-pages` runs in CI |
| **M1** | Load and index | Copy load/normalise/index from api-diff; usages per operation and per schema | Index tests pass on the api-diff fixtures |
| **M2** | Object pages | Page model and MDX for objects: fields, types, constraints, enums, nullability, read/write-only, deprecated; nested inline objects as sections; `$ref` as links; MDX escaping | **First usable version:** a real spec's object schemas render in Mintlify and compile |
| **M3** | Unions and `allOf` | Variant table, fields-by-variant matrix, inline variant naming, discriminators (explicit and implied mappings), `anyOf`, scalar unions, nested unions; `allOf` merge with "from X" labels | The union cases render and read well in the preview site |
| **M4** | Site integration | "Used by", endpoint URL template, `nav.json`, `--docs-json` patch, manifest and stale cleanup, `--check`, config file | A Mintlify repo regenerates its schema pages in CI |
| **M5** | Polish | Promotion of large inline objects to pages, wide-union fallback, examples, the second render style (decision 2) | — |
| **M6** | Distribution | Bundled `schema-pages.mjs` on GitHub releases, as for api-diff | Another repo's CI runs a pinned release |

## 9. Decisions to make

1. **Name**: `schema-pages` (working name), `mintlify-schemas`, or something else.
2. **Field style**: built-in `<ResponseField>` (looks native, type can't be a link), a Markdown table per section (compact, links in the type column, cramped on phones), or a custom snippet component (full control, but client-rendered and missing from the `.md` / `llms-full.txt` copies).
3. **Endpoint pages**: schema pages only (endpoint pages keep the built-in display and link to schema pages through descriptions), or also generate endpoint pages whose request and response bodies use the same flat layout (a later milestone).
4. **Inline nested objects**: sections on the parent's page (default), or promoted to their own page above a size or reuse threshold.
5. **Which schemas get pages**: every component schema, only those reachable from operations, or an explicit list.

## 10. Backlog ideas

- **Generated examples**: a minimal JSON example per schema and per variant, shown in Mintlify's `<ResponseExample>` side panel.
- **Request vs response views**: one page, with a toggle-free split ("In requests" / "In responses") that hides `readOnly` fields from the request view and `writeOnly` from the response view.
- **Field permalinks and search**: an anchor per field (`#shipping-window-from`) and a generated "all fields" index page for find-a-field searches.
- **Changes per release**: read api-diff's result JSON and badge fields "new in 2.3" or "deprecated in 2.4".
- **Other renderers**: plain Markdown for GitHub wikis, or Docusaurus MDX, from the same page model.

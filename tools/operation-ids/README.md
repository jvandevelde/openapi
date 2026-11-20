# openapi-operation-ids

Fills in **missing** `operationId`s in an OpenAPI **3.0, 3.1 or 3.2** document (JSON or YAML).

- **Short**: names are built from the route, like `listUsers` or `getUser`, and only get longer when two operations would otherwise share a name.
- **Deterministic**: the same input always gives the same ids, whatever order the keys are in.
- **Idempotent**: running it on its own output changes nothing.
- **Non-destructive**: existing `operationId`s are never changed. YAML comments and key order are kept.

## Running with npx

Requires Node.js 20+. Pick whichever matches where you are:

```sh
# 1. Inside a clone of this repo, after `npm install` at the repo root
#    (npm workspaces links the command by name):
npx openapi-operation-ids openapi.yaml --dry-run

# 2. From the repo root without installing first (npx installs the tool's deps itself):
npx ./tools/operation-ids openapi.yaml --dry-run

# 3. From any other directory or project, pointing at a clone of this repo:
npx /path/to/openapi/tools/operation-ids ./openapi.yaml --write
```

Any of the options below work with every form, for example
`npx openapi-operation-ids openapi.yaml --case snake -o out.yaml`.

> `npx github:<owner>/<repo>` can't run a tool from a subdirectory, so it won't work here.
> To run the tool without a clone (`npx openapi-operation-ids` from anywhere), it has to be
> published to an npm registry first, for example with `npm publish` from this directory.

## Usage

```sh
# from the repo root (npx openapi-operation-ids … works the same way)
node tools/operation-ids/bin/cli.js openapi.yaml            # print the result to stdout
node tools/operation-ids/bin/cli.js openapi.yaml --write    # update the file in place
node tools/operation-ids/bin/cli.js openapi.json -o out.json
node tools/operation-ids/bin/cli.js openapi.yaml --dry-run  # list what would be added
node tools/operation-ids/bin/cli.js openapi.yaml --check    # exit 1 if any are missing (CI)
cat openapi.yaml | node tools/operation-ids/bin/cli.js -    # read stdin
```

| Option | Description |
|---|---|
| `-o, --output <file>` | Write the result to a file |
| `-w, --write` | Overwrite the input file |
| `--case <style>` | `camel` (default), `pascal`, `snake` or `kebab` |
| `--format <fmt>` | Force `json` or `yaml` (default: detected from the file extension, then the content) |
| `--dry-run` | Print `METHOD path -> id` for each id that would be added, and change nothing |
| `--check` | Exit with code 1 if any operation has no `operationId` |
| `-q, --quiet` | Don't print warnings or the summary |

### As a library

```js
import { fillOperationIds, fillOperationIdsInText, planOperationIds } from 'openapi-operation-ids';

const { spec, added, warnings } = fillOperationIds(parsedSpec, { case: 'camel' }); // input is not changed
const { text } = fillOperationIdsInText(yamlOrJsonString);                     // keeps formatting
const { added } = planOperationIds(parsedSpec);                                 // plan only
```

## Naming rules

### Base name (shortest)

The name is `verb + resource`. The **resource** is the last fixed (non-parameter) path segment, split into words on `-`, `_`, `.` and camelCase.

| Method | Path ends in `{param}` | Path ends in a fixed segment |
|---|---|---|
| GET | `get` + singular | `list` + resource if the word is plural, otherwise `get` + resource |
| POST | `create` + singular | `create` + singular |
| PUT | `replace` + singular | `replace` + resource |
| PATCH | `update` + singular | `update` + resource |
| DELETE | `delete` + singular | `delete` + resource |
| HEAD, OPTIONS, TRACE, QUERY, custom methods | method name, e.g. `head`, `query`, `link` | same |

| Route | Id |
|---|---|
| `GET /users` | `listUsers` |
| `POST /users` | `createUser` |
| `GET /users/{userId}` | `getUser` |
| `PUT /users/{userId}` | `replaceUser` |
| `PATCH /users/{userId}` | `updateUser` |
| `DELETE /users/{userId}` | `deleteUser` |
| `GET /users/me` | `getMe` |
| `GET /health` | `getHealth` |
| `POST /users/{userId}/activate` | `createActivate` |
| `GET /` | `getRoot` |
| `GET /{id}` | `getById` |

Paths are named mechanically. The tool does not guess that a segment such as `activate` is a verb. If you want a different name, set the `operationId` yourself and the tool will leave it alone.

### Widening (only when names collide)

When two or more operations get the same name, or a name matches an existing `operationId`, **every** operation in that clash moves up one level. This repeats until all names are unique.

1. **Parent segments**: add the fixed segments above the resource, one at a time, nearest first. A parent followed by a `{param}` is made singular.
   `GET /orgs/{o}/members/{u}` → `getOrgMember`, `GET /teams/{t}/members/{u}` → `getTeamMember`
2. **Path parameters**: add `By<Param>And<Param>…`.
   `GET /reports/{year}` → `getReportByYear`, `GET /reports/{year}/{month}` → `getReportByYearAndMonth`
3. **Required query parameters**: add `With<Param>And<Param>…`, sorted by name.
4. **Hash fallback**: add `_` and 4 hex characters of a SHA-1 of the operation's location, such as `listUsers_3f2a`. This is only needed for routes that are otherwise identical, such as `/users` and `/users/`.

If one operation in a clash has nothing left to add at a level, its name stays the same. For example, `GET /users` and `GET /orgs/{orgId}/users` both start as `listUsers`. After widening they become `listUsers` and `listOrgUsers`.

### Why the ids are stable

- Operations are sorted into a fixed order before naming, and every member of a clash is treated the same way. The result depends only on which operations exist, not on the order they appear in the file.
- Names are compared **case-insensitively**, so `getUser` and `GetUser` count as a clash. Many code generators would otherwise create clashing method names.
- Existing ids are never touched. If you add an endpoint to a spec that has already been processed, the new endpoint is the one that widens, so ids from earlier runs never change.

### Webhooks and callbacks

- **Webhooks** (3.1+) are named `verb + webhook name + Webhook`, so the `newPet` webhook with POST becomes `createNewPetWebhook`.
- **Callback operations** are named after their parent operation's id plus the callback name, such as `createSubscriptionOnEvent`. If that collides, the HTTP method and then the callback expression are added. Nested callbacks are supported.

### What is skipped (with a warning)

- **Path items, callbacks or operations that are shared**, either through `$ref` or YAML aliases. Writing an id into a shared object would give the same id to every place that uses it. Inline them first if you want ids generated.
- **Reusable `components.pathItems` and `components.callbacks`**. Their existing ids are still counted, so generated ids won't clash with them.
- **Swagger 2.0 and OpenAPI 4.x** are rejected.

## Development

```sh
npm test   # node:test, run from this directory or from the repo root
```

Source layout:

| File | Purpose |
|---|---|
| `bin/cli.js` | Argument parsing and file I/O |
| `src/index.js` | Public API, plus inserting ids into JSON and YAML while keeping formatting |
| `src/collect.js` | Finds operations in paths, webhooks, callbacks and 3.2 `additionalOperations` |
| `src/naming.js` | Builds each operation's list of names from shortest to widest |
| `src/resolve.js` | Collision resolution by widening every member of a clash |
| `src/tokenize.js` | Word splitting, path parsing and casing |

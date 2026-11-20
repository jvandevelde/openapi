# OpenAPI tools

A collection of small, independent helper scripts for working with OpenAPI documents.

Each tool lives in its own directory under [`tools/`](tools/) with its own `README.md`,
`package.json`, dependencies and tests. Tools never import from each other, so any one of
them can be copied out, published or run on its own.

| Tool | What it does |
|---|---|
| [`operation-ids`](tools/operation-ids/) | Fills in missing `operationId`s with short, deterministic, unique names (OpenAPI 3.0–3.2). |

## Getting started

Requires Node.js 20 or later.

```sh
npm install        # installs dependencies for every tool (npm workspaces)
npm test           # runs every tool's tests
```

Run a tool directly:

```sh
node tools/operation-ids/bin/cli.js path/to/openapi.yaml --dry-run
```

## Adding a new tool

1. Create `tools/<tool-name>/` containing:
   - `package.json` with its own `name`, `bin` (if it has a CLI), `dependencies` and a `test` script.
   - `README.md` covering usage, options and behaviour.
   - `bin/` for the CLI entry point, `src/` for the library code, `test/` for `node:test` tests.
2. Run `npm install` at the repo root so the workspace is linked.
3. Add a row to the table above.

Conventions: ES modules, Node ≥ 20, `node:test` for tests, as few dependencies as possible,
and a library API that is separate from the CLI so the tool can also be used programmatically.

# OpenAPI tools

A collection of small, independent helper scripts for working with OpenAPI documents.

Each tool lives in its own directory under [`tools/`](tools/) and is fully self-contained. It has its own language, dependencies, lockfile, tests and `README.md`. Tools never depend on each other, and the repo root is not tied to any language. A shared `make` interface ties them together.

| Tool | Language | What it does | Run |
|---|---|---|---|
| [`operation-ids`](tools/operation-ids/) | Node.js ≥ 20 | Fills in missing `operationId`s with short, deterministic, unique names (OpenAPI 3.0–3.2). | `npx ./tools/operation-ids spec.yaml` |

## Using the tools

See each tool's README for its requirements and all the ways to run it. From the repo root:

```sh
make list                                   # list tools
make install                                # install dependencies for every tool
make test                                   # run every tool's tests
make test TOOL=operation-ids                # just one tool
make run  TOOL=operation-ids ARGS="test/fixtures/simple-3.0.json --dry-run"
```

`make run` runs inside the tool's directory, so relative paths in `ARGS` are resolved from there. To pass paths relative to where you are, use the tool's native runner. For example: `npx ./tools/operation-ids path/to/spec.yaml`.

## Adding a new tool

1. Create `tools/<tool-name>/` (names starting with `_` are ignored). Use whatever language suits the tool, with its native manifest and lockfile, for example `package.json`, `pyproject.toml`, `go.mod` or `Cargo.toml`.
2. Add a `Makefile` with these three targets:

   | Target | Must |
   |---|---|
   | `install` | Install dependencies (from the lockfile) |
   | `test` | Run the tests and exit non-zero if any fail. Install dependencies first if needed. |
   | `run` | Run the tool, passing `$(ARGS)` through |

   Example for a Python tool:

   ```make
   .PHONY: install test run
   install: ; uv sync
   test: install ; uv run pytest
   run: install ; @uv run python -m my_tool $(ARGS)
   ```
3. Add a `README.md` with these sections: **what it does**, **requirements** (runtime and version), **usage** (CLI and library, if any), **behaviour/rules**, and **development** (how to test).
4. Add a CI workflow at `.github/workflows/<tool-name>.yml`. Copy [`operation-ids.yml`](.github/workflows/operation-ids.yml), change the `paths` filters and the toolchain setup step, and keep `make test` as the test command.
5. Add a row to the table above.

## Conventions

- Keep tools independent. Never import code from another tool. If something really needs to be shared, copy it, or publish it as a package.
- Keep dependencies to a minimum. Keep the library code separate from the CLI, so a tool can also be used as a library.
- Put test fixtures inside the tool's own `test/` directory.

# OpenAPI tools

A collection of small, independent helper scripts for working with OpenAPI documents.

Each tool lives in its own directory under [`tools/`](tools/) and is fully self-contained. It has its own language, dependencies, lockfile, tests and `README.md`. Tools never depend on each other, and the repo root is not tied to any language. A shared `make` interface ties them together.

| Tool | Language | What it does | Run |
|---|---|---|---|
| [`operation-ids`](tools/operation-ids/) | Node.js ≥ 20 | Fills in missing `operationId`s with short, deterministic, unique names (OpenAPI 3.0–3.2). | `npx ./tools/operation-ids spec.yaml` |
| [`api-diff`](tools/api-diff/) | Node.js ≥ 22.18 | Compares two OpenAPI documents (files or git revisions) and reports breaking changes (OpenAPI 3.0–3.2). Work in progress. | `npx ./tools/api-diff main:spec.yaml spec.yaml` |

## Using the tools with `make`

The repo uses [`make`](https://www.gnu.org/software/make/) as one entry point that works for every tool, whatever language the tool is written in. You run `make` from the repo root. It passes the command on to the `Makefile` in each tool's folder, and that `Makefile` calls the tool's own toolchain (for example `npm`, `uv` or `go`).

### 1. Install `make` and the tool's runtime

You need `make` itself, plus the runtime for any tool you want to use. The table at the top of this README and each tool's README list the runtime.

| OS | How to get `make` |
|---|---|
| macOS | `xcode-select --install` (Command Line Tools) |
| Debian / Ubuntu | `sudo apt install make` |
| Fedora / RHEL | `sudo dnf install make` |
| Windows | Use WSL, or install it with `winget install GnuWin32.Make` or `choco install make`, and run it from Git Bash |

Run `make --version` to check that it's installed.

### 2. Commands

Run these from the repo root:

| Command | What it does |
|---|---|
| `make list` | Lists every tool that `make` can see |
| `make install` | Installs each tool's dependencies from its lockfile |
| `make test` | Runs every tool's tests, stopping at the first failure |
| `make test TOOL=<name>` | Runs the tests for one tool only (`install` also accepts `TOOL=`) |
| `make run TOOL=<name> ARGS="..."` | Runs one tool and passes `ARGS` to it |

Examples:

```sh
make list
make install
make test
make test TOOL=operation-ids
make run TOOL=operation-ids ARGS="test/fixtures/simple-3.0.json --dry-run"
```

`make test` and `make run` install dependencies first if they aren't installed yet, so you can skip `make install`.

### 3. Things to know

- **`ARGS` paths are relative to the tool's folder**, not to where you ran `make`, because `make run` runs inside `tools/<name>/`. Use absolute paths, for example `ARGS="$PWD/spec.yaml --write"`. Alternatively, call the tool's own runner directly, such as `npx ./tools/operation-ids spec.yaml`.
- **Quote `ARGS`** whenever it contains more than one word: `ARGS="spec.yaml -o out.yaml"`.
- **You can work inside a tool's folder**: `cd tools/operation-ids && make test`. Inside the folder, `make run ARGS="..."` works without `TOOL=`.
- **You don't have to use `make`.** Each tool's README shows how to run it with its own toolchain, for example `npx` or `npm test`.

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

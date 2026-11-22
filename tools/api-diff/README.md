# api-diff

Compares two OpenAPI documents (a *base* and a *revision*), finds what changed, and decides which changes break clients. Works with OpenAPI **3.0, 3.1 and 3.2**, in JSON or YAML, from files or from **git revisions**.

> **Status: milestone M7.** Operation-level changes (paths, operations, security, parameters, request bodies, responses), schema changes (properties, types, enums, limits, unions, discriminators, `allOf`), reference, lifecycle, version and docs changes are classified with direction-aware rules (all 132 rules implemented, including rename detection). Teams configure it with a policy file (rules, overrides, lifecycle, extensions, exclusions, versions), acknowledgements and in-spec `x-api-diff` hints. Reports: `review` (the default), `ci` and `summary`, in text, JSON or HTML, with a ready-to-copy PR workflow. `changelog`, `sdk` and `explore` arrive in M8.

## Requirements

Node.js 22.18 or later. Node runs the TypeScript sources directly; there is no build step.

## Running it

```sh
# From the repo root, using make (installs dependencies on first use)
make run TOOL=api-diff ARGS="test/cases/operation-removed/base.yaml test/cases/operation-removed/revision.yaml"

# From any directory, pointing npx at a clone of this repo
cd ~/src/orders-api
npx ~/src/openapi/tools/api-diff main:openapi.yaml openapi.yaml

# Inside this directory, after `npm install`
node bin/api-diff.ts base.yaml revision.yaml
```

## Usage

```sh
api-diff base.yaml revision.yaml              # two files
api-diff main:openapi.yaml openapi.yaml       # the file on main vs the working tree
api-diff --base main openapi.yaml             # the same, shorter
api-diff --base main... openapi.yaml          # vs where this branch left main (what a PR changed)
api-diff --base v1.4.0 --revision v1.5.0 openapi.yaml   # two tags
api-diff HEAD:openapi.yaml :openapi.yaml      # last commit vs the staged version
```

Git inputs read the root file **and every file it references with `$ref`** at that revision, from the repository that contains the spec, so it works in any repository. An argument is read as `rev:path` only if no file has that exact name and the part before `:` is a git revision.

| Option | Description |
|---|---|
| `--base <rev>`, `--revision <rev>` | Read the given file at these revisions. `<rev>...` means the merge-base with the other side (`HEAD` by default) |
| `-C, --cwd <dir>` | Run as if started in `<dir>` |
| `--report <name>[:<format>[:<file>]]` | A report to write; repeatable, from one comparison. `review` (the default): what changed and who it affects, grouped by component or operation. `ci`: short, for CI logs. `summary`: size, risk and version advice. `changelog`: what changed for API consumers and what they need to do, grouped by tag and operation, in Markdown-style text you can paste into release notes. `sdk`: renamed methods, arguments and types, changes by method and type, and the SDK version bump (under `--profile sdk` severities). `explore`: every finding in one interactive HTML file, with filters, search and the base and revision source side by side. Formats `txt`, `json` and `html` (`review`, `summary`, `changelog`; `explore` is HTML only; one self-contained file); without a file it goes to stdout (one report at most). The policy's `reports` section can leave exclusion sets out of a report |
| `-f, --format <fmt>` | Format of the default `review` report: `txt` (default), `html` or `json` (the full result; [schema](schema/result-v0.schema.json), also printed by `api-diff schema`) |
| `-o, --output <file>` | Write the default report to a file |
| `--fail-on <level>` | Exit with code 1 if any finding is at or above `error`, `warn` or `info`. The default is `never`: breaking changes are reported, not blocked, unless a team opts in |
| `--state` | Print only `no-changes`, `compatible` or `breaking` |
| `--profile <name>` | `wire` (default) or `sdk`: raises rules that break generated SDKs, such as `operation-id-changed` |
| `--policy <file>`, `--no-policy` | The policy file: `api-diff.yaml` in the working directory by default, if present. See [POLICY.md](POLICY.md) |
| `--base-version <v>`, `--revision-version <v>` | The versions to record and check, instead of reading them from the documents |
| `--base-label <k=v>`, `--revision-label <k=v>` | Extra version labels, e.g. `build=8812`. Repeatable |
| `--cache-dir <dir>` | Cache the parsed base documents in this directory, keyed by their content. Useful in CI when the base (e.g. `main`) rarely changes: keep the directory between runs. Saves the base's parse time (about 0.5 s on an 8 MB spec) |
| `--as-of <YYYY-MM-DD>` | Reference date for deprecation periods and sunset dates (default: today, UTC). Use it for reproducible runs |
| `--rule <rule-id>=<severity>` | Set one rule's severity (`error`, `warn`, `info`, `off`), beating the policy file. Repeatable |
| `--color`, `--no-color` | Colour is on for terminals unless `NO_COLOR` is set |

Exit codes: `0` no findings at or above `--fail-on` (always, by default), `1` findings at or above it, `2` usage or input error (missing file, unknown revision, invalid policy).

`api-diff rules` lists the implemented rules with their default severities (`--all` includes planned ones, `--format json` for scripts). `api-diff rules <id>` explains one rule. The full reference, one page per rule, is in [docs/rules/](docs/rules/README.md).

### Example

```
$ api-diff base.yaml revision.yaml
api-diff 0.1.0 · profile wire
base      base.yaml  (OpenAPI 3.1.0, version 1.0.0)
revision  revision.yaml  (OpenAPI 3.1.0, version 1.1.0)

ERROR  GET /pets               query parameter 'limit' became required  revision.yaml:8 · query-parameter-became-required
ERROR  securitySchemes/apiKey  security scheme 'apiKey' changed: name  revision.yaml:19 · security-scheme-changed
       affects 2 operations: GET /cats, GET /pets
WARN   GET /pets               success response 202 added  revision.yaml:11 · response-success-status-added

3 findings: 2 error, 1 warn, 0 info · state: breaking
```

## On pull requests

[docs/ci.md](docs/ci.md) has a ready-to-copy GitHub Actions workflow: it compares the spec with the base branch, posts the `review` report as a PR comment (updated on each push) and keeps the HTML and JSON reports as artifacts. It reports changes without failing the build unless you opt in. This repository runs the same workflow on [`examples/petstore`](examples/petstore/openapi.yaml) for every PR.

## Policy and in-spec hints

A team sets severities, overrides for parts of the API and other settings in a policy file, `api-diff.yaml` ([POLICY.md](POLICY.md)). Spec authors can also steer `api-diff` from the spec itself with vendor extensions such as `x-api-diff: { enum: open }` or `x-stability-level: beta`: [docs/spec-authors.md](docs/spec-authors.md) lists every one.

## As a library

```ts
import { compareInputs, parseInput, MemorySource, compareOpened } from './src/index.ts';

const result = await compareInputs(parseInput('main:openapi.yaml', cwd), parseInput('openapi.yaml', cwd), cwd);

// Or with documents in memory:
const r = await compareOpened(
  { source: new MemorySource({ 'a.yaml': baseText }), root: 'a.yaml' },
  { source: new MemorySource({ 'b.yaml': revisionText }), root: 'b.yaml' },
);
```

## Development

```sh
make test TOOL=api-diff      # from the repo root: type check + all tests
npm test                     # tests only
npx tsc --noEmit -p .        # type check only
node test/bench/bench.ts 8   # timing on two generated 8 MB specs
UPDATE_CASES=1 npm test      # rewrite expected.yaml files from actual results (review the diff!)
```

- `src/`: one folder per pipeline stage (`sources`, `load`, `normalize`, `model`, `diff`, `classify`, `render`, `cli`), described in [PLAN.md](PLAN.md) section 6.
- `src/rules/registry.ts`: every rule's ID, kind, default severities and message. `src/rules/docs.ts`: its description, reason, fix and options. A test keeps both in sync with RULES.md.
- `docs/rules/` is generated: run `npm run docs` after changing rules or test cases (a test fails if it's stale).
- **Adding or changing a rule:** update the registry and `src/rules/docs.ts`, add or update its test case, run `npm run docs`, update RULES.md if the design changed, and add a decision record if a default was decided.
- `test/cases/`: one folder per rule or scenario; see [test/cases/README.md](test/cases/README.md).
- New decisions get a record in [decision-records/](decision-records/README.md), in the same commit as the change.

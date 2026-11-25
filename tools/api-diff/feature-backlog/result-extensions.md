# Extensions: your own data in the result JSON

| | |
|---|---|
| **Status** | Idea |
| **Summary** | Named `extensions` slots in the result and timeline JSON (on each history step, each finding, the result and the history as a whole) that the tool fills from git, the spec or a script, keeps as they are, and shows in reports and templates; with an `api-diff render` command, a saved JSON file with extensions can be rendered again into any report. |
| **Value / effort** | high / medium |
| **Plan entry** | [PLAN.md section 8, *Developer experience*](../PLAN.md#developer-experience) |

## Background

Checked against the code on 2026-11-25.

- **The JSON is closed.** A history step (`Step` in `src/history.ts`) has the commit, date, author, subject, PR number, tags and versions, and nothing else. A finding and a result have fixed fields too. The result schema (`schema/result-v0.schema.json`) lists exactly those fields.
- **Renderers show only those fields.** The timeline step header shows the commit, subject, PR and tags. There's nowhere to show a ticket, a release note or a deploy date that belongs to a step.
- **Templates are checked against fixed shapes.** `src/render/template.ts` checks every name in a Mustache template against the shape of the report's data, so a typo fails instead of printing nothing. A field the tool doesn't know about is rejected. The `history` timeline can't use a template at all.
- **A saved JSON file can't be rendered again.** There's no command that reads a result or timeline JSON file and writes a report from it. To add data to a report today, you'd have to post-process the HTML or rewrite the report outside the tool.

The timeline is the clearest case: a step is a commit, and teams keep a lot about a commit that the spec doesn't have.

## Data teams would attach

| Level | Examples |
|---|---|
| History step (a commit) | PR title, labels and reviewers; ticket IDs (`Refs: API-123`); a release note written by the author; the build or deploy that shipped it and when; an approval or sign-off |
| Finding | a ticket for the follow-up; a link to the consumer migration guide; usage numbers for the affected operations (see [Usage-weighted severity](usage-weighted-severity.md)) |
| Result or whole history | the release it describes; the environment; a link to the CI run |

## What it would do

### 1. Slots in the JSON

Each of these gets an optional `extensions` object: the result, each finding, each history step, and the history as a whole. Its keys are namespaces that the producer chooses (`jira`, `release`, `deploy`), and each value is any JSON.

```json
{
  "commit": "c7f3e1a…",
  "subject": "Add owner to Pet (#412)",
  "pr": 412,
  "tags": ["v1.5.0"],
  "extensions": {
    "jira": { "issues": ["API-123"] },
    "release": { "note": "Pets now have an owner.", "audience": "public" }
  },
  "findings": [ … ]
}
```

- The tool never interprets extension data and doesn't change it. It doesn't affect severities, the state, exit codes or the semver advice, so a report means the same with or without it.
- The result schema allows `extensions` at each of those levels, with the namespaces as `additionalProperties`. A namespace can be described with its own JSON Schema (see 3).
- Names are kept apart from the tool's own fields, so later versions can add fields without breaking anyone's extensions.

### 2. Where the data comes from

The options are listed from least to most work and risk. They can be built one at a time.

**a. Write it into the JSON yourself, then render.** A script reads `--report timeline:json`, adds `extensions` and writes it back. Then `api-diff render` (see 4) produces the HTML. This adds nothing new to run inside api-diff, and it works with any data source. It is the minimum version of this proposal.

**b. Declared sources in the policy (built in, offline).** The policy names where each namespace comes from:

```yaml
extensions:
  release:
    per: step
    from:
      note: git-trailer:Release-Note        # "Release-Note: …" in the commit message
      audience: git-trailer:Release-Audience
  jira:
    per: step
    from:
      issues: git-trailer:Refs[]           # all "Refs:" lines, as a list
  review:
    per: step
    from:
      notes: git-notes:refs/notes/api-review   # git notes on the commit
  spec:
    per: result
    from:
      lifecycle: spec:info.x-lifecycle      # a value from the revision's spec
```

Built-in sources: git trailers, git notes, a JSON Pointer into the base or revision spec, and the policy itself (fixed values). They all read local data and give the same output for the same inputs, so they fit [Offline and deterministic](offline-and-deterministic.md).

**c. A script per step or finding.** `run: ./scripts/enrich-step.mjs`: the tool sends the step's JSON on stdin and reads an object for that namespace from stdout. This reaches anything, such as an issue tracker, a deploy log or usage metrics. It also means running code and maybe making network calls on every run, so it has to be opted into on the command line (`--allow-extension-scripts`), not just in the policy. It needs a timeout and a cache keyed by the commit SHA, so a 200-step history doesn't make 200 calls on every run. It could share its loading and sandboxing with [Rule plugins](rule-plugins.md).

### 3. Showing it

- **Built-in reports:** the policy says which fields to show and how. The timeline then shows them in the step header and in the step panel, and filters and search include them:

  ```yaml
  extensions:
    jira:
      per: step
      show:
        - { label: Ticket, value: "issues", link: "https://jira.example.com/browse/{value}" }
  ```

  Values are escaped like every other value in the HTML reports. Links are built only from a URL template in the policy, never from a URL in the data.
- **Templates:** each namespace can declare its shape (a small JSON Schema or the template shape syntax), so the template check still catches a typo such as `{{extensions.jira.isues}}`. A namespace with no declared shape is accepted as "anything" (`2` in `template.ts`), without the check.
- **A timeline template**, like the other reports have (POLICY.md section 10), over the timeline JSON. A team that wants its own layout, such as a release page built from `release.note`, then needs nothing beyond the policy.

### 4. `api-diff render`

`api-diff render <file.json> --report <name>[:<format>[:<file>]]` renders a saved result or timeline file without comparing anything. Combined with 2a, any tool can add data, and api-diff still draws the report.

- **Timeline:** the timeline renderers use only each step's metadata and its findings, and the net result's findings, which `timelineData` already writes. So a timeline JSON file can be rendered again as it is.
- **Diff reports:** a saved full result (`--report review:json`) has what `review`, `ci`, `summary`, `changelog`, `sdk` and `audit` need, apart from run options such as `--fail-on`, `groupBy` and the audit's exclusion lists, which `render` takes again from the command line and the policy. `explore` needs the snippets, which are in the result only when `explore` was asked for in that run. `include.extensions`, `include.owners` and `--uses` need the parsed spec, which isn't saved. `render` would refuse those cases with a clear message instead of rendering an incomplete report. Options: always write the snippets with `--report …:json`, or a `--keep-sources` flag that saves what the reach filters need.
- The file is checked against the result or timeline schema first, including each namespace's declared schema.

## Suggested order

1. The slots (1), declared shapes and display rules (3), and the timeline template.
2. `api-diff render` for timeline JSON (4). With 1, this already covers anyone who can write a script.
3. Built-in git trailer and git notes sources for steps (2b). Release notes and ticket IDs then need no script at all.
4. `render` for diff results, after deciding what a saved result must contain.
5. Scripts (2c), together with rule plugins, if they're still wanted.

## Related

- [Rule plugins](rule-plugins.md): a plugin could write finding extensions, and both need a safe way to load code.
- [Changesets](changesets.md) and [Git blame for findings](git-blame-for-findings.md): both attach commit and PR data to findings. That data could come out as `extensions` instead of new fixed fields.
- [Usage-weighted severity](usage-weighted-severity.md): its usage numbers could be shown as a finding extension before they affect severities.
- [Offline and deterministic](offline-and-deterministic.md): the built-in sources fit it; scripts don't, which is why they need a separate opt-in.
- [Signed reports](signed-reports.md): the report hash would cover the extension data, and a namespace filled by a script would be recorded as such.
- [Overlays, a review file and a review loop](overlays-and-review-loop.md): reviewer decisions are another kind of data attached to findings. Check whether they should share this mechanism.

## Open questions

- **Namespace names:** free-form (`jira`), or a prefix such as `x-jira` as in OpenAPI? Should namespaces from a script be marked apart from built-in ones?
- **Size limits:** a script could add megabytes to every step. Is there a cap per namespace, or a warning?
- **History steps and the net result:** should step extensions be merged into the net result (e.g. all ticket IDs in the range), or is that left to templates?
- **`render` and the policy:** does `render` use the current policy's display rules and templates, or the ones from the run that wrote the file (which would mean recording them in the JSON)?
- **Schema versioning:** does adding `extensions` need `schemaVersion: 1`, or is it an addition that `0` allows?

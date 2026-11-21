# Detect unrelated documents before diffing, with the overlap coefficient

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-21 18:58 UTC |
| **Summary** | A `documents-unrelated` rule (M6, default `error`) checks, before the diff, whether the two documents share any operations, `operationId`s or schema names, measured with the overlap coefficient. If they look like different APIs, the diff stops and that is the only finding. |
| **Milestone** | M6 |

## Background

When someone passes two spec paths by hand, nothing checks that they are two versions of the same API. A wrong path (the orders spec against the billing spec) produces "every operation removed, every operation added": hundreds of `error` findings, a failed CI run, and nothing pointing at the real mistake.

Proving two documents are the same API isn't possible. Catching documents that are clearly different is easy, and that is the case that matters. The constraints:

- **No false alarms on real changes.** An API that grew from 20 to 200 operations, moved `/v1` to `/v2`, or renamed a path prefix is still the same API.
- **Enterprise specs have many prefixes**, not one shared one: `/billing/v1/…`, `/users/v2/…`, `/orders/2024-01-01/…` in one document.
- **Cheap.** It must use what the loader and index already build, and add no noticeable time on an 8 MB spec.
- **Configurable**, through the existing policy machinery, with defaults that need no configuration.

## Alternatives considered

### Where the check lives

- **A hard input error (exit code 2), with a `--allow-unrelated` flag**: simple, but it duplicates what rules already provide (severity, `off`, options, a generated rule page, golden test cases) and can't be tuned in the policy file. Not chosen.
- **A warning finding alongside the full diff**: the one useful finding is buried under hundreds of meaningless removals. Not chosen.
- **A rule whose finding replaces the diff (chosen)**: it gets the policy machinery for free. Its exit code follows `--fail-on` like every other finding, and `off` is the override.

### How to measure similarity

All of these work on sets of keys built per signal (operations, `operationId`s, schema names), except where noted.

- **Jaccard index**, \|A ∩ B\| / \|A ∪ B\|: the standard set similarity, but it punishes size differences. An API that keeps its 20 operations and adds 180 scores 20/200 = 0.10, the same as two mostly unrelated APIs. Growth and big removals are exactly the real changes we must not flag. Not chosen.
- **Sørensen–Dice coefficient**, 2\|A ∩ B\| / (\|A\| + \|B\|): the same size bias as Jaccard, only milder (the 20 → 200 example scores 0.18). Not chosen.
- **Containment**, \|A ∩ B\| / \|A\|: measures how much of one side survives, which is the right idea, but it is asymmetric. Base-in-revision handles growth and revision-in-base handles shrinking, so we'd need both. Taking the larger of the two is the overlap coefficient.
- **Overlap coefficient (Szymkiewicz–Simpson)**, \|A ∩ B\| / min(\|A\|, \|B\|) (**chosen**): how much of the smaller document is in the larger one. Growth and shrinking both score 1.0 when nothing else changed, and unrelated APIs score close to 0. Its weakness is that a tiny document scores high by accident (1 shared `GET /health` out of 2 operations is 0.5), which `min-size` covers.
- **Cosine similarity or TF-IDF over path and name tokens**: tolerant of renames, but it needs a tokenizer, a weighting scheme and a threshold that is hard to explain. Unrelated APIs in one company share many tokens (`id`, `list`, `users`, `v1`), which pushes scores up exactly where we need them low. Not chosen.
- **MinHash / locality-sensitive hashing**: estimates Jaccard quickly for huge sets. Our sets have thousands of items at most, and exact set operations on them take microseconds, so an estimate adds error for no gain. It also estimates the wrong measure. Not chosen.
- **Edit distance between paths (Levenshtein) with best matching**: catches renamed paths, but it is O(n² · path length) and needs an assignment step (e.g. Hungarian) to pair paths up. That is more than a precheck needs, and rename detection belongs to M8. Not chosen.
- **Tree edit distance over the whole document**: the most precise and by far the most expensive (cubic in the worst case). Not chosen.
- **Shape-hash overlap of schemas**: reuses the M4 hashes, but any schema change changes its hash, so a normal release with many edits looks unrelated. Names are more stable than shapes. Not chosen as a signal; it could be added later as an option.
- **One weighted score over all signals**: needs weights nobody can justify, and one strong signal (e.g. every `operationId` kept while all paths moved) gets diluted by the others. Not chosen; each signal is scored on its own instead.

### How to combine the signals

- **All signals must pass**: a prefix rename fails the operations signal, so real changes get flagged. Not chosen.
- **Any one signal passes (chosen)**: one strong sign of relatedness is enough. A signal that is empty on either side (e.g. no `operationId`s) is skipped rather than counted as 0.
- **Identity check as a tie-break (chosen)**: even when every signal is low, the documents are treated as related if `info.title` is the same and they share a server host (when both declare hosts). A rewrite that kept its name and host is still the same API.

### How to normalise paths

- **Strip the longest common prefix of all paths**: works for a spec with one prefix, but large specs have several (`/billing/v1`, `/users/v2`), so the common prefix is usually just `/`. Not chosen.
- **Match on the last N path segments**: tolerant of prefix changes, but unrelated APIs collide on common tails (`/{id}`, `/health`, `/status`). Not chosen.
- **Drop version-like segments wherever they appear, plus configured prefixes (chosen)**: `/billing/v1/invoices` and `/users/v2/me` become `/billing/invoices` and `/users/me`, however many different prefixes the document has. Path-level and operation-level `servers` base paths are added in front first, so moving `/v1` between `servers` and `paths` doesn't matter. Path parameter names are replaced with `{}`. Prefix renames that this misses (`/api/billing` → `/billing`) are caught by the `operationId` and schema signals, or by `strip-prefixes`.

## Decision

A rule **`documents-unrelated`** in RULES.md section 11: kind `wire`, default `error`, implemented in M6.

**When it runs:** after both documents load and are indexed (and after `ignore` exclusions are applied), before the diff. It is skipped when:

- its severity is `off`;
- either document has a `spec-invalid` finding (its sets would be empty or partial);
- the base document has no operations and no schemas (a new API);
- the smaller document has fewer than `min-size` operations **and** fewer than `min-size` schemas;
- `when` is `manual` (the default) and both inputs are the same path at two git revisions, since history already shows they are related.

**Signals**, each a set of keys:

- `operations`: `METHOD /normalised/path` for every operation.
- `operation-ids`: every `operationId`.
- `schemas`: every name under `components.schemas`.

**Path normalisation:** take the operation's effective server base path (operation, then path, then document `servers`; the first entry's path part only) and the path template. Join them, remove each `strip-prefixes` entry from the start, drop every segment matching an `ignore-path-segments` expression, replace `{name}` with `{}`, and drop a trailing `/`.

**Score:** the overlap coefficient \|A ∩ B\| / min(\|A\|, \|B\|) for each signal in `signals` that is non-empty on both sides.

**Result:** the documents are **unrelated** if no signal can be scored, or every scored signal is below `min-overlap`, **and** their identity differs: the `info.title`s differ, or both declare server hosts and none are shared. Otherwise they are related and the diff runs as usual.

**When it fires:** the diff doesn't run, and the result has this single finding (subject `document`). Its details list each signal's shared count, both sides' counts and the score, plus both titles. Its severity comes from the policy as usual, and the exit code follows `--fail-on`. Setting the rule to `off` runs the full diff.

**Options** (POLICY.md section 4): `min-overlap` (0.1), `signals` (`[operations, operation-ids, schemas]`), `min-size` (5), `ignore-path-segments` (`v1`, `v2beta1`-style and `YYYY-MM-DD` segments), `strip-prefixes` (`[]`), `when` (`manual`).

## Impacts

- New rule, registry entry and generated rule page; RULES.md section 11 and POLICY.md section 4 list it. It counts as one of the M6 rules.
- PLAN.md section 4 gets *Checking both inputs are the same API*, and the M6 milestone includes the rule.
- The engine gains a pre-diff step that can end the comparison early. Reports must handle a result with one finding and no diff.
- Test cases gain an `options.policy` field (read from M6) so a case can set rule options or severities.
- New cases: an unrelated pair, several version prefixes, a renamed prefix caught by `operationId`s, a document too small to check, an API that grew from 6 to 70 operations (where Jaccard would fail), and the rule turned `off`.
- The generated rule pages list at most six findings per test case and end longer lists with "… and N more", since the grew case alone expects 64 `operation-added` findings.
- A one-off run without a policy file needs a command-line rule override (e.g. `--rule documents-unrelated=off`), which M6 adds.

## References

- PLAN.md section 4, *Checking both inputs are the same API*; section 6, M6
- RULES.md section 11; POLICY.md section 4; [docs/rules/documents-unrelated.md](../docs/rules/documents-unrelated.md)
- [Command-line syntax for files and git revisions](2026-11-21T0436-cli-input-syntax.md)
- [Problems in either document are findings](2026-11-21T0436-problems-in-either-document.md)
- [Policy file validated strictly, rule docs generated from code](2026-11-21T0319-policy-file-design.md)

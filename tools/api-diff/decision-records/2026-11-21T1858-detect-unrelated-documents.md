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

In each group below, the chosen option is listed first and marked **✅ Chosen**; the rest are marked **Rejected**.

### Where the check lives

- **✅ Chosen: a rule whose finding replaces the diff.** It gets the policy machinery for free (severity, `off`, options, a generated rule page, golden test cases). Its exit code follows `--fail-on` like every other finding, and `off` is the override.
- **Rejected: a hard input error (exit code 2), with a `--allow-unrelated` flag.** Simple, but it duplicates what rules already provide and can't be tuned in the policy file.
- **Rejected: a warning finding alongside the full diff.** The one useful finding is buried under hundreds of meaningless removals.

### How to measure similarity

All of these work on sets of keys built per signal (operations, `operationId`s, schema names), except where noted. Scores for three example pairs:

| Measure | Formula | API grew, 20 → 200 ops | API shrank, 200 → 20 ops | Unrelated, 20 vs 40 ops, 1 shared | |
|---|---|---|---|---|---|
| **Overlap coefficient** | \|A ∩ B\| / min(\|A\|, \|B\|) | **1.00** | **1.00** | 0.05 | **✅ Chosen** |
| Jaccard index | \|A ∩ B\| / \|A ∪ B\| | 0.10 | 0.10 | 0.02 | Rejected |
| Sørensen–Dice | 2\|A ∩ B\| / (\|A\| + \|B\|) | 0.18 | 0.18 | 0.03 | Rejected |
| Containment of base | \|A ∩ B\| / \|A\| | 1.00 | 0.10 | 0.05 | Rejected |

A good measure scores the first two columns high and the third low. Only the overlap coefficient does both.

- **✅ Chosen: overlap coefficient (Szymkiewicz–Simpson)**, \|A ∩ B\| / min(\|A\|, \|B\|). How much of the smaller document is in the larger one. Growth and shrinking both score 1.0 when nothing else changed, and unrelated APIs score close to 0. Its weakness is that a tiny document scores high by accident (1 shared `GET /health` out of 2 operations is 0.5), which `min-size` covers.
- **Rejected: Jaccard index**, \|A ∩ B\| / \|A ∪ B\|. The standard set similarity, but it punishes size differences: an API that keeps its 20 operations and adds 180 scores 0.10, the same as two mostly unrelated APIs. Growth and big removals are exactly the real changes we must not flag.
- **Rejected: Sørensen–Dice coefficient**, 2\|A ∩ B\| / (\|A\| + \|B\|). The same size bias as Jaccard, only milder.
- **Rejected: containment**, \|A ∩ B\| / \|A\|. The right idea (how much of one side survives), but asymmetric: base-in-revision handles growth and revision-in-base handles shrinking, so we'd need both. The larger of the two is the overlap coefficient, so it was chosen in that form.
- **Rejected: cosine similarity or TF-IDF over path and name tokens.** Tolerant of renames, but it needs a tokenizer, a weighting scheme and a threshold that is hard to explain. Unrelated APIs in one company share many tokens (`id`, `list`, `users`, `v1`), which pushes scores up exactly where we need them low.
- **Rejected: MinHash / locality-sensitive hashing.** Estimates Jaccard quickly for huge sets. Our sets have thousands of items at most and exact set operations on them take microseconds, so an estimate adds error for no gain, and it estimates the wrong measure.
- **Rejected: edit distance between paths (Levenshtein) with best matching.** Catches renamed paths, but it is O(n² · path length) and needs an assignment step (e.g. Hungarian) to pair paths up. More than a precheck needs; rename detection belongs to M8.
- **Rejected: tree edit distance over the whole document.** The most precise and by far the most expensive (cubic in the worst case).
- **Rejected: shape-hash overlap of schemas.** Reuses the M4 hashes, but any schema change changes its hash, so a normal release with many edits looks unrelated. Names are more stable than shapes. Could be added later as an extra signal.
- **Rejected: one weighted score over all signals.** Needs weights nobody can justify, and one strong signal (e.g. every `operationId` kept while all paths moved) gets diluted by the others. Each signal is scored on its own instead.

### How to combine the signals

- **✅ Chosen: any one signal passes.** One strong sign of relatedness is enough. A signal that is empty on either side (e.g. no `operationId`s) is skipped rather than counted as 0.
- **✅ Chosen, as well: identity check as a tie-break.** Even when every signal is low, the documents are treated as related if `info.title` is the same and they share a server host (when both declare hosts). A rewrite that kept its name and host is still the same API.
- **Rejected: all signals must pass.** A prefix rename fails the operations signal, so real changes get flagged.

### How to normalise paths

- **✅ Chosen: drop version-like segments wherever they appear, plus configured prefixes.** `/billing/v1/invoices` and `/users/v2/me` become `/billing/invoices` and `/users/me`, however many different prefixes the document has. Path-level and operation-level `servers` base paths are added in front first, so moving `/v1` between `servers` and `paths` doesn't matter. Path parameter names are replaced with `{}`. Prefix renames that this misses (`/api/billing` → `/billing`) are caught by the `operationId` and schema signals, or by `strip-prefixes`.
- **Rejected: strip the longest common prefix of all paths.** Works for a spec with one prefix, but large specs have several (`/billing/v1`, `/users/v2`), so the common prefix is usually just `/`.
- **Rejected: match on the last N path segments.** Tolerant of prefix changes, but unrelated APIs collide on common tails (`/{id}`, `/health`, `/status`).

## Decision

### Choices at a glance

| Question | Chosen | Instead of |
|---|---|---|
| Where the check lives | A rule, `documents-unrelated`, whose finding replaces the diff | Input error with exit code 2; warning next to the full diff |
| **Similarity measure** | **Overlap coefficient**: \|A ∩ B\| / min(\|A\|, \|B\|), per signal | Jaccard, Sørensen–Dice, containment, cosine/TF-IDF, MinHash, edit distance, tree edit distance |
| What is compared | Three sets: operations, `operationId`s, schema names | Schema shape hashes; one weighted score |
| Combining signals | Related if **any** signal reaches `min-overlap` (0.1); matching title and server host also count as related | All signals must pass |
| Path normalisation | Drop version-like segments anywhere, plus `strip-prefixes` and server base paths | Longest common prefix; matching path tails |

### Details

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

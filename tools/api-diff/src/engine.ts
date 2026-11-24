// Runs the pipeline for one comparison: load → model → diff → classify →
// result. Each stage is a pure function over the previous stage's output.

import { resolve } from 'node:path';
import { classify, severityAtLeast } from './classify/classify.ts';
import { diffOperations } from './diff/operations.ts';
import { collapseBulk } from './diff/bulk.ts';
import { diffDocs } from './diff/docs.ts';
import { diffSchemaEngine } from './diff/schema-engine.ts';
import { checkUnrelated, unrelatedOptions } from './diff/unrelated.ts';
import { bumpAdvice, checkVersions, DEFAULT_VERSIONS, recordVersions, schemeOption, usesGitTags } from './diff/versions.ts';
import { compareFindings } from './classify/classify.ts';
import { applyDeprecationPeriod, diffLifecycle, removalOptions, stabilityLevels, today, type LifecycleOptions } from './diff/lifecycle.ts';
import { DEFAULT_LIFECYCLE } from './policy/context.ts';
import { SchemaIndex } from './index/schema-index.ts';
import { orphanedMappings } from './index/orphaned-mappings.ts';
import { DocumentSet, LoadError, type Notice } from './load/documents.ts';
import type { ParseCacheLike } from './load/cache.ts';
import { buildModel, InvalidSpecError, type Model, type Operation } from './model/model.ts';
import { open, type InputSpec, type OpenedInput } from './sources/input.ts';
import { buildContext, componentName, type SpecContext } from './policy/context.ts';
import { applyAcknowledgements, type Acknowledgements } from './policy/acks.ts';
import { componentInSet, operationInSet, setsFor, type ExclusionSet } from './policy/exclusions.ts';
import { HintIndex } from './policy/hints.ts';
import { DEFAULT_OWNERS, OwnerIndex, ownerProblems } from './policy/owners.ts';
import { parseHintRules } from './policy/policy.ts';
import type { Policy } from './policy/policy.ts';
import type { Kind, OperationSummary } from './types.ts';
import type { Change, ComparedSide, Counts, FailOn, Finding, Profile, Result, Side, State } from './types.ts';
import { VERSION } from './version.ts';
import { isChange } from './render/common.ts';
import type { Places } from './render/config.ts';
import { renderTemplate } from './render/template.ts';
import { snippetsFor } from './snippets.ts';

/** The spec context and owners of each result, for report views (include.extensions, include.owners, --uses). Not part of the JSON. */
const PLACES = new WeakMap<Result, Places>();
export const placesOf = (r: Result): Places | undefined => PLACES.get(r);

export interface CompareOptions {
  /** Overrides the policy's profile. */
  profile?: Profile;
  policy?: Policy;
  /** Versions and labels given on the command line; they beat the documents. */
  baseVersion?: string;
  revisionVersion?: string;
  baseLabels?: Record<string, string>;
  revisionLabels?: Record<string, string>;
  /** Parse cache for the base side's files (opt-in, --cache-dir). */
  cache?: ParseCacheLike;
  /** Parse cache for the revision side too (history: each version is parsed once). */
  revisionCache?: ParseCacheLike;
  /** Add source snippets around each finding to the result (for the explore report). */
  snippets?: boolean;
  /** Accepted findings (POLICY.md section 11). */
  acknowledgements?: Acknowledgements;
  /** Reference date for deprecation periods and sunsets, `YYYY-MM-DD`; today (UTC) by default. */
  asOf?: string;
  /** Both inputs are one file at two git revisions (`documents-unrelated` skips those unless `when: always`). */
  sameFile?: boolean;
}

interface LoadedSide {
  model?: Model;
  hints?: HintIndex;
  compared: ComparedSide;
  changes: Change[];
}

const SIDE_NAME: Record<Side, string> = { base: 'base document', revision: 'revision document' };

function noticeToChange(n: Notice, side: Side): Change {
  const c: Change = { rule: n.rule, subject: n.rule === 'not-compared' ? 'document' : SIDE_NAME[side], details: { ...n.details, side } };
  if (n.at) c[side] = n.at;
  return c;
}

async function loadSide(input: OpenedInput, side: Side, cache?: ParseCacheLike): Promise<LoadedSide> {
  const docs = new DocumentSet(input.source, input.root, cache);
  const compared: ComparedSide = { input: input.source.info.input, file: input.source.display(input.root), version: 'unknown' };
  if (input.source.info.commit) compared.commit = input.source.info.commit;
  const changes: Change[] = [];
  try {
    await docs.load();
  } catch (e) {
    if (!(e instanceof LoadError)) throw e;
    compared.unreadable = true;
    return { compared, changes: [{ rule: 'spec-invalid', subject: SIDE_NAME[side], details: { reason: e.message, side } }] };
  }
  compared.sha256 = docs.root.sha256;
  let model: Model | undefined;
  try {
    model = buildModel(docs);
    compared.openapi = model.openapi;
    compared.version = model.infoVersion;
    model.schemaIndex = SchemaIndex.build(docs, model.version, model.usages);
    for (const n of model.schemaIndex.notices) {
      changes.push({ rule: n.rule, subject: n.logical ?? SIDE_NAME[side], [side]: docs.location(n.at), details: { ...n.details, side } });
    }
    // Spec problems a change can introduce are checked on the revision only: one in base is fixed or still there.
    if (side === 'revision') changes.push(...orphanedMappings(docs, model.schemaIndex, side));
  } catch (e) {
    if (!(e instanceof InvalidSpecError)) throw e;
    changes.push({ rule: 'spec-invalid', subject: SIDE_NAME[side], [side]: docs.location({ file: docs.root, segs: [] }), details: { reason: `${compared.file}: ${e.message}`, side } });
  }
  for (const n of docs.notices) changes.push(noticeToChange(n, side));
  if (!model) {
    compared.unreadable = true;
    return { compared, changes };
  }
  const hints = HintIndex.build(docs, side, parseHintRules);
  changes.push(...hints.problems);
  return { model, hints, compared, changes };
}

export async function compareOpened(base: OpenedInput, revision: OpenedInput, opts: CompareOptions = {}): Promise<Result> {
  const profile = opts.profile ?? opts.policy?.profile ?? 'wire';
  const [b, r] = await Promise.all([loadSide(base, 'base', opts.cache), loadSide(revision, 'revision', opts.revisionCache)]);
  let changes: Change[] = [...b.changes, ...r.changes];
  const policy = opts.policy;
  const context = b.model || r.model ? buildContext(b.model, r.model, policy?.lifecycle, { base: b.hints, revision: r.hints }) : undefined;
  const ignoredSets = (policy?.ignore ?? []).map((n) => policy!.exclusions.get(n)!);
  const unrelated = b.model && r.model && !changes.some((c) => c.rule === 'spec-invalid') ? precheck(b.model, r.model, opts) : undefined;
  if (unrelated) changes = [unrelated];
  else if (b.model && r.model) {
    const pairs: [Operation, Operation][] = [];
    const lc = lifecycleOptions(opts);
    const diffs = applyDeprecationPeriod([...diffOperations(b.model, r.model, pairs)], b.model, lc);
    diffs.push(...diffLifecycle(b.model, r.model, pairs, lc));
    const renameMatch = policy?.rules.get('component-renamed')?.options.match as 'exact' | 'similar' | undefined;
    diffs.push(...withoutRenamedRefs(diffSchemaEngine(b.model, r.model, pairs, renameMatch ? { renameMatch } : {})));
    diffs.push(...diffDocs(b.model, r.model, pairs, new Set([lc.lifecycle.stability, lc.lifecycle.deprecatedSince, lc.lifecycle.sunset])));
    const classified = classifyExtensions(diffs, policy?.extensions);
    changes.push(...collapseBulk(applyIgnore(classified, b, r, ignoredSets, context!)), ...ignoredNotices(b, r), ...ignoredSetNotices(ignoredSets, context!));
    const ownerExt = (policy?.owners ?? DEFAULT_OWNERS).extension;
    changes.push(...ownerProblems(b.model, 'base', ownerExt), ...ownerProblems(r.model, 'revision', ownerExt));
  }
  const findings: Finding[] = classify(changes, {
    profile,
    ...(policy ? { policy } : {}),
    ...(context ? { context } : {}),
    hints: { base: b.hints, revision: r.hints },
  });
  // Versions: recorded for each side, then checked against the findings.
  const vs = policy?.versions ?? DEFAULT_VERSIONS;
  // The git-tag source reads the tags on each side's commit, from git sources only.
  const tagsOf = async (input: OpenedInput): Promise<string[] | undefined> => (usesGitTags(vs) && input.source.tagsAt ? await input.source.tagsAt() : undefined);
  const [baseTags, revisionTags] = await Promise.all([tagsOf(base), tagsOf(revision)]);
  for (const [s, side, version, labels, tags] of [[b, b.compared, opts.baseVersion, opts.baseLabels, baseTags], [r, r.compared, opts.revisionVersion, opts.revisionLabels, revisionTags]] as const) {
    recordVersions(side, s.model?.docs.root.parsed.value, vs, { ...(version !== undefined ? { version } : {}), ...(labels ? { labels } : {}) }, tags);
  }
  if (!unrelated && b.model && r.model) {
    const scheme = (id: string): ReturnType<typeof schemeOption> | undefined => {
      const v = policy?.rules.get(id)?.options.scheme;
      return v === undefined ? undefined : schemeOption(v, `rules.${id}.scheme`);
    };
    const chosen = scheme('version-bump-too-small') ?? scheme('version-unchanged') ?? 'semver';
    const set = [scheme('version-bump-too-small'), scheme('version-unchanged')].includes('none') ? 'none' : chosen;
    const extra = checkVersions(findings, b.compared, r.compared, { unchanged: set, bump: set }, opts.baseVersion !== undefined && opts.revisionVersion !== undefined ? ['command line'] : vs.primary);
    if (extra.length) {
      findings.push(...classify(extra, { profile, ...(policy ? { policy } : {}) }));
      findings.sort(compareFindings);
    }
  }
  // Owners: before acknowledgements, which may require one of them.
  const owners = context ? new OwnerIndex(context, policy?.owners ?? DEFAULT_OWNERS) : undefined;
  if (owners) {
    for (const f of findings) {
      if (!isChange(f)) continue;
      const o = owners.finding(f);
      if (o.length) f.owners = o;
    }
  }
  if (opts.acknowledgements?.entries.length) {
    const notices = applyAcknowledgements(findings, opts.acknowledgements, opts.asOf ?? today(), !!policy?.requireAckOwner);
    if (notices.length) {
      findings.push(...classify(notices, { profile, ...(policy ? { policy } : {}) }));
      findings.sort(compareFindings);
    }
  }
  // The policy's wording for messages and client notes (rules.<id>.message / note), most specific rule ID first.
  if (policy?.rules.size) {
    for (const f of findings) {
      const s = [policy.rules.get(f.rule), policy.rules.get(f.baseRule)];
      const message = s.find((x) => x?.message)?.message;
      const note = s.find((x) => x?.note)?.note;
      if (note) f.note = renderTemplate(note, f, 'txt');
      if (message) f.message = renderTemplate(message, f, 'txt');
    }
  }
  const tagged = policy?.exclusions.size && context ? [...policy.exclusions.values()].filter((s) => !policy.ignore.includes(s.name)) : [];
  if (tagged.length) {
    const sets = new Map(tagged.map((s) => [s.name, s]));
    for (const f of findings) {
      const names = setsFor(f.subject, f.impact, sets, context!);
      if (names.length) f.exclusions = names;
    }
  }
  const result: Result = {
    schemaVersion: 0,
    tool: { name: 'api-diff', version: VERSION },
    profile,
    compared: { base: b.compared, revision: r.compared },
    state: stateOf(findings),
    counts: countFindings(findings),
    findings,
  };
  const advice = !unrelated && b.model && r.model ? bumpAdvice(findings, b.compared, r.compared) : undefined;
  if (advice) result.advice = advice;
  if (policy?.file && policy.sha256) result.policy = { file: policy.file, sha256: policy.sha256 };
  if (opts.snippets) Object.assign(result, snippetsFor(findings, b.model?.docs, r.model?.docs));
  if (context) {
    const ops: Record<string, OperationSummary> = {};
    for (const f of findings) {
      for (const s of [f.subject, ...(f.impact ?? [])]) {
        const op = context.operations.get(s);
        if (op && !ops[s]) {
          const o = owners!.operation(s);
          ops[s] = { tags: op.tags, ...(op.operationId ? { operationId: op.operationId } : {}), ...(op.summary ? { summary: op.summary } : {}), ...(o.length ? { owners: o } : {}) };
        }
      }
    }
    if (Object.keys(ops).length) result.operations = ops;
    PLACES.set(result, { ctx: context, owners: owners! });
  }
  return result;

}

/** A $ref that now points at a renamed component's new name is the rename itself, reported once as component-renamed. */
function withoutRenamedRefs(changes: Change[]): Change[] {
  const renames = new Set(changes.filter((c) => c.rule === 'component-renamed').map((c) => `${String(c.details.from)}\u0000${String(c.details.to)}`));
  if (!renames.size) return changes;
  return changes.filter((c) => c.rule !== 'ref-target-changed' || !renames.has(`${String(c.details.from)}\u0000${String(c.details.to)}`));
}

function lifecycleOptions(opts: CompareOptions): LifecycleOptions {
  const p = opts.policy;
  return {
    lifecycle: p?.lifecycle ?? DEFAULT_LIFECYCLE,
    levels: stabilityLevels(p?.rules.get('stability-decreased')?.options.levels),
    removal: removalOptions(p?.rules.get('operation-removed')?.options.unless),
    asOf: opts.asOf ?? today(),
  };
}

/**
 * Drops changes inside nodes marked `x-api-diff: { ignore: true }` (on the
 * side the change is on), and removes ignored operations from impact lists.
 * Runs before bulk collapsing, so a collapsed group never hides an ignored part.
 */
function applyIgnore(changes: Change[], b: LoadedSide, r: LoadedSide, sets: ExclusionSet[], ctx: SpecContext): Change[] {
  if (!b.hints?.ignored.length && !r.hints?.ignored.length && !sets.length) return changes;
  const ignoredOps = new Set<string>();
  for (const s of [b, r]) {
    for (const op of s.model?.operations.values() ?? []) if (s.hints?.isIgnored(s.model!.docs.location(op.at))) ignoredOps.add(`${op.method.toUpperCase()} ${op.path}`);
  }
  for (const [subject, op] of ctx.operations) if (sets.some((set) => operationInSet(set, op))) ignoredOps.add(subject);
  const ignoredComponent = (subject: string): boolean => {
    const name = componentName(subject);
    return name !== undefined && sets.some((set) => componentInSet(set, name, ctx));
  };
  const out: Change[] = [];
  for (const c of changes) {
    if (b.hints?.isIgnored(c.base) || r.hints?.isIgnored(c.revision) || ignoredOps.has(c.subject) || ignoredComponent(c.subject)) continue;
    if (c.impact?.some((s) => ignoredOps.has(s))) {
      const impact = c.impact.filter((s) => !ignoredOps.has(s));
      if (impact.length) out.push({ ...c, impact }); // otherwise only ignored operations use it
    } else out.push(c);
  }
  return out;
}

/** One `not-compared` notice per ignored exclusion set that matched something. */
function ignoredSetNotices(sets: ExclusionSet[], ctx: SpecContext): Change[] {
  const out: Change[] = [];
  for (const set of sets) {
    const ops = [...ctx.operations.entries()].filter(([, op]) => operationInSet(set, op)).map(([s]) => s).sort();
    const comps = [...ctx.components.keys()].filter((n) => componentInSet(set, n, ctx));
    if (!ops.length && !comps.length) continue;
    const parts = [ops.length ? `${ops.length} operation${ops.length === 1 ? '' : 's'}` : '', comps.length ? `${comps.length} component${comps.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ');
    const c: Change = { rule: 'not-compared', subject: 'document', details: { what: `exclusion set '${set.name}' (${parts}; ignored by the policy)`, name: set.name } };
    if (ops.length) c.impact = ops;
    out.push(c);
  }
  return out;
}

/** extension-changed → extension-changed-sdk / -wire for extensions the policy classifies. */
function classifyExtensions(changes: Change[], kinds: Map<string, Kind> | undefined): Change[] {
  if (!kinds?.size) return changes;
  return changes.map((c) => {
    if (c.rule !== 'extension-changed') return c;
    const key = typeof c.details.keyword === 'string' ? c.details.keyword : String(c.details.path ?? '').split('/').pop()!.replace(/~1/g, '/').replace(/~0/g, '~');
    const kind = kinds.get(key);
    return kind && kind !== 'docs' ? { ...c, rule: `extension-changed-${kind}`, details: { ...c.details, name: key } } : c;
  });
}

/** One `not-compared` notice per ignored node (once if it is ignored on both sides). */
function ignoredNotices(b: LoadedSide, r: LoadedSide): Change[] {
  const byPointer = new Map<string, Change>();
  for (const [s, side] of [[b, 'base'], [r, 'revision']] as const) {
    for (const h of s.hints?.ignored ?? []) {
      const key = h.atRoot || h.file === s.model!.docs.root.display ? h.pointer : `${h.file}#${h.pointer}`;
      let c = byPointer.get(key);
      if (!c) byPointer.set(key, (c = { rule: 'not-compared', subject: 'document', details: { what: `#${h.pointer} (x-api-diff: { ignore: true })` } }));
      c[side] = { file: h.file, pointer: h.pointer };
    }
  }
  return [...byPointer.values()];
}

/** The documents-unrelated precheck, unless the policy turns it off or the inputs are one file in git. */
function precheck(base: Model, revision: Model, opts: CompareOptions): Change | undefined {
  if (opts.policy?.rules.get('documents-unrelated')?.severity === 'off') return undefined;
  const raw = opts.policy?.rules.get('documents-unrelated')?.options ?? {};
  const o = unrelatedOptions(raw);
  if (opts.sameFile && o.when === 'manual') return undefined;
  return checkUnrelated(base, revision, o);
}

export async function compareInputs(base: InputSpec, revision: InputSpec, cwd: string, opts: CompareOptions = {}): Promise<Result> {
  const ob = await open(base, cwd, revision);
  let or: OpenedInput | undefined;
  try {
    or = await open(revision, cwd, base);
    const sameFile = (base.kind === 'git' || revision.kind === 'git') && resolve(cwd, base.path) === resolve(cwd, revision.path);
    return await compareOpened(ob, or, { sameFile, ...opts });
  } finally {
    ob.source.close();
    or?.source.close();
  }
}

/** Acknowledged findings count as changes, but not as breaking. */
export function stateOf(findings: Finding[]): State {
  if (findings.length === 0) return 'no-changes';
  return findings.some((f) => f.severity === 'error' && !f.acknowledged) ? 'breaking' : 'compatible';
}

export function countFindings(findings: Finding[]): Counts {
  const c: Counts = { total: findings.length, bySeverity: { error: 0, warn: 0, info: 0 }, byKind: { wire: 0, sdk: 0, docs: 0 }, byRule: {}, acknowledged: 0 };
  for (const f of findings) {
    c.bySeverity[f.severity]++;
    c.byKind[f.kind]++;
    c.byRule[f.rule] = (c.byRule[f.rule] ?? 0) + 1;
    if (f.acknowledged) c.acknowledged++;
  }
  return c;
}

/** True if any finding is at or above `failOn`. */
export function shouldFail(result: Result, failOn: FailOn): boolean {
  if (failOn === 'never') return false;
  return result.findings.some((f) => !f.acknowledged && severityAtLeast(f.severity, failOn));
}

// Runs the pipeline for one comparison: load → model → diff → classify →
// result. Each stage is a pure function over the previous stage's output.

import { resolve } from 'node:path';
import { classify, severityAtLeast } from './classify/classify.ts';
import { diffOperations } from './diff/operations.ts';
import { collapseBulk } from './diff/bulk.ts';
import { diffDocs } from './diff/docs.ts';
import { diffSchemaEngine } from './diff/schema-engine.ts';
import { checkUnrelated, unrelatedOptions } from './diff/unrelated.ts';
import { SchemaIndex } from './index/schema-index.ts';
import { DocumentSet, LoadError, type Notice } from './load/documents.ts';
import { buildModel, InvalidSpecError, type Model, type Operation } from './model/model.ts';
import { open, type InputSpec, type OpenedInput } from './sources/input.ts';
import { buildContext } from './policy/context.ts';
import type { Policy } from './policy/policy.ts';
import type { Change, ComparedSide, Counts, FailOn, Finding, Profile, Result, Side, State } from './types.ts';
import { VERSION } from './version.ts';

export interface CompareOptions {
  /** Overrides the policy's profile. */
  profile?: Profile;
  policy?: Policy;
  /** Both inputs are one file at two git revisions (`documents-unrelated` skips those unless `when: always`). */
  sameFile?: boolean;
}

interface LoadedSide {
  model?: Model;
  compared: ComparedSide;
  changes: Change[];
}

const SIDE_NAME: Record<Side, string> = { base: 'base document', revision: 'revision document' };

function noticeToChange(n: Notice, side: Side): Change {
  const c: Change = { rule: n.rule, subject: n.rule === 'not-compared' ? 'document' : SIDE_NAME[side], details: { ...n.details, side } };
  if (n.at) c[side] = n.at;
  return c;
}

async function loadSide(input: OpenedInput, side: Side): Promise<LoadedSide> {
  const docs = new DocumentSet(input.source, input.root);
  const compared: ComparedSide = { input: input.source.info.input, file: input.source.display(input.root), version: 'unknown' };
  if (input.source.info.commit) compared.commit = input.source.info.commit;
  const changes: Change[] = [];
  try {
    await docs.load();
  } catch (e) {
    if (!(e instanceof LoadError)) throw e;
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
  } catch (e) {
    if (!(e instanceof InvalidSpecError)) throw e;
    changes.push({ rule: 'spec-invalid', subject: SIDE_NAME[side], [side]: docs.location({ file: docs.root, segs: [] }), details: { reason: `${compared.file}: ${e.message}`, side } });
  }
  for (const n of docs.notices) changes.push(noticeToChange(n, side));
  return model ? { model, compared, changes } : { compared, changes };
}

export async function compareOpened(base: OpenedInput, revision: OpenedInput, opts: CompareOptions = {}): Promise<Result> {
  const profile = opts.profile ?? opts.policy?.profile ?? 'wire';
  const [b, r] = await Promise.all([loadSide(base, 'base'), loadSide(revision, 'revision')]);
  let changes: Change[] = [...b.changes, ...r.changes];
  const unrelated = b.model && r.model && !changes.some((c) => c.rule === 'spec-invalid') ? precheck(b.model, r.model, opts) : undefined;
  if (unrelated) changes = [unrelated];
  else if (b.model && r.model) {
    const pairs: [Operation, Operation][] = [];
    const diffs = [...diffOperations(b.model, r.model, pairs)];
    diffs.push(...diffSchemaEngine(b.model, r.model, pairs));
    diffs.push(...diffDocs(b.model, r.model, pairs));
    changes.push(...collapseBulk(diffs));
  }
  const policy = opts.policy;
  const context = policy?.overrides?.length ? buildContext(b.model, r.model, policy.lifecycle) : undefined;
  const findings = classify(changes, policy ? (context ? { profile, policy, context } : { profile, policy }) : { profile });
  return {
    schemaVersion: 0,
    tool: { name: 'api-diff', version: VERSION },
    profile,
    compared: { base: b.compared, revision: r.compared },
    state: stateOf(findings),
    counts: countFindings(findings),
    findings,
  };
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

export function stateOf(findings: Finding[]): State {
  if (findings.length === 0) return 'no-changes';
  return findings.some((f) => f.severity === 'error') ? 'breaking' : 'compatible';
}

export function countFindings(findings: Finding[]): Counts {
  const c: Counts = { total: findings.length, bySeverity: { error: 0, warn: 0, info: 0 }, byKind: { wire: 0, sdk: 0, docs: 0 }, byRule: {} };
  for (const f of findings) {
    c.bySeverity[f.severity]++;
    c.byKind[f.kind]++;
    c.byRule[f.rule] = (c.byRule[f.rule] ?? 0) + 1;
  }
  return c;
}

/** True if any finding is at or above `failOn`. */
export function shouldFail(result: Result, failOn: FailOn): boolean {
  if (failOn === 'never') return false;
  return result.findings.some((f) => severityAtLeast(f.severity, failOn));
}

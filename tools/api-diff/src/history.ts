// History mode (PLAN.md section 5, *Timeline*): how a spec changed step by
// step between two git revisions.
//
//   api-diff history <start>..<end> <spec>
//
// 1. List first-parent commits in the range that touched the spec or any file
//    it reaches with $ref (at the start or the end).
// 2. Load each version once (an in-memory parse cache serves it again as the
//    next step's base) and skip commits whose files are byte-for-byte the
//    same as the previous step's.
// 3. Compare each consecutive pair with the normal engine and policy, and
//    start → end for the net result.
// 4. Link findings across steps: a change undone by a later step is marked
//    reverted.

import { createHash } from 'node:crypto';
import { MemoryParseCache } from './load/cache.ts';
import { DocumentSet, LoadError } from './load/documents.ts';
import { compareOpened, type CompareOptions } from './engine.ts';
import { checkRev, git, GitSource, locate, resolveCommit } from './sources/git.ts';
import { SourceError } from './sources/source.ts';
import type { Finding, Result } from './types.ts';

export interface HistoryOptions extends CompareOptions {
  /** All commits, not only the first-parent (mainline) ones. */
  allCommits?: boolean;
  /** Only commits that have a tag. */
  tagsOnly?: boolean;
  /** Keep at most this many steps (the latest ones); the net result still covers the whole range. */
  maxSteps?: number;
}

export interface Step {
  commit: string;
  date: string;
  author: string;
  subject: string;
  pr?: number;
  tags: string[];
  versions: { base: string; revision: string };
  result: Result;
}

export interface RevertLink {
  /** The finding that made the change, and its step. */
  finding: string;
  step: number;
  /** The finding that undid it, and its step. */
  revertedBy: string;
  revertedIn: number;
}

export interface History {
  report: 'history';
  spec: string;
  range: { start: { rev: string; commit: string }; end: { rev: string; commit: string } };
  steps: Step[];
  /** Steps left out by --max-steps (the earliest ones). */
  omitted: number;
  links: RevertLink[];
  net: Result;
}

/** `#123` from `Merge pull request #123 from …` or a trailing `(#123)`. */
export function prNumber(subject: string): number | undefined {
  const m = /^Merge pull request #(\d+)/.exec(subject) ?? /\(#(\d+)\)\s*$/.exec(subject);
  return m ? Number(m[1]) : undefined;
}

/** Rules that undo each other. A finding is reverted by a later one with the opposite rule at the same place. */
const OPPOSITE: Record<string, string> = {};
for (const [a, b] of [
  ['operation-added', 'operation-removed'],
  ['parameter-added-optional', 'parameter-removed'],
  ['parameter-became-required', 'parameter-became-optional'],
  ['request-body-became-required', 'request-body-became-optional'],
  ['request-media-type-added', 'request-media-type-removed'],
  ['response-media-type-added', 'response-media-type-removed'],
  ['response-success-status-added', 'response-success-status-removed'],
  ['response-error-status-added', 'response-error-status-removed'],
  ['response-header-added', 'response-header-removed'],
  ['security-requirement-added', 'security-requirement-removed'],
  ['security-alternative-added', 'security-alternative-removed'],
  ['security-scope-added', 'security-scope-removed'],
  ['property-added-optional', 'property-removed'],
  ['property-became-required', 'property-became-optional'],
  ['nullable-added', 'nullable-removed'],
  ['format-added', 'format-removed'],
  ['enum-value-added', 'enum-value-removed'],
  ['enum-added', 'enum-removed'],
  ['union-branch-added', 'union-branch-removed'],
  ['discriminator-mapping-added', 'discriminator-mapping-removed'],
  ['unique-items-added', 'unique-items-removed'],
  ['pattern-added', 'pattern-removed'],
  ['max-length-decreased', 'max-length-increased'],
  ['min-length-increased', 'min-length-decreased'],
  ['maximum-decreased', 'maximum-increased'],
  ['minimum-increased', 'minimum-decreased'],
  ['max-items-decreased', 'max-items-increased'],
  ['min-items-increased', 'min-items-decreased'],
  ['max-properties-decreased', 'max-properties-increased'],
  ['min-properties-increased', 'min-properties-decreased'],
  ['deprecated-added', 'deprecated-removed'],
  ['component-added', 'component-removed'],
] as const) {
  OPPOSITE[a] = b;
  OPPOSITE[b] = a;
}

/** Where a change is: its subject, location kind and the details that name the thing changed. */
function place(f: Finding): string {
  const d = f.details;
  return [f.subject, f.rule.replace(/-in-(request|response)$/, '').replace(/^(query|header|cookie)-/, ''), d.path ?? '', d.name ?? '', d.status ?? '', d.mediaType ?? '', d.scheme ?? '', d.branch ?? '', d.value ?? '', JSON.stringify(d.values ?? '')].join('\u0000');
}

/** For limits and similar changes, the revert must also go back to the old value. */
function undoes(earlier: Finding, later: Finding): boolean {
  if (OPPOSITE[earlier.baseRule] !== later.baseRule) return false;
  const placeOf = (f: Finding, rule: string): string => place({ ...f, rule });
  if (placeOf(earlier, earlier.baseRule) !== placeOf(later, earlier.baseRule)) return false;
  if ('from' in earlier.details && 'to' in later.details) return JSON.stringify(earlier.details.from) === JSON.stringify(later.details.to);
  return true;
}

export function linkReverts(steps: { result: Result }[]): RevertLink[] {
  const links: RevertLink[] = [];
  const open: { finding: Finding; step: number }[] = [];
  steps.forEach((s, i) => {
    for (const f of s.result.findings) {
      const j = open.findIndex((o) => undoes(o.finding, f));
      if (j >= 0) {
        const o = open.splice(j, 1)[0]!;
        links.push({ finding: o.finding.id, step: o.step, revertedBy: f.id, revertedIn: i });
      } else open.push({ finding: f, step: i });
    }
  });
  return links;
}

async function tagsByCommit(toplevel: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const lines = (await git(toplevel, ['for-each-ref', '--format=%(objectname) %(*objectname) %(refname:short)', 'refs/tags'])).split('\n').filter(Boolean);
  for (const l of lines) {
    const [obj, peeled, name] = l.split(' ');
    const commit = peeled || obj!;
    out.set(commit, [...(out.get(commit) ?? []), name!]);
  }
  return out;
}

export async function history(range: string, spec: string, cwd: string, opts: HistoryOptions = {}): Promise<History> {
  const m = /^(.+?)\.\.(\.)?(.*)$/.exec(range);
  if (!m || m[2]) throw new SourceError(`history needs a range <start>..<end>, e.g. v1.4.0..HEAD, got '${range}'`);
  const [startRev, endRev] = [m[1]!, m[3] || 'HEAD'];
  checkRev(startRev);
  checkRev(endRev);
  const target = await locate(cwd, spec);
  const [start, end] = await Promise.all([resolveCommit(target.toplevel, startRev), resolveCommit(target.toplevel, endRev)]);
  const cache = new MemoryParseCache();

  const source = (commit: string): GitSource => new GitSource(`${commit.slice(0, 7)}:${spec}`, target.toplevel, commit.slice(0, 7), commit, cwd);
  /** Loads a version; returns its files (for the path list) and a fingerprint, or undefined if the spec isn't there. */
  const loadVersion = async (commit: string): Promise<{ paths: string[]; fingerprint: string } | undefined> => {
    const src = source(commit);
    try {
      const docs = new DocumentSet(src, target.path, cache);
      await docs.load();
      const files = [...docs.files.values()].sort((a, b) => a.path.localeCompare(b.path));
      return { paths: files.map((f) => f.path), fingerprint: createHash('sha256').update(files.map((f) => `${f.path}\u0000${f.sha256}`).join('\n')).digest('hex') };
    } catch (e) {
      if (e instanceof LoadError || e instanceof SourceError) return undefined;
      throw e;
    } finally {
      src.close();
    }
  };

  const first = await loadVersion(start);
  if (!first) throw new SourceError(`${spec} can't be read at ${startRev}`);
  const last = await loadVersion(end);
  const paths = [...new Set([...first.paths, ...(last?.paths ?? [])])];
  const log = await git(target.toplevel, ['log', ...(opts.allCommits ? [] : ['--first-parent']), '--reverse', '--format=%H%x1f%aI%x1f%an%x1f%s', `${start}..${end}`, '--', ...paths]);
  const tags = await tagsByCommit(target.toplevel);
  let candidates = log.split('\n').filter(Boolean).map((l) => {
    const [commit, date, author, subject] = l.split('\x1f') as [string, string, string, string];
    return { commit, date: date.slice(0, 10), author, subject };
  });
  if (opts.tagsOnly) candidates = candidates.filter((c) => tags.has(c.commit) || c.commit === end);

  // Keep commits whose files differ from the previous kept version.
  const kept: typeof candidates = [];
  let prev = first.fingerprint;
  for (const c of candidates) {
    const v = await loadVersion(c.commit);
    if (!v || v.fingerprint === prev) continue;
    kept.push(c);
    prev = v.fingerprint;
  }
  const omitted = opts.maxSteps !== undefined && kept.length > opts.maxSteps ? kept.length - opts.maxSteps : 0;
  const shown = kept.slice(omitted);

  const compare = async (a: string, b: string): Promise<Result> => {
    const [sa, sb] = [source(a), source(b)];
    try {
      return await compareOpened({ source: sa, root: target.path }, { source: sb, root: target.path }, { ...opts, cache, revisionCache: cache, sameFile: true });
    } finally {
      sa.close();
      sb.close();
    }
  };

  const steps: Step[] = [];
  let base = omitted ? kept[omitted - 1]!.commit : start;
  for (const c of shown) {
    const result = await compare(base, c.commit);
    const step: Step = { ...c, tags: tags.get(c.commit) ?? [], versions: { base: result.compared.base.version, revision: result.compared.revision.version }, result };
    const pr = prNumber(c.subject);
    if (pr !== undefined) step.pr = pr;
    steps.push(step);
    base = c.commit;
  }
  const net = await compare(start, end);
  return { report: 'history', spec: target.path, range: { start: { rev: startRev, commit: start }, end: { rev: endRev, commit: end } }, steps, omitted, links: linkReverts(steps), net };
}

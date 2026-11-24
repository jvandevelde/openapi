// Versions (POLICY.md section 9; RULES.md section 9): which version and
// labels each side records, and the version-unchanged and
// version-bump-too-small checks over the classified findings.

import { isObject } from '../load/documents.ts';
import { tagGlob } from '../sources/git.ts';
import { PolicyError } from '../policy/errors.ts';
import { isChange } from '../rules/registry.ts';
import type { Change, ComparedSide, Finding } from '../types.ts';

export interface VersionSettings {
  /** Sources for the primary version, first present wins. */
  primary: string[];
  /** Label name → source. */
  labels: Map<string, string>;
}

export const DEFAULT_VERSIONS: VersionSettings = { primary: ['info.version'], labels: new Map() };

export type Scheme = 'semver' | 'calver' | 'none';

/**
 * A source is `info.<field>`, an `x-` extension at the root (dots step into it: `x-git.sha`),
 * a JSON Pointer, or `git-tag` / `git-tag:<glob>`: a (matching) tag on the side's commit, for git inputs.
 */
function checkSource(s: unknown, where: string): string {
  if (typeof s !== 'string' || !(/^info\.[^.]+$/.test(s) || /^x-[^.]+(\.[^.]+)*$/.test(s) || s.startsWith('/') || /^git-tag(:.+)?$/.test(s))) throw new PolicyError(`${where}: must be info.<field>, an x- extension (x-git.sha steps into x-git), a JSON Pointer (/info/x-meta/version) or git-tag[:<glob>] (a tag on the commit, e.g. git-tag:v*), got ${JSON.stringify(s)}`);
  return s;
}

export const usesGitTags = (v: VersionSettings): boolean => [...v.primary, ...v.labels.values()].some((s) => s.startsWith('git-tag'));

/**
 * The version a `git-tag[:<glob>]` source gives: the matching tag on the commit, as named.
 * With several, the highest semver one (tags that aren't semver come after, by name).
 */
export function tagVersion(tags: string[] | undefined, source: string): string | undefined {
  const glob = source.startsWith('git-tag:') ? tagGlob(source.slice('git-tag:'.length)) : undefined;
  const matching = (tags ?? []).filter((t) => !glob || glob.test(t));
  const key = (t: string): [number, number, number, number] => {
    const v = parseSemver(t);
    return v ? [1, v.major, v.minor, v.patch] : [0, 0, 0, 0];
  };
  return matching.sort((a, b) => key(a).map((n, i) => n - key(b)[i]!).find((d) => d !== 0) ?? a.localeCompare(b)).at(-1);
}

const read = (doc: unknown, source: string, tags: string[] | undefined): string | undefined => (source.startsWith('git-tag') ? tagVersion(tags, source) : readSource(doc, source));

export function parseVersions(raw: Record<string, unknown>, where: string): VersionSettings {
  const v: VersionSettings = { primary: [...DEFAULT_VERSIONS.primary], labels: new Map() };
  for (const [k, val] of Object.entries(raw)) {
    if (k === 'primary') {
      if (!isObject(val) || Object.keys(val).some((x) => x !== 'from')) throw new PolicyError(`${where}.primary: must be a mapping with from`);
      const from = Array.isArray(val.from) ? val.from : [val.from];
      if (from.length === 0) throw new PolicyError(`${where}.primary.from: must name at least one source`);
      v.primary = from.map((s, i) => checkSource(s, `${where}.primary.from[${i}]`));
    } else if (k === 'labels') {
      if (!isObject(val)) throw new PolicyError(`${where}.labels: must be a mapping of label names to sources`);
      for (const [name, src] of Object.entries(val)) v.labels.set(name, checkSource(src, `${where}.labels.${name}`));
    } else throw new PolicyError(`${where}.${k}: unknown key (versions takes primary and labels)`);
  }
  return v;
}

/** Reads a source from a parsed root document; scalars only. */
export function readSource(doc: unknown, source: string): string | undefined {
  let segs: string[];
  if (source.startsWith('/')) segs = source.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  else if (source.startsWith('info.')) segs = ['info', source.slice(5)];
  else segs = source.split('.');
  let v: unknown = doc;
  for (const s of segs) {
    if (!isObject(v) && !Array.isArray(v)) return undefined;
    v = (v as Record<string, unknown>)[s];
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : undefined;
}

/**
 * Fills `version`, `versionSource` and `labels` on a side from the document, the tags on its
 * commit (`tags`, for git inputs) and CLI values. Only the configured sources count: with none
 * present the version is `unknown`.
 */
export function recordVersions(side: ComparedSide, doc: unknown, settings: VersionSettings, cli: { version?: string; labels?: Record<string, string> } = {}, tags?: string[]): void {
  delete side.versionSource;
  if (cli.version !== undefined) {
    side.version = cli.version;
    side.versionSource = 'command line';
  } else {
    side.version = 'unknown';
    for (const s of settings.primary) {
      const v = read(doc, s, tags);
      if (v !== undefined) {
        side.version = v;
        side.versionSource = s;
        break;
      }
    }
  }
  const title = readSource(doc, 'info.title');
  if (title !== undefined) side.title = title;
  const labels: Record<string, string> = {};
  if (side.commit) labels.commit = side.commit;
  for (const [name, src] of settings.labels) {
    const v = read(doc, src, tags);
    if (v !== undefined) labels[name] = v;
  }
  Object.assign(labels, cli.labels ?? {});
  if (Object.keys(labels).length) side.labels = labels;
}

// --- Checks ----------------------------------------------------------------

export type Level = 'none' | 'patch' | 'minor' | 'major';
const RANK: Record<Level, number> = { none: 0, patch: 1, minor: 2, major: 3 };

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

/** Parses `1.2.3`, `v1.2.3` and `1.2.3-rc.1+build` (pre-release and build ignored for the bump). */
export function parseSemver(v: string): Semver | undefined {
  const m = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(v);
  return m ? { major: +m[1]!, minor: +m[2]!, patch: +m[3]! } : undefined;
}

function bumpOf(a: Semver, b: Semver): Level {
  if (b.major !== a.major) return b.major > a.major ? 'major' : 'none';
  if (b.minor !== a.minor) return b.minor > a.minor ? 'minor' : 'none';
  if (b.patch !== a.patch) return b.patch > a.patch ? 'patch' : 'none';
  return 'none';
}

/** The bump the findings need: error → major, other wire/sdk → minor, docs → patch; one level lower for 0.x. */
export function neededBump(findings: Finding[], base: Semver): { level: Level; because: string | undefined } {
  let level: Level = 'none';
  let because: string | undefined;
  for (const f of findings) {
    if (!isChange(f)) continue;
    const l: Level = f.severity === 'error' ? 'major' : f.kind === 'docs' ? 'patch' : 'minor';
    if (RANK[l] > RANK[level]) [level, because] = [l, `${f.rule} at ${f.subject}`];
  }
  if (base.major === 0 && level !== 'none') level = level === 'major' ? 'minor' : 'patch';
  return { level, because };
}

export interface BumpAdvice {
  /** The bump the findings need. */
  needed: Level;
  /** The bump the versions show. */
  actual: Level;
  ok: boolean;
  /** The finding that sets `needed`, e.g. `operation-removed at DELETE /pets`. */
  because?: string;
  /** How many findings need a major bump (breaking changes). */
  breaking: number;
}

/** Semver advice for the result, when both versions are semver; acknowledgements don't change it. */
export function bumpAdvice(findings: Finding[], base: ComparedSide, rev: ComparedSide): BumpAdvice | undefined {
  const [a, b] = [parseSemver(base.version), parseSemver(rev.version)];
  if (!a || !b) return undefined;
  const changed = findings.filter(isChange);
  const need = neededBump(changed, a);
  const actual = bumpOf(a, b);
  const advice: BumpAdvice = { needed: need.level, actual, ok: RANK[actual] >= RANK[need.level], breaking: changed.filter((f) => f.severity === 'error').length };
  if (need.because) advice.because = need.because;
  return advice;
}

/**
 * version-unchanged / version-bump-too-small, or a not-compared notice when the versions can't
 * be checked (a side has no version from the sources `tried`, or one isn't semver).
 */
export function checkVersions(findings: Finding[], base: ComparedSide, rev: ComparedSide, schemes: { unchanged: Scheme; bump: Scheme }, tried: string[] = DEFAULT_VERSIONS.primary): Change[] {
  const changed = findings.filter(isChange);
  if (!changed.length || (schemes.unchanged === 'none' && schemes.bump === 'none')) return [];
  const missing = ([['base', base], ['revision', rev]] as const).filter(([, s]) => s.version === 'unknown').map(([n]) => n);
  if (missing.length) return [{ rule: 'not-compared', subject: 'document', details: { what: `version checks (no version for the ${missing.join(' and ')}; tried ${tried.join(', ')})`, name: 'version-checks' } }];
  const details = { from: base.version, to: rev.version };
  if (base.version === rev.version) {
    return schemes.unchanged === 'none' ? [] : [{ rule: 'version-unchanged', subject: 'document', details: { ...details, changes: changed.length } }];
  }
  if (schemes.bump !== 'semver') return [];
  const [a, b] = [parseSemver(base.version), parseSemver(rev.version)];
  if (!a || !b) return [{ rule: 'not-compared', subject: 'document', details: { what: `version bump (${!a ? base.version : rev.version} isn't a semver version)`, name: 'version-bump' } }];
  const need = neededBump(changed, a);
  const got = bumpOf(a, b);
  if (RANK[got] >= RANK[need.level]) return [];
  return [{ rule: 'version-bump-too-small', subject: 'document', details: { ...details, needed: need.level, got, because: need.because } }];
}

export function schemeOption(v: unknown, where: string): Scheme {
  if (v === undefined) return 'semver';
  if (v !== 'semver' && v !== 'calver' && v !== 'none') throw new PolicyError(`${where}: must be semver, calver or none`);
  return v;
}

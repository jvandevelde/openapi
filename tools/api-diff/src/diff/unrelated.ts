// The documents-unrelated precheck: before the diff, check that the two
// documents share something. Design and the alternatives considered are in
// decision-records/2026-11-21T1858-detect-unrelated-documents.md.
//
// Each signal is a set of string keys. Two items match only if their keys are
// identical (case-sensitive; HTTP methods upper-cased). Each signal is scored
// with the overlap coefficient, |A ∩ B| / min(|A|, |B|).

import { PolicyError } from '../policy/errors.ts';
import type { Model } from '../model/model.ts';
import type { Change } from '../types.ts';

export type Signal = 'operations' | 'operation-ids' | 'schemas';
const SIGNALS: readonly Signal[] = ['operations', 'operation-ids', 'schemas'];
const SIGNAL_NAMES: Record<Signal, string> = { operations: 'operations', 'operation-ids': 'operationIds', schemas: 'schemas' };

export interface UnrelatedOptions {
  minOverlap: number;
  signals: Signal[];
  minSize: number;
  ignorePathSegments: RegExp[];
  stripPrefixes: string[];
  when: 'manual' | 'always';
}

export const DEFAULT_IGNORE_SEGMENTS = ['^v\\d+((alpha|beta|rc)\\d*)?$', '^\\d{4}-\\d{2}-\\d{2}$'];

/** Validates the rule's policy options and fills in defaults. */
export function unrelatedOptions(raw: Record<string, unknown>, where = 'rules.documents-unrelated'): UnrelatedOptions {
  const o: UnrelatedOptions = { minOverlap: 0.1, signals: [...SIGNALS], minSize: 5, ignorePathSegments: DEFAULT_IGNORE_SEGMENTS.map((r) => new RegExp(r)), stripPrefixes: [], when: 'manual' };
  const v = raw['min-overlap'];
  if (v !== undefined) {
    if (typeof v !== 'number' || !(v >= 0 && v <= 1)) throw new PolicyError(`${where}.min-overlap: must be a number from 0 to 1`);
    o.minOverlap = v;
  }
  const sig = raw.signals;
  if (sig !== undefined) {
    if (!Array.isArray(sig) || sig.length === 0 || !sig.every((s) => (SIGNALS as readonly unknown[]).includes(s))) throw new PolicyError(`${where}.signals: must be a non-empty list of ${SIGNALS.join(', ')}`);
    o.signals = [...new Set(sig as Signal[])];
  }
  const size = raw['min-size'];
  if (size !== undefined) {
    if (!Number.isInteger(size) || (size as number) < 0) throw new PolicyError(`${where}.min-size: must be a whole number, 0 or more`);
    o.minSize = size as number;
  }
  const segs = raw['ignore-path-segments'];
  if (segs !== undefined) {
    if (!Array.isArray(segs) || !segs.every((s) => typeof s === 'string')) throw new PolicyError(`${where}.ignore-path-segments: must be a list of regular expressions`);
    o.ignorePathSegments = segs.map((s: string) => {
      try {
        return new RegExp(s);
      } catch (e) {
        throw new PolicyError(`${where}.ignore-path-segments: '${s}' is not a valid regular expression: ${(e as Error).message}`);
      }
    });
  }
  const pre = raw['strip-prefixes'];
  if (pre !== undefined) {
    if (!Array.isArray(pre) || !pre.every((s) => typeof s === 'string' && s.startsWith('/'))) throw new PolicyError(`${where}.strip-prefixes: must be a list of paths starting with /`);
    o.stripPrefixes = pre.map((s: string) => s.replace(/\/+$/, '')).filter((s) => s !== '');
  }
  const when = raw.when;
  if (when !== undefined) {
    if (when !== 'manual' && when !== 'always') throw new PolicyError(`${where}.when: must be manual or always`);
    o.when = when;
  }
  return o;
}

/** The path part of a server URL: `https://api.example.com/v1` → `/v1`; relative URLs as given. */
function serverPath(url: string): string {
  const p = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  return p.startsWith('/') ? p : `/${p}`;
}

/** The host of an absolute server URL, lower-cased, or undefined. */
function serverHost(url: string): string | undefined {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/:]+)/i.exec(url);
  return m ? m[1]!.toLowerCase() : undefined;
}

/** `GET /billing/v1/invoices/{id}` → `GET /billing/invoices/{}` (with server base path, prefixes and version segments handled). */
export function operationKey(method: string, path: string, server: string | undefined, o: UnrelatedOptions): string {
  let full = (server ? serverPath(server) : '').replace(/\/+$/, '') + path;
  for (const prefix of o.stripPrefixes) {
    if (full === prefix || full.startsWith(`${prefix}/`)) {
      full = full.slice(prefix.length);
      break;
    }
  }
  const segs = full
    .split('/')
    .filter((s) => s !== '' && !o.ignorePathSegments.some((r) => r.test(s)))
    .map((s) => (/^\{[^}]*\}$/.test(s) ? '{}' : s));
  return `${method.toUpperCase()} /${segs.join('/')}`;
}

interface Keys {
  sets: Record<Signal, Set<string>>;
  title: string | undefined;
  hosts: Set<string>;
}

function keysOf(m: Model, o: UnrelatedOptions): Keys {
  const doc = m.docs.root.parsed.value as Record<string, unknown>;
  const info = (doc.info ?? {}) as Record<string, unknown>;
  const components = (doc.components ?? {}) as Record<string, unknown>;
  const schemas = components.schemas && typeof components.schemas === 'object' ? Object.keys(components.schemas) : [];
  const ops = new Set<string>();
  const ids = new Set<string>();
  const hosts = new Set<string>();
  for (const u of m.documentServers) {
    const h = serverHost(u);
    if (h) hosts.add(h);
  }
  for (const op of m.operations.values()) {
    ops.add(operationKey(op.method, op.path, op.servers[0], o));
    if (op.operationId !== undefined) ids.add(op.operationId);
    for (const u of op.servers) {
      const h = serverHost(u);
      if (h) hosts.add(h);
    }
  }
  return { sets: { operations: ops, 'operation-ids': ids, schemas: new Set(schemas) }, title: typeof info.title === 'string' ? info.title : undefined, hosts };
}

export interface SignalScore {
  shared: number;
  base: number;
  revision: number;
  score: number;
}

/**
 * Returns a `documents-unrelated` change if the documents look like different
 * APIs, or undefined (related, or the check doesn't apply).
 */
export function checkUnrelated(base: Model, revision: Model, o: UnrelatedOptions): Change | undefined {
  const b = keysOf(base, o);
  const r = keysOf(revision, o);
  if (b.sets.operations.size === 0 && b.sets.schemas.size === 0) return undefined; // a new API
  const smaller = (s: Signal): number => Math.min(b.sets[s].size, r.sets[s].size);
  if (smaller('operations') < o.minSize && smaller('schemas') < o.minSize) return undefined; // too small to tell

  const scores: Partial<Record<Signal, SignalScore>> = {};
  for (const s of o.signals) {
    const [x, y] = [b.sets[s], r.sets[s]];
    if (x.size === 0 || y.size === 0) continue; // nothing to score
    const [small, large] = x.size <= y.size ? [x, y] : [y, x];
    let shared = 0;
    for (const k of small) if (large.has(k)) shared++;
    const score = shared / small.size;
    if (score >= o.minOverlap) return undefined;
    scores[s] = { shared, base: x.size, revision: y.size, score: Math.round(score * 1000) / 1000 };
  }
  const sameTitle = b.title !== undefined && b.title === r.title;
  const sharedHost = [...b.hosts].some((h) => r.hosts.has(h));
  const hostsDiffer = b.hosts.size > 0 && r.hosts.size > 0 && !sharedHost;
  if (sameTitle && !hostsDiffer) return undefined; // same name and no conflicting host: a rewrite of the same API

  const parts = (Object.entries(scores) as [Signal, SignalScore][]).map(([s, v]) => `${v.shared} of ${Math.min(v.base, v.revision)} ${SIGNAL_NAMES[s]}`);
  const shared = parts.length ? `only ${parts.join(', ')} shared` : 'nothing to compare';
  const titles = b.title !== r.title ? `; titles '${b.title ?? '(none)'}' and '${r.title ?? '(none)'}'` : '';
  return {
    rule: 'documents-unrelated',
    subject: 'document',
    base: base.docs.location({ file: base.docs.root, segs: [] }),
    revision: revision.docs.location({ file: revision.docs.root, segs: [] }),
    details: { summary: `${shared}${titles}`, signals: scores, minOverlap: o.minOverlap, titles: { base: b.title ?? null, revision: r.title ?? null } },
  };
}

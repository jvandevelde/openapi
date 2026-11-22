// Ownership routing (POLICY.md section 14): which teams own each finding.
//
// Owners come from the spec (`x-owner`, or the extension the policy names)
// and from the policy's `owners.assign` list. For an operation, the first of
// these that names owners wins:
//
//   1. the operation's x-owner, then its path item's
//   2. the x-owner of the operation's tags (top-level `tags` entries), all of them
//   3. the last `owners.assign` entry whose match fits the operation
//   4. the document's x-owner
//
// A component schema's own owners are its x-owner, else the last matching
// `assign` entry (by component name or extension). A finding's owners are
// its subject's owners (operation or component) plus the owners of every
// operation it affects; a finding with neither gets the document's owners.

import { isObject } from '../load/documents.ts';
import type { Model } from '../model/model.ts';
import type { Change, Finding, Side } from '../types.ts';
import { componentName, type OperationInfo, type SpecContext } from './context.ts';
import { PolicyError } from './errors.ts';
import { matches, parseMatch, type OverrideMatch } from './overrides.ts';

export interface OwnerAssignment {
  /** 1-based position in `owners.assign`, for messages. */
  index: number;
  label: string;
  match: OverrideMatch;
  owners: string[];
}

export interface OwnerSettings {
  /** The extension spec authors name owners with. */
  extension: string;
  /** In file order; the last match wins. */
  assign: OwnerAssignment[];
}

export const DEFAULT_OWNERS: OwnerSettings = { extension: 'x-owner', assign: [] };

/** Match keys that describe a place (not a kind of change), so they make sense for ownership. */
const PLACE_KEYS = ['path', 'method', 'operationId', 'tag', 'stability', 'extension', 'component'] as const;

/** `"@team"` or `["@a", "@b"]` → a list, or undefined if the value isn't one of those. */
export function ownerList(v: unknown): string[] | undefined {
  const l = typeof v === 'string' ? [v] : v;
  if (!Array.isArray(l) || l.length === 0 || !l.every((s) => typeof s === 'string' && s.trim() !== '')) return undefined;
  return l.map((s: string) => s.trim());
}

export function parseOwners(raw: Record<string, unknown>, where: string, suggest: (w: string, c: readonly string[]) => string): OwnerSettings {
  const out: OwnerSettings = { extension: DEFAULT_OWNERS.extension, assign: [] };
  for (const [k, v] of Object.entries(raw)) {
    const at = `${where}.${k}`;
    if (k === 'extension') {
      if (typeof v !== 'string' || !v.startsWith('x-')) throw new PolicyError(`${at}: must be an x- extension name`);
      if (v === 'x-api-diff') throw new PolicyError(`${at}: x-api-diff configures api-diff and can't name owners`);
      out.extension = v;
    } else if (k === 'assign') {
      if (!Array.isArray(v)) throw new PolicyError(`${at}: must be a list of { match, owners }`);
      out.assign = v.map((entry, i) => {
        const w = `${at}[${i}]`;
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new PolicyError(`${w}: must be a mapping with match and owners`);
        const e = entry as Record<string, unknown>;
        for (const ek of Object.keys(e)) if (ek !== 'match' && ek !== 'owners') throw new PolicyError(`${w}.${ek}: unknown key${suggest(ek, ['match', 'owners'])}`);
        if (e.match === undefined) throw new PolicyError(`${w}: needs match`);
        const owners = ownerList(e.owners);
        if (!owners) throw new PolicyError(`${w}.owners: must be a team name or a list of team names, e.g. "@orders-team"`);
        const { match, label } = parseMatch(e.match, `${w}.match`, suggest, PLACE_KEYS);
        return { index: i + 1, label, match, owners };
      });
    } else throw new PolicyError(`${at}: unknown key${suggest(k, ['extension', 'assign'])}`);
  }
  return out;
}

/** `spec-invalid` for owner extensions whose value isn't a team name or a list of them. */
export function ownerProblems(m: Model, side: Side, extension: string): Change[] {
  const root = m.docs.root;
  const doc = root.parsed.value;
  if (!isObject(doc)) return [];
  const out: Change[] = [];
  const check = (node: unknown, segs: string[]): void => {
    if (!isObject(node) || !(extension in node) || ownerList(node[extension]) !== undefined) return;
    const at = m.docs.location({ file: root, segs: [...segs, extension] });
    out.push({ rule: 'spec-invalid', subject: side === 'base' ? 'base document' : 'revision document', [side]: at, details: { reason: `${at.file}: ${extension} at #${at.pointer.replace(/\/[^/]*$/, '') || '/'} must be a team name or a list of team names`, side } });
  };
  check(doc, []);
  if (Array.isArray(doc.tags)) doc.tags.forEach((t, i) => check(t, ['tags', String(i)]));
  if (isObject(doc.paths)) {
    for (const [p, item] of Object.entries(doc.paths)) {
      check(item, ['paths', p]);
      if (isObject(item)) for (const [k, op] of Object.entries(item)) if (!k.startsWith('x-')) check(op, ['paths', p, k]);
    }
  }
  const schemas = isObject(doc.components) && isObject(doc.components.schemas) ? doc.components.schemas : {};
  for (const [name, s] of Object.entries(schemas)) check(s, ['components', 'schemas', name]);
  return out;
}

const target = (op: OperationInfo | undefined, subject: string) => ({ rule: '', baseRule: '', kind: 'wire' as const, direction: undefined, subject, op });

export class OwnerIndex {
  private readonly ops = new Map<string, string[]>();
  private readonly components = new Map<string, string[]>();
  readonly document: string[];
  private readonly ctx: SpecContext;
  private readonly settings: OwnerSettings;

  constructor(ctx: SpecContext, settings: OwnerSettings) {
    this.ctx = ctx;
    this.settings = settings;
    this.document = ownerList(ctx.document[settings.extension]) ?? [];
  }

  private assigned(op: OperationInfo | undefined, subject: string): string[] | undefined {
    let found: string[] | undefined;
    for (const a of this.settings.assign) if (matches(a.match, target(op, subject), this.ctx)) found = a.owners;
    return found;
  }

  /** An operation's owners, from the precedence list above; empty if nobody owns it. */
  operation(key: string): string[] {
    let o = this.ops.get(key);
    if (o) return o;
    const op = this.ctx.operations.get(key);
    if (!op) return [];
    const x = this.settings.extension;
    o = ownerList(op.extensions[x]);
    if (!o) {
      const fromTags = op.tags.flatMap((t) => ownerList(this.ctx.tags.get(t)?.[x]) ?? []);
      if (fromTags.length) o = fromTags;
    }
    o ??= this.assigned(op, key) ?? this.document;
    o = [...new Set(o)];
    this.ops.set(key, o);
    return o;
  }

  /** A component schema's own owners (not those of the operations using it). */
  component(name: string): string[] {
    let o = this.components.get(name);
    if (o) return o;
    o = ownerList(this.ctx.components.get(name)?.[this.settings.extension]) ?? this.assigned(undefined, `#/components/schemas/${name}`) ?? [];
    this.components.set(name, o);
    return o;
  }

  /** A finding's owners, sorted; empty if nobody owns it. */
  finding(f: Pick<Finding, 'subject' | 'impact'>): string[] {
    const out = new Set<string>();
    if (this.ctx.operations.has(f.subject)) for (const o of this.operation(f.subject)) out.add(o);
    const c = componentName(f.subject);
    if (c !== undefined) for (const o of this.component(c)) out.add(o);
    for (const s of f.impact ?? []) for (const o of this.operation(s)) out.add(o);
    if (out.size === 0) for (const o of this.document) out.add(o);
    return [...out].sort();
  }
}

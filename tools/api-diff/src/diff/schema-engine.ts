// Schema engine (M5): compares the schemas each operation uses, in the
// direction the client uses them (`in`: sends, `out`: receives), and turns
// differences into schema, reference and docs changes.
//
// - Effective schemas: `allOf` is merged, but every keyword remembers the
//   schema it came from, so a change inside a shared base type is reported
//   once, at its real location, with the operations of every subtype.
// - Pairs of schema nodes (`$ref` targets and operation schemas) are walked
//   once per direction and cached; a pair already in progress is assumed
//   equal, which makes recursive schemas safe. Unchanged subtrees (equal deep
//   hashes) are skipped.
// - Each change is attributed to the pair it was found in; after all walks,
//   the operations that reach that pair become its impact.
// - One finding per direction (decision record 2026-11-21T1539-schema-engine).

import { canonicalString, localTrees } from '../index/canonical.ts';
import type { SchemaIndex, SchemaNode } from '../index/schema-index.ts';
import { getAt, isObject, type DocumentSet } from '../load/documents.ts';
import type { Model, Operation } from '../model/model.ts';
import { normalizeSchemaKeywords, type OasVersion } from '../normalize/normalize.ts';
import type { Change, Direction, Location } from '../types.ts';

/** A schema position: a node of the schema index and a path inside it. */
interface Pos {
  node: SchemaNode;
  path: string[];
}

interface Side {
  model: Model;
  index: SchemaIndex;
  docs: DocumentSet;
  version: OasVersion;
}

interface Kw {
  value: unknown;
  at: Pos;
}

/** A schema with `allOf` merged in. Each keyword keeps its origin. */
interface Eff {
  at: Pos;
  kw: Map<string, Kw>;
  properties: Map<string, Pos>;
  required: Map<string, Pos>;
  types: { set: Set<string> | undefined; at: Pos | undefined };
  union: { kind: 'oneOf' | 'anyOf'; branches: Pos[]; at: Pos } | undefined;
}

const LIMITS: [kw: string, kind: 'max' | 'min', up: string, down: string][] = [
  ['maxLength', 'max', 'max-length-increased', 'max-length-decreased'],
  ['minLength', 'min', 'min-length-increased', 'min-length-decreased'],
  ['maxItems', 'max', 'max-items-increased', 'max-items-decreased'],
  ['minItems', 'min', 'min-items-increased', 'min-items-decreased'],
  ['maxProperties', 'max', 'max-properties-increased', 'max-properties-decreased'],
  ['minProperties', 'min', 'min-properties-increased', 'min-properties-decreased'],
];

/** Keywords handled explicitly; any other shape keyword that differs is unclassified. */
const HANDLED = new Set([
  'type', 'format', 'enum', 'const', 'default', 'title', 'pattern', 'multipleOf', 'uniqueItems',
  'maxLength', 'minLength', 'maxItems', 'minItems', 'maxProperties', 'minProperties',
  'maximum', 'minimum', 'exclusiveMaximum', 'exclusiveMinimum',
  'properties', 'required', 'additionalProperties', 'items', 'prefixItems', 'allOf', 'oneOf', 'anyOf', 'discriminator',
  'readOnly', 'writeOnly', 'not', 'propertyNames', 'dependentRequired', 'minContains', 'maxContains', 'contentMediaType', 'contentEncoding', '$ref',
]);
const DOCS: Record<string, string> = { description: 'description-changed', example: 'example-changed', examples: 'example-changed', externalDocs: 'external-docs-changed' };
const IGNORED = new Set(['deprecated', '$comment', '$id', '$schema', '$anchor', '$dynamicAnchor', '$defs', 'definitions', 'nullable']);

/** Literal nesting beyond this is compared by hash only, so deep files can't overflow the stack. */
const MAX_DEPTH = 400;

const canon = (v: unknown): string => canonicalString(sorted(v));
function sorted(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sorted);
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])]));
}

const opSubject = (op: Operation): string => `${op.method.toUpperCase()} ${op.path}`;

interface Raw {
  change: Change;
  pairs: Set<string>;
}

export class SchemaEngine {
  readonly #b: Side;
  readonly #r: Side;
  /** Pairs already walked, per direction. */
  readonly #done = new Set<string>();
  /** Pair graph, child → parents, for impact. */
  readonly #parents = new Map<string, Set<string>>();
  /** Root pair → operation subject. */
  readonly #roots = new Map<string, string>();
  readonly #raw = new Map<string, Raw>();
  /** Inline operation schemas → their operation's subject. */
  readonly #inlineOwner = new Map<string, string>();
  /** Named nodes (base side) reached by some usage walk. */
  readonly #visited = new Set<string>();
  /** Unclassified differences per schema node: node id → pointers. */
  readonly #unclassified = new Map<string, { b: Pos; r: Pos; pointers: Set<string>; pairs: Set<string> }>();
  #pair = '';

  constructor(base: Model, rev: Model) {
    this.#b = { model: base, index: base.schemaIndex!, docs: base.docs, version: base.version };
    this.#r = { model: rev, index: rev.schemaIndex!, docs: rev.docs, version: rev.version };
  }

  run(pairs: [Operation, Operation][]): Change[] {
    for (const [bo, ro] of pairs) {
      for (const u of ro.schemas.values()) {
        const n = this.#r.index.get(u.at);
        if (n && !n.named) this.#inlineOwner.set(`r:${n.id}`, opSubject(ro));
      }
      for (const u of bo.schemas.values()) {
        const n = this.#b.index.get(u.at);
        if (n && !n.named) this.#inlineOwner.set(`b:${n.id}`, opSubject(ro));
      }
    }
    for (const [bo, ro] of pairs) {
      for (const [key, bu] of bo.schemas) {
        const ru = ro.schemas.get(key);
        const b = this.#b.index.get(bu.at);
        const r = ru && this.#r.index.get(ru.at);
        if (!ru || !b || !r) continue;
        const root = `root|${opSubject(ro)}|${key}|${bu.direction}`;
        this.#roots.set(root, opSubject(ro));
        this.#walkPair(b, r, bu.direction, root);
      }
    }
    const out: Change[] = [];
    for (const { change, pairs: ps } of this.#raw.values()) {
      const impact = this.#impact(ps);
      if (impact.length && !change.subject.match(/^[A-Z]+ \//)) change.impact = impact;
      out.push(change);
    }
    for (const u of this.#unclassified.values()) {
      const c = this.#change('unclassified-change', undefined, u.b, u.r, { changed: [...u.pointers].sort() });
      const impact = this.#impact(u.pairs);
      if (impact.length && !c.subject.match(/^[A-Z]+ \//)) c.impact = impact;
      out.push(c);
    }
    out.push(...this.#components());
    return out;
  }

  /** Operations whose usage walks reach any of `pairs`. */
  #impact(pairs: Set<string>): string[] {
    const ops = new Set<string>();
    const seen = new Set<string>();
    const todo = [...pairs];
    while (todo.length) {
      const p = todo.pop()!;
      if (seen.has(p)) continue;
      seen.add(p);
      const op = this.#roots.get(p);
      if (op) ops.add(op);
      for (const q of this.#parents.get(p) ?? []) todo.push(q);
    }
    return [...ops].sort();
  }

  // --- Positions ---------------------------------------------------------

  #side(which: 'b' | 'r'): Side {
    return which === 'b' ? this.#b : this.#r;
  }

  #value(which: 'b' | 'r', p: Pos): unknown {
    const v = getAt(this.#side(which).docs.value(p.node.ref), p.path);
    return isObject(v) ? normalizeSchemaKeywords(v, this.#side(which).version) : v;
  }

  #loc(which: 'b' | 'r', p: Pos, extra: string[] = []): Location {
    return this.#side(which).docs.location({ file: p.node.ref.file, segs: [...p.node.ref.segs, ...p.path, ...extra] });
  }

  /** The target node of a `$ref` at `p`, if `p` is a schema with a `$ref`. */
  #refTarget(which: 'b' | 'r', p: Pos): SchemaNode | undefined {
    const v = this.#value(which, p);
    if (!isObject(v) || typeof v.$ref !== 'string') return undefined;
    const s = this.#side(which);
    const r = s.docs.resolveRef(p.node.ref.file, v.$ref);
    return 'error' in r ? undefined : s.index.get(r);
  }

  /** True if the schema at `p` has a `$ref` that can't be resolved. */
  #brokenRef(which: 'b' | 'r', p: Pos): boolean {
    const v = this.#value(which, p);
    return isObject(v) && typeof v.$ref === 'string' && !this.#refTarget(which, p);
  }

  /** True if the schema at `p` is only a `$ref` (plus annotations). */
  #pureRef(which: 'b' | 'r', p: Pos): SchemaNode | undefined {
    const v = this.#value(which, p);
    if (!isObject(v) || typeof v.$ref !== 'string') return undefined;
    if (this.#side(which).version !== '3.0' && Object.keys(v).some((k) => k !== '$ref' && !(k in DOCS) && !k.startsWith('x-') && !IGNORED.has(k) && k !== 'title')) return undefined;
    return this.#refTarget(which, p);
  }

  // --- Recording -----------------------------------------------------------

  /** Subject: the named schema the change is in, or the operation for inline schemas. */
  #subject(b: Pos | undefined, r: Pos | undefined): string {
    const p = r ?? b!;
    const which = r ? 'r' : 'b';
    if (p.node.named) return p.node.logical;
    return this.#inlineOwner.get(`${which}:${p.node.id}`) ?? p.node.logical;
  }

  #change(rule: string, dir: Direction | undefined, b: Pos | undefined, r: Pos | undefined, details: Record<string, unknown>, bKw: string[] = [], rKw: string[] = bKw): Change {
    const c: Change = { rule, subject: this.#subject(b, r), details: { ...details } };
    if (dir) c.direction = dir;
    const p = r ?? b!;
    c.details.path = '/' + [...p.path, ...(r ? rKw : bKw)].map((s) => s.replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
    if (c.details.path === '/') c.details.path = '';
    if (b) c.base = this.#loc('b', b, bKw);
    if (r) c.revision = this.#loc('r', r, rKw);
    return c;
  }

  #emit(rule: string, dir: Direction | undefined, b: Pos | undefined, r: Pos | undefined, details: Record<string, unknown> = {}, bKw: string[] = [], rKw: string[] = bKw): void {
    const c = this.#change(rule, dir, b, r, details, bKw, rKw);
    const key = [rule, dir ?? '', c.base?.file, c.base?.pointer, c.revision?.file, c.revision?.pointer, canon(details)].join('|');
    let raw = this.#raw.get(key);
    if (!raw) {
      raw = { change: c, pairs: new Set() };
      this.#raw.set(key, raw);
    }
    raw.pairs.add(this.#pair);
  }

  #unclassifiedAt(b: Pos, r: Pos, pointer: string): void {
    const key = `${b.node.id}|${r.node.id}`;
    let u = this.#unclassified.get(key);
    if (!u) {
      u = { b: { node: b.node, path: [] }, r: { node: r.node, path: [] }, pointers: new Set(), pairs: new Set() };
      this.#unclassified.set(key, u);
    }
    u.pointers.add(pointer);
    u.pairs.add(this.#pair);
  }

  // --- Walking -------------------------------------------------------------

  #walkPair(b: SchemaNode, r: SchemaNode, dir: Direction, parent: string): void {
    const key = `${b.id}|${r.id}|${dir}`;
    let ps = this.#parents.get(key);
    if (!ps) this.#parents.set(key, (ps = new Set()));
    ps.add(parent);
    if (this.#done.has(key)) return;
    this.#done.add(key); // before walking: a pair met again inside itself is assumed equal
    this.#visited.add(b.id);
    if (b.logical === r.logical && b.deep.full === r.deep.full) return;
    const saved = this.#pair;
    this.#pair = key;
    this.#compare({ node: b, path: [] }, { node: r, path: [] }, dir, 0);
    this.#pair = saved;
  }

  /** Compares two schema positions, following `$ref`s into pairs. */
  #compare(b: Pos, r: Pos, dir: Direction, depth: number): void {
    const bt = this.#pureRef('b', b);
    const rt = this.#pureRef('r', r);
    // A $ref that can't be resolved is already a ref-unresolved finding; compare what's left without calling it inlined.
    if ((!bt && this.#brokenRef('b', b)) || (!rt && this.#brokenRef('r', r))) {
      this.#schemas(bt ? { node: bt, path: [] } : b, rt ? { node: rt, path: [] } : r, dir, depth + 1);
      return;
    }
    if (bt && rt) {
      if (bt.logical !== rt.logical) this.#emit('ref-target-changed', undefined, b, r, { from: bt.logical, to: rt.logical });
      this.#walkPair(bt, rt, dir, this.#pair);
      return;
    }
    if (bt && !rt) {
      this.#emit('ref-inlined', undefined, b, r, { from: bt.logical });
      this.#schemas({ node: bt, path: [] }, r, dir, depth + 1);
      return;
    }
    if (!bt && rt) {
      this.#emit('ref-extracted', undefined, b, r, { to: rt.logical });
      this.#schemas(b, { node: rt, path: [] }, dir, depth + 1);
      return;
    }
    this.#schemas(b, r, dir, depth);
  }

  /** Effective schema: the schema at `p` with `allOf` members (and 3.1 `$ref` siblings) merged in. */
  #effective(which: 'b' | 'r', p: Pos): Eff {
    const eff: Eff = { at: p, kw: new Map(), properties: new Map(), required: new Map(), types: { set: undefined, at: undefined }, union: undefined };
    const seen = new Set<string>();
    const merge = (q: Pos, depth: number): void => {
      const id = `${q.node.id}|${q.path.join('/')}`;
      if (seen.has(id) || depth > 50) return; // allOf cycles are reported by the index
      seen.add(id);
      const v = this.#value(which, q);
      if (!isObject(v)) return;
      if (typeof v.$ref === 'string') {
        const t = this.#refTarget(which, q);
        if (t) merge({ node: t, path: [] }, depth + 1);
      }
      for (const k of Object.keys(v)) {
        const at = q;
        if (k === 'allOf' && Array.isArray(v.allOf)) {
          v.allOf.forEach((_, i) => merge({ node: q.node, path: [...q.path, 'allOf', String(i)] }, depth + 1));
          continue;
        }
        if (k === 'properties' && isObject(v.properties)) {
          for (const name of Object.keys(v.properties)) if (!eff.properties.has(name)) eff.properties.set(name, { node: q.node, path: [...q.path, 'properties', name] });
          continue;
        }
        if (k === 'required' && Array.isArray(v.required)) {
          for (const name of v.required) if (!eff.required.has(String(name))) eff.required.set(String(name), at);
          continue;
        }
        if (k === 'type') {
          const t = new Set(Array.isArray(v.type) ? v.type.map(String) : [String(v.type)]);
          eff.types.set = eff.types.set ? new Set([...eff.types.set].filter((x) => t.has(x) || (x === 'integer' && t.has('number')))) : t;
          eff.types.at ??= at;
          continue;
        }
        if ((k === 'oneOf' || k === 'anyOf') && Array.isArray(v[k])) {
          eff.union ??= { kind: k, branches: (v[k] as unknown[]).map((_, i) => ({ node: q.node, path: [...q.path, k, String(i)] })), at };
          continue;
        }
        const existing = eff.kw.get(k);
        if (!existing) {
          eff.kw.set(k, { value: v[k], at });
          continue;
        }
        // The same keyword in several allOf members: keep the tighter value.
        const tighter = tighten(k, existing.value, v[k]);
        if (tighter !== undefined && tighter === v[k]) eff.kw.set(k, { value: v[k], at });
        if (k === 'enum' && Array.isArray(existing.value) && Array.isArray(v[k])) {
          const keep = new Set((v[k] as unknown[]).map(canon));
          eff.kw.set(k, { value: existing.value.filter((x) => keep.has(canon(x))), at: existing.at });
        }
      }
    };
    merge(p, 0);
    return eff;
  }

  #schemas(b: Pos, r: Pos, dir: Direction, depth: number): void {
    const bv = this.#value('b', b);
    const rv = this.#value('r', r);
    if (typeof bv === 'boolean' || typeof rv === 'boolean' || !isObject(bv) || !isObject(rv)) {
      if (canon(bv) !== canon(rv)) this.#emit(bv === false || rv === true ? 'schema-widened' : 'schema-narrowed', dir, b, r, { from: bv, to: rv });
      return;
    }
    if (depth > MAX_DEPTH) {
      if (canon(localTrees(bv, this.#b.version).shape) !== canon(localTrees(rv, this.#r.version).shape)) this.#unclassifiedAt(b, r, '/' + r.path.join('/'));
      return;
    }
    const eb = this.#effective('b', b);
    const er = this.#effective('r', r);

    this.#types(eb, er, dir);
    this.#keywords(eb, er, dir);
    this.#enum(eb, er, dir);
    this.#limits(eb, er, dir);
    this.#properties(eb, er, dir, depth);
    this.#additional(eb, er, dir, depth);
    this.#items(eb, er, dir, depth);
    this.#union(eb, er, dir, depth);
    this.#discriminator(eb, er, dir);
    this.#docs(eb, er);
    this.#other(eb, er, dir, depth);
  }

  #types(eb: Eff, er: Eff, dir: Direction): void {
    const strip = (s: Set<string> | undefined): Set<string> | undefined => (s ? new Set([...s].filter((t) => t !== 'null')) : undefined);
    const bNull = !eb.types.set || eb.types.set.has('null');
    const rNull = !er.types.set || er.types.set.has('null');
    const bAt = eb.types.at ?? eb.at;
    const rAt = er.types.at ?? er.at;
    if (eb.types.set && er.types.set) {
      if (!bNull && rNull) this.#emit('nullable-added', dir, bAt, rAt, {}, ['type']);
      if (bNull && !rNull) this.#emit('nullable-removed', dir, bAt, rAt, {}, ['type']);
    }
    const bt = strip(eb.types.set);
    const rt = strip(er.types.set);
    const covers = (big: Set<string> | undefined, small: Set<string> | undefined): boolean => !big || (!!small && [...small].every((t) => big.has(t) || (t === 'integer' && big.has('number'))));
    const same = (!bt && !rt) || (bt && rt && bt.size === rt.size && [...bt].every((t) => rt.has(t)));
    if (same || (bt?.size === 0 && rt?.size === 0)) return;
    const details = { from: bt ? [...bt].sort() : 'any', to: rt ? [...rt].sort() : 'any' };
    if (covers(rt, bt)) this.#emit('type-widened', dir, bAt, rAt, details, ['type']);
    else if (covers(bt, rt)) this.#emit('type-narrowed', dir, bAt, rAt, details, ['type']);
    else this.#emit('type-changed', dir, bAt, rAt, details, ['type']);
  }

  #kwPair(eb: Eff, er: Eff, k: string): [Kw | undefined, Kw | undefined, Pos, Pos] {
    const bk = eb.kw.get(k);
    const rk = er.kw.get(k);
    return [bk, rk, bk?.at ?? eb.at, rk?.at ?? er.at];
  }

  #keywords(eb: Eff, er: Eff, dir: Direction): void {
    // format
    {
      const [bk, rk, bAt, rAt] = this.#kwPair(eb, er, 'format');
      if (!bk && rk) this.#emit('format-added', dir, bAt, rAt, { to: rk.value }, ['format']);
      else if (bk && !rk) this.#emit('format-removed', dir, bAt, rAt, { from: bk.value }, ['format']);
      else if (bk && rk && bk.value !== rk.value) {
        const widening = WIDENING[String(bk.value)] === rk.value;
        this.#emit('format-changed', dir, bAt, rAt, { from: bk.value, to: rk.value, ...(widening ? { widening: true } : {}) }, ['format']);
      }
    }
    for (const [k, rule] of [
      ['const', 'const-changed'],
      ['default', 'default-changed'],
      ['multipleOf', 'multiple-of-changed'],
    ] as const) {
      const [bk, rk, bAt, rAt] = this.#kwPair(eb, er, k);
      if ((bk || rk) && canon(bk?.value) !== canon(rk?.value)) this.#emit(rule, dir, bAt, rAt, { from: bk?.value ?? null, to: rk?.value ?? null }, [k]);
    }
    {
      const [bk, rk, bAt, rAt] = this.#kwPair(eb, er, 'uniqueItems');
      if (bk?.value !== true && rk?.value === true) this.#emit('unique-items-added', dir, bAt, rAt, {}, ['uniqueItems']);
      if (bk?.value === true && rk?.value !== true) this.#emit('unique-items-removed', dir, bAt, rAt, {}, ['uniqueItems']);
    }
    {
      const [bk, rk, bAt, rAt] = this.#kwPair(eb, er, 'pattern');
      if (!bk && rk) this.#emit('pattern-added', dir, bAt, rAt, { to: rk.value }, ['pattern']);
      else if (bk && !rk) this.#emit('pattern-removed', dir, bAt, rAt, { from: bk.value }, ['pattern']);
      else if (bk && rk && bk.value !== rk.value) this.#emit('pattern-changed', dir, bAt, rAt, { from: bk.value, to: rk.value }, ['pattern']);
    }
    {
      const [bk, rk, bAt, rAt] = this.#kwPair(eb, er, 'title');
      if (canon(bk?.value) !== canon(rk?.value)) this.#emit('schema-title-changed', undefined, bAt, rAt, { from: bk?.value ?? null, to: rk?.value ?? null }, ['title']);
    }
  }

  #enum(eb: Eff, er: Eff, dir: Direction): void {
    const [bk, rk, bAt, rAt] = this.#kwPair(eb, er, 'enum');
    if (!bk && !rk) return;
    if (!bk && rk) return this.#emit('enum-added', dir, bAt, rAt, { values: rk.value }, ['enum']);
    if (bk && !rk) return this.#emit('enum-removed', dir, bAt, rAt, { values: bk.value }, ['enum']);
    const bs = new Map((bk!.value as unknown[]).map((v) => [canon(v), v]));
    const rs = new Map((rk!.value as unknown[]).map((v) => [canon(v), v]));
    const added = [...rs].filter(([k]) => !bs.has(k)).map(([, v]) => v);
    const removed = [...bs].filter(([k]) => !rs.has(k)).map(([, v]) => v);
    if (added.length) this.#emit('enum-value-added', dir, bAt, rAt, { values: added }, ['enum']);
    if (removed.length) this.#emit('enum-value-removed', dir, bAt, rAt, { values: removed }, ['enum']);
  }

  #limits(eb: Eff, er: Eff, dir: Direction): void {
    for (const [k, kind, up, down] of LIMITS) {
      const [bk, rk, bAt, rAt] = this.#kwPair(eb, er, k);
      const none = kind === 'max' ? Infinity : 0;
      const bvl = typeof bk?.value === 'number' ? bk.value : none;
      const rvl = typeof rk?.value === 'number' ? rk.value : none;
      if (bvl === rvl) continue;
      this.#emit(rvl > bvl ? up : down, dir, bAt, rAt, { from: bk?.value ?? null, to: rk?.value ?? null }, [k]);
    }
    // Numeric bounds, with exclusive bounds (normalised to 3.1 numbers).
    for (const [kind, inc, exc, up, down] of [
      ['max', 'maximum', 'exclusiveMaximum', 'maximum-increased', 'maximum-decreased'],
      ['min', 'minimum', 'exclusiveMinimum', 'minimum-increased', 'minimum-decreased'],
    ] as const) {
      const bound = (e: Eff): { v: number; ex: boolean; kw: string; at: Pos } | undefined => {
        const i = e.kw.get(inc);
        const x = e.kw.get(exc);
        const iv = typeof i?.value === 'number' ? i.value : undefined;
        const xv = typeof x?.value === 'number' ? x.value : undefined;
        if (iv === undefined && xv === undefined) return undefined;
        if (xv !== undefined && (iv === undefined || (kind === 'max' ? xv <= iv : xv >= iv))) return { v: xv, ex: true, kw: exc, at: x!.at };
        return { v: iv!, ex: false, kw: inc, at: i!.at };
      };
      const bb = bound(eb);
      const rb = bound(er);
      if (!bb && !rb) continue;
      if (bb && rb && bb.v === rb.v && bb.ex === rb.ex) continue;
      // Tightness: lower max (or exclusive at the same value) is tighter; higher min likewise.
      const score = (b: typeof bb): number => (b ? (kind === 'max' ? b.v - (b.ex ? 1e-9 : 0) : b.v + (b.ex ? 1e-9 : 0)) : kind === 'max' ? Infinity : -Infinity);
      const rule = score(rb) > score(bb) ? up : down;
      this.#emit(rule, dir, bb?.at ?? eb.at, rb?.at ?? er.at, { from: bb ? (bb.ex ? `exclusive ${bb.v}` : bb.v) : null, to: rb ? (rb.ex ? `exclusive ${rb.v}` : rb.v) : null }, [bb?.kw ?? inc], [rb?.kw ?? inc]);
    }
  }

  #properties(eb: Eff, er: Eff, dir: Direction, depth: number): void {
    const flag = (which: 'b' | 'r', p: Pos, k: 'readOnly' | 'writeOnly'): boolean => {
      const v = this.#value(which, p);
      if (isObject(v) && v[k] === true) return true;
      const t = this.#refTarget(which, p);
      const tv = t ? this.#value(which, { node: t, path: [] }) : undefined;
      return isObject(tv) && tv[k] === true;
    };
    // readOnly properties aren't part of requests; writeOnly ones aren't part of responses.
    const hidden = (which: 'b' | 'r', p: Pos): boolean => flag(which, p, dir === 'in' ? 'readOnly' : 'writeOnly');
    const req = (e: Eff, name: string): boolean => e.required.has(name);

    for (const [name, bp] of eb.properties) {
      const rp = er.properties.get(name);
      const bHidden = hidden('b', bp);
      if (!rp) {
        if (!bHidden) this.#emit('property-removed', dir, bp, er.at, { name, closed: er.kw.get('additionalProperties')?.value === false });
        continue;
      }
      const rHidden = hidden('r', rp);
      if (!bHidden && rHidden) {
        this.#emit(dir === 'in' ? 'property-became-read-only' : 'property-became-write-only', dir, bp, rp, { name });
        continue;
      }
      if (bHidden && rHidden) continue;
      if (bHidden && !rHidden) {
        // Newly visible in this direction: like a new property.
        this.#emit(req(er, name) ? 'property-added-required' : 'property-added-optional', dir, eb.at, rp, { name });
        continue;
      }
      if (!req(eb, name) && req(er, name)) this.#emit('property-became-required', dir, bp, rp, { name });
      if (req(eb, name) && !req(er, name)) this.#emit('property-became-optional', dir, bp, rp, { name });
      this.#compare(bp, rp, dir, depth + 1);
    }
    for (const [name, rp] of er.properties) {
      if (eb.properties.has(name) || hidden('r', rp)) continue;
      this.#emit(req(er, name) ? 'property-added-required' : 'property-added-optional', dir, eb.at, rp, { name });
    }
    // Required changes for properties not declared in `properties`.
    for (const name of er.required.keys()) if (!eb.required.has(name) && !er.properties.has(name)) this.#emit('property-became-required', dir, eb.at, er.at, { name });
  }

  #additional(eb: Eff, er: Eff, dir: Direction, depth: number): void {
    const [bk, rk, bAt, rAt] = this.#kwPair(eb, er, 'additionalProperties');
    const state = (k: Kw | undefined): 'open' | 'closed' | 'schema' => (!k || k.value === true || (isObject(k.value) && Object.keys(k.value).length === 0) ? 'open' : k.value === false ? 'closed' : 'schema');
    const bs = state(bk);
    const rs = state(rk);
    if (bs === rs) {
      if (bs === 'schema') this.#compare({ node: bAt.node, path: [...bAt.path, 'additionalProperties'] }, { node: rAt.node, path: [...rAt.path, 'additionalProperties'] }, dir, depth + 1);
      return;
    }
    const order = { closed: 0, schema: 1, open: 2 };
    this.#emit(order[rs] < order[bs] ? 'additional-properties-restricted' : 'additional-properties-allowed', dir, bAt, rAt, { from: bs, to: rs }, ['additionalProperties']);
  }

  #items(eb: Eff, er: Eff, dir: Direction, depth: number): void {
    const [bk, rk, bAt, rAt] = this.#kwPair(eb, er, 'items');
    if (bk && rk && !Array.isArray(bk.value) && !Array.isArray(rk.value)) this.#compare({ node: bAt.node, path: [...bAt.path, 'items'] }, { node: rAt.node, path: [...rAt.path, 'items'] }, dir, depth + 1);
    else if (!bk !== !rk) this.#emit(!rk ? 'schema-widened' : 'schema-narrowed', dir, bAt, rAt, { keyword: 'items' }, ['items']);
    const [bp, rp, bpAt, rpAt] = this.#kwPair(eb, er, 'prefixItems');
    if (bp && rp && Array.isArray(bp.value) && Array.isArray(rp.value)) {
      const n = Math.min(bp.value.length, rp.value.length);
      for (let i = 0; i < n; i++) this.#compare({ node: bpAt.node, path: [...bpAt.path, 'prefixItems', String(i)] }, { node: rpAt.node, path: [...rpAt.path, 'prefixItems', String(i)] }, dir, depth + 1);
      if (bp.value.length !== rp.value.length) this.#unclassifiedAt(eb.at, er.at, `/${[...rpAt.path, 'prefixItems'].join('/')}`);
    } else if (!bp !== !rp) this.#unclassifiedAt(eb.at, er.at, `/${[...er.at.path, 'prefixItems'].join('/')}`);
  }

  #union(eb: Eff, er: Eff, dir: Direction, depth: number): void {
    const bu = eb.union;
    const ru = er.union;
    if (!bu && !ru) return;
    if (!bu || !ru) {
      // A union appeared or disappeared: the schema now accepts fewer or more values.
      this.#emit(ru ? 'schema-narrowed' : 'schema-widened', dir, bu?.at ?? eb.at, ru?.at ?? er.at, { keyword: (ru ?? bu)!.kind });
      return;
    }
    if (bu.kind !== ru.kind) this.#emit('union-kind-changed', dir, bu.at, ru.at, { from: bu.kind, to: ru.kind }, [bu.kind], [ru.kind]);
    // Match branches: same $ref target, then identical inline content, then the only ones left.
    const key = (which: 'b' | 'r', p: Pos): string => {
      const t = this.#pureRef(which, p);
      return t ? `ref:${t.logical}` : `inline:${canon(localTrees(this.#value(which, p), this.#side(which).version).shape)}`;
    };
    const left = new Map(ru.branches.map((p) => [p, key('r', p)]));
    const unmatchedB: Pos[] = [];
    for (const bp of bu.branches) {
      const k = key('b', bp);
      const m = [...left].find(([, rk]) => rk === k)?.[0];
      if (m) {
        left.delete(m);
        this.#compare(bp, m, dir, depth + 1);
      } else unmatchedB.push(bp);
    }
    // Inline branches changed in place: pair them in order.
    const unmatchedR = [...left.keys()];
    while (unmatchedB.length && unmatchedR.length && !this.#pureRef('b', unmatchedB[0]!) && !this.#pureRef('r', unmatchedR[0]!)) this.#compare(unmatchedB.shift()!, unmatchedR.shift()!, dir, depth + 1);
    for (const bp of unmatchedB) this.#emit('union-branch-removed', dir, bp, ru.at, { branch: this.#pureRef('b', bp)?.logical ?? bp.path[bp.path.length - 1] }, [], [ru.kind]);
    for (const rp of unmatchedR) this.#emit('union-branch-added', dir, bu.at, rp, { branch: this.#pureRef('r', rp)?.logical ?? rp.path[rp.path.length - 1] }, [bu.kind]);
  }

  #discriminator(eb: Eff, er: Eff, dir: Direction): void {
    const [bk, rk, bAt, rAt] = this.#kwPair(eb, er, 'discriminator');
    if (!isObject(bk?.value) || !isObject(rk?.value)) {
      if (!bk !== !rk) this.#unclassifiedAt(eb.at, er.at, `/${[...(rk?.at ?? er.at).path, 'discriminator'].join('/')}`);
      return;
    }
    const bd = bk!.value as Record<string, unknown>;
    const rd = rk!.value as Record<string, unknown>;
    if (bd.propertyName !== rd.propertyName) this.#emit('discriminator-property-changed', dir, bAt, rAt, { from: bd.propertyName, to: rd.propertyName }, ['discriminator', 'propertyName']);
    const target = (which: 'b' | 'r', at: Pos, ref: unknown): string => {
      if (typeof ref !== 'string') return String(ref);
      const s = this.#side(which);
      const r = s.docs.resolveRef(at.node.ref.file, ref.includes('#') || ref.includes('/') ? ref : `#/components/schemas/${ref}`);
      return 'error' in r ? ref : (s.index.get(r)?.logical ?? ref);
    };
    const bm = isObject(bd.mapping) ? bd.mapping : {};
    const rm = isObject(rd.mapping) ? rd.mapping : {};
    for (const v of Object.keys(bm)) {
      if (!(v in rm)) this.#emit('discriminator-mapping-removed', dir, bAt, rAt, { value: v }, ['discriminator', 'mapping', v], ['discriminator', 'mapping']);
      else if (target('b', bAt, bm[v]) !== target('r', rAt, rm[v])) this.#emit('discriminator-mapping-changed', dir, bAt, rAt, { value: v, from: target('b', bAt, bm[v]), to: target('r', rAt, rm[v]) }, ['discriminator', 'mapping', v]);
    }
    for (const v of Object.keys(rm)) if (!(v in bm)) this.#emit('discriminator-mapping-added', dir, bAt, rAt, { value: v }, ['discriminator', 'mapping'], ['discriminator', 'mapping', v]);
  }

  #docs(eb: Eff, er: Eff): void {
    // Only the schema's own annotations (not merged ones), so each is reported where it is.
    const bv = this.#value('b', eb.at);
    const rv = this.#value('r', er.at);
    if (!isObject(bv) || !isObject(rv)) return;
    const keys = new Set([...Object.keys(bv), ...Object.keys(rv)]);
    for (const k of keys) {
      if (k === 'deprecated') {
        const [bd, rd] = [bv.deprecated === true, rv.deprecated === true];
        if (bd !== rd) this.#emit(rd ? 'deprecated-added' : 'deprecated-removed', undefined, eb.at, er.at, { what: 'schema' }, [k]);
        continue;
      }
      const rule = DOCS[k] ?? (k.startsWith('x-') && k !== 'x-api-diff' ? 'extension-changed' : undefined); // x-api-diff configures this tool
      if (!rule || canon(bv[k]) === canon(rv[k])) continue;
      this.#emit(rule, undefined, eb.at, er.at, { keyword: k }, [k]);
    }
  }

  #other(eb: Eff, er: Eff, dir: Direction, depth: number): void {
    const keys = new Set([...eb.kw.keys(), ...er.kw.keys()]);
    for (const k of keys) {
      if (HANDLED.has(k) || k in DOCS || IGNORED.has(k) || k.startsWith('x-')) continue;
      const [bk, rk] = this.#kwPair(eb, er, k);
      if (canon(bk?.value) !== canon(rk?.value)) this.#unclassifiedAt(eb.at, er.at, `/${[...(rk?.at ?? er.at).path, k].join('/')}`);
    }
    // Keywords with a known direction of effect.
    for (const k of ['not', 'propertyNames'] as const) {
      const [bk, rk, bAt, rAt] = this.#kwPair(eb, er, k);
      if (!bk && rk) this.#emit('schema-narrowed', dir, bAt, rAt, { keyword: k }, [k]);
      else if (bk && !rk) this.#emit('schema-widened', dir, bAt, rAt, { keyword: k }, [k]);
      else if (bk && rk && canon(bk.value) !== canon(rk.value)) this.#emit('schema-incompatible', dir, bAt, rAt, { keyword: k }, [k]);
    }
    {
      const [bk, rk, bAt, rAt] = this.#kwPair(eb, er, 'dependentRequired');
      const b = isObject(bk?.value) ? bk.value : {};
      const r = isObject(rk?.value) ? rk.value : {};
      const pairs = (o: Record<string, unknown>) => new Set(Object.entries(o).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => `${k}→${x}`) : [])));
      const bp = pairs(b);
      const rp = pairs(r);
      const added = [...rp].some((x) => !bp.has(x));
      const removed = [...bp].some((x) => !rp.has(x));
      if (added || removed) this.#emit(added && removed ? 'schema-incompatible' : added ? 'schema-narrowed' : 'schema-widened', dir, bAt, rAt, { keyword: 'dependentRequired' }, ['dependentRequired']);
    }
    for (const [k, kind] of [['minContains', 'min'], ['maxContains', 'max']] as const) {
      const [bk, rk, bAt, rAt] = this.#kwPair(eb, er, k);
      const none = kind === 'max' ? Infinity : 1;
      const b = typeof bk?.value === 'number' ? bk.value : none;
      const r = typeof rk?.value === 'number' ? rk.value : none;
      if (b !== r) this.#emit((kind === 'max') === r < b ? 'schema-narrowed' : 'schema-widened', dir, bAt, rAt, { keyword: k, from: bk?.value ?? null, to: rk?.value ?? null }, [k]);
    }
    for (const k of ['contentMediaType', 'contentEncoding'] as const) {
      const [bk, rk, bAt, rAt] = this.#kwPair(eb, er, k);
      if (canon(bk?.value) !== canon(rk?.value)) this.#emit('schema-incompatible', dir, bAt, rAt, { keyword: k, from: bk?.value ?? null, to: rk?.value ?? null }, [k]);
    }
    void depth;
  }

  // --- Components ------------------------------------------------------------

  /** Component schemas no operation uses: added, removed or changed. */
  #components(): Change[] {
    const out: Change[] = [];
    const used = (s: Side): Set<string> => {
      const seen = new Set<string>();
      const todo: number[] = [];
      for (const op of s.model.operations.values()) for (const u of op.schemas.values()) {
        const n = s.index.get(u.at);
        if (n && !seen.has(n.id)) seen.add(n.id), todo.push(n.i);
      }
      while (todo.length) for (const e of s.index.nodes[todo.pop()!]!.edges) {
        const t = s.index.nodes[e.to]!;
        if (!seen.has(t.id)) seen.add(t.id), todo.push(t.i);
      }
      return seen;
    };
    const bUsed = used(this.#b);
    const rUsed = used(this.#r);
    const isComponent = (n: SchemaNode): boolean => n.logical.startsWith('#/components/schemas/') && n.logical.split('/').length === 4;
    for (const b of this.#b.index.nodes) {
      if (!b.named || !isComponent(b)) continue;
      const r = this.#r.index.byLogical.get(b.logical);
      if (!r) {
        if (!bUsed.has(b.id)) out.push(this.#change('component-removed', undefined, { node: b, path: [] }, undefined, {}));
        continue;
      }
      if (!bUsed.has(b.id) && !rUsed.has(r.id) && b.deep.shape !== r.deep.shape) {
        const changed = this.#treeDiff(b, r);
        out.push(this.#change('component-unused', undefined, { node: b, path: [] }, { node: r, path: [] }, { changed }));
      }
    }
    for (const r of this.#r.index.nodes) {
      if (!r.named || !isComponent(r) || this.#b.index.byLogical.has(r.logical) || rUsed.has(r.id)) continue;
      out.push(this.#change('component-added', undefined, undefined, { node: r, path: [] }, {}));
    }
    return out;
  }

  #treeDiff(b: SchemaNode, r: SchemaNode): string[] {
    const tb = this.#b.index.tree(b, 'shape');
    const tr = this.#r.index.tree(r, 'shape');
    return diffPointers(tb, tr);
  }
}

const WIDENING: Record<string, string> = { int32: 'int64', float: 'double' };

/** For a keyword present in two allOf members: the tighter value, if it can be decided. */
function tighten(k: string, a: unknown, b: unknown): unknown {
  if (typeof a !== 'number' || typeof b !== 'number') return undefined;
  if (k.startsWith('max') || k === 'maximum' || k === 'exclusiveMaximum') return Math.min(a, b);
  if (k.startsWith('min') || k === 'minimum' || k === 'exclusiveMinimum') return Math.max(a, b);
  return undefined;
}

function diffPointers(a: unknown, b: unknown): string[] {
  const out: string[] = [];
  const stack: [unknown, unknown, string][] = [[a, b, '']];
  while (stack.length && out.length < 20) {
    const [x, y, p] = stack.pop()!;
    if (isObject(x) && isObject(y)) {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) stack.push([x[k], y[k], `${p}/${k}`]);
    } else if (canon(x) !== canon(y)) out.push(p || '/');
  }
  return out.sort();
}

export function diffSchemaEngine(base: Model, rev: Model, pairs: [Operation, Operation][]): Change[] {
  return new SchemaEngine(base, rev).run(pairs);
}

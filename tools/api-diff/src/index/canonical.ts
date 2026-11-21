// Builds the normalised "local" tree of a schema node, hashes it, and diffs
// two trees. Local means `$ref`s are replaced by the target's logical name;
// they are not followed. Everything is iterative, so schema depth is only
// limited by memory.

import { createHash } from 'node:crypto';
import { isObject } from '../load/documents.ts';
import { normalizeSchemaKeywords, type OasVersion } from '../normalize/normalize.ts';

export type Mode = 'shape' | 'full';

/** Keywords whose value is a map of name → schema. */
const SCHEMA_MAP = new Set(['properties', 'patternProperties', 'dependentSchemas']);
/** Keywords whose value is one schema (or, for `items`, an array of schemas in older drafts). */
const SCHEMA_ONE = new Set(['additionalProperties', 'items', 'additionalItems', 'contains', 'propertyNames', 'unevaluatedProperties', 'unevaluatedItems', 'not', 'if', 'then', 'else', 'contentSchema']);
/** Keywords whose value is an array of schemas. */
const SCHEMA_ARRAY = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
/** Containers of definitions: not part of the schema's own constraints. Referenced definitions become their own nodes. */
const DEFINITIONS = new Set(['$defs', 'definitions']);
/** Annotations: in the full hash only. `x-` extensions too. */
const ANNOTATIONS = new Set(['description', 'example', 'examples', 'externalDocs', '$comment', 'deprecated', '$id', '$schema', '$anchor', '$dynamicAnchor']);
/** Keywords that make a cycle productive: data nests through them. */
export const PRODUCTIVE = new Set(['properties', 'patternProperties', 'additionalProperties', 'items', 'prefixItems', 'additionalItems', 'contains', 'unevaluatedProperties', 'unevaluatedItems', 'dependentSchemas']);

export interface RefFound {
  ref: string;
  /** Path of the `$ref`'s schema inside the node. */
  path: string[];
  productive: boolean;
}

export interface LocalTree {
  tree: unknown;
  refs: RefFound[];
}

/** Both trees from one walk, with each `$ref` slot so names can be filled in later. */
export interface LocalTrees {
  shape: unknown;
  full: unknown;
  refs: (RefFound & { slots: Record<string, unknown>[] })[];
}

type Kind = 'schema' | 'map' | 'array';

/** Paths are only needed for `$ref`s, so they're kept as parent links and built on demand. */
interface PathLink {
  parent: PathLink | null;
  key: string;
}

const pathOf = (p: PathLink | null): string[] => {
  const out: string[] = [];
  for (let x = p; x; x = x.parent) out.push(x.key);
  return out.reverse();
};

interface Task {
  src: unknown;
  kind: Kind;
  path: PathLink | null;
  productive: boolean;
  /** Where to put the result in each tree (undefined: this subtree is not in the shape tree). */
  s: { obj: Record<string, unknown> | unknown[]; key: string | number } | undefined;
  f: { obj: Record<string, unknown> | unknown[]; key: string | number };
}

const put = (slot: { obj: Record<string, unknown> | unknown[]; key: string | number } | undefined, v: unknown): void => {
  if (slot) (slot.obj as Record<string | number, unknown>)[slot.key] = v;
};

/**
 * Normalised shape and full trees of one schema node, in one walk. `$ref`
 * values are left as written; `refs[i].slots` are the objects holding them,
 * so callers can replace them with logical names.
 */
export function localTrees(root: unknown, version: OasVersion): LocalTrees {
  const refs: LocalTrees['refs'] = [];
  const sBox: Record<string, unknown> = {};
  const fBox: Record<string, unknown> = {};
  const tasks: Task[] = [{ src: root, kind: 'schema', path: null, productive: false, s: { obj: sBox, key: 'v' }, f: { obj: fBox, key: 'v' } }];
  while (tasks.length) {
    const t = tasks.pop()!;
    const { src, kind } = t;
    if (src === null || typeof src !== 'object') {
      put(t.s, src);
      put(t.f, src);
      continue;
    }
    if (kind === 'array' && Array.isArray(src)) {
      const sa: unknown[] = new Array(src.length);
      const fa: unknown[] = new Array(src.length);
      put(t.s, sa);
      put(t.f, fa);
      for (let i = 0; i < src.length; i++) tasks.push({ src: src[i], kind: 'schema', path: { parent: t.path, key: String(i) }, productive: t.productive, s: t.s && { obj: sa, key: i }, f: { obj: fa, key: i } });
      continue;
    }
    if (kind === 'map') {
      if (!isObject(src)) {
        put(t.s, src);
        put(t.f, src);
        continue;
      }
      const so: Record<string, unknown> = {};
      const fo: Record<string, unknown> = {};
      put(t.s, so);
      put(t.f, fo);
      for (const k of Object.keys(src).sort()) {
        // Assign in sorted order now, fill in later: trees end up with sorted keys.
        so[k] = fo[k] = null;
        tasks.push({ src: src[k], kind: 'schema', path: { parent: t.path, key: k }, productive: t.productive, s: t.s && { obj: so, key: k }, f: { obj: fo, key: k } });
      }
      continue;
    }
    if (!isObject(src)) {
      put(t.s, src);
      put(t.f, src);
      continue;
    }
    const sch = normalizeSchemaKeywords(src, version);
    const so: Record<string, unknown> = {};
    const fo: Record<string, unknown> = {};
    put(t.s, so);
    put(t.f, fo);
    for (const k of Object.keys(sch).sort()) {
      if (DEFINITIONS.has(k)) continue;
      const v = sch[k];
      const inShape = !!t.s && !ANNOTATIONS.has(k) && !k.startsWith('x-');
      // Assign in sorted order now, fill in later: trees end up with sorted keys.
      if (inShape) so[k] = null;
      fo[k] = null;
      if (k === '$ref' && typeof v === 'string') {
        const slots = [fo];
        if (inShape) slots.push(so);
        for (const o of slots) o.$ref = v;
        refs.push({ ref: v, path: pathOf(t.path), productive: t.productive, slots });
        continue;
      }
      const productive = t.productive || PRODUCTIVE.has(k);
      const sSlot = inShape ? { obj: so, key: k } : undefined;
      const fSlot = { obj: fo, key: k };
      const path = { parent: t.path, key: k };
      if (SCHEMA_MAP.has(k)) tasks.push({ src: v, kind: 'map', path, productive, s: sSlot, f: fSlot });
      else if (SCHEMA_ARRAY.has(k)) tasks.push({ src: v, kind: 'array', path, productive, s: sSlot, f: fSlot });
      else if (SCHEMA_ONE.has(k)) tasks.push({ src: v, kind: Array.isArray(v) ? 'array' : 'schema', path, productive, s: sSlot, f: fSlot });
      else if ((k === 'required' || k === 'enum') && Array.isArray(v)) {
        const keyed = v.map((x) => [stableStringify(x), sortedData(x)] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
        const sorted = keyed.map((x) => x[1]);
        put(sSlot, sorted);
        put(fSlot, sorted);
      } else {
        // Data: enum, const, default, type, format, limits, discriminator, annotations, …
        const data = sortedData(v);
        put(sSlot, data);
        put(fSlot, data);
      }
    }
  }
  return { shape: sBox.v, full: fBox.v, refs };
}

/**
 * One normalised tree, with each `$ref` replaced by `nameOf(ref)` (or kept
 * as written when it returns undefined).
 */
export function localTree(root: unknown, version: OasVersion, mode: Mode, nameOf: (ref: string, path: string[]) => string | undefined): LocalTree {
  const t = localTrees(root, version);
  for (const r of t.refs) {
    const name = nameOf(r.ref, r.path);
    if (name !== undefined) for (const o of r.slots) o.$ref = name;
  }
  return { tree: mode === 'shape' ? t.shape : t.full, refs: t.refs.map(({ ref, path, productive }) => ({ ref, path, productive })) };
}

/** A copy of a data value with object keys sorted (data values are small, so recursion is fine). */
function sortedData(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sortedData);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v).sort()) out[k] = sortedData((v as Record<string, unknown>)[k]);
  return out;
}

/** Canonical string of a tree from `localTrees` (keys are already sorted). */
export function canonicalString(tree: unknown): string {
  try {
    return JSON.stringify(tree) ?? 'null';
  } catch (e) {
    if (e instanceof RangeError) return stableStringify(tree);
    throw e;
  }
}

/** JSON with object keys sorted, built iteratively. */
export function stableStringify(v: unknown): string {
  const parts: string[] = [];
  const stack: unknown[] = [v];
  const CLOSE_OBJ = Symbol('}');
  const CLOSE_ARR = Symbol(']');
  const COMMA = Symbol(',');
  while (stack.length) {
    const x = stack.pop();
    if (x === CLOSE_OBJ) parts.push('}');
    else if (x === CLOSE_ARR) parts.push(']');
    else if (x === COMMA) parts.push(',');
    else if (typeof x === 'symbol') parts.push(x.description!);
    else if (Array.isArray(x)) {
      parts.push('[');
      stack.push(CLOSE_ARR);
      for (let i = x.length - 1; i >= 0; i--) {
        stack.push(x[i] === undefined ? null : x[i]);
        if (i > 0) stack.push(COMMA);
      }
    } else if (x !== null && typeof x === 'object') {
      const keys = Object.keys(x).sort();
      parts.push('{');
      stack.push(CLOSE_OBJ);
      for (let i = keys.length - 1; i >= 0; i--) {
        stack.push((x as Record<string, unknown>)[keys[i]!]);
        stack.push(Symbol(`${JSON.stringify(keys[i])}:`));
        if (i > 0) stack.push(COMMA);
      }
    } else parts.push(x === undefined ? 'null' : JSON.stringify(x));
  }
  return parts.join('');
}

export function hash(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

/** JSON Pointers (relative to the roots) where two trees differ, up to `limit`. */
export function changedPointers(a: unknown, b: unknown, limit = 20): string[] {
  const out: string[] = [];
  const stack: { a: unknown; b: unknown; path: string[] }[] = [{ a, b, path: [] }];
  const enc = (p: string[]): string => p.map((s) => '/' + s.replace(/~/g, '~0').replace(/\//g, '~1')).join('') || '/';
  while (stack.length && out.length < limit) {
    const { a: x, b: y, path } = stack.pop()!;
    const xo = x !== null && typeof x === 'object';
    const yo = y !== null && typeof y === 'object';
    if (!xo || !yo || Array.isArray(x) !== Array.isArray(y)) {
      if (stableStringify(x) !== stableStringify(y)) out.push(enc(path));
      continue;
    }
    if (Array.isArray(x) && Array.isArray(y)) {
      if (stableStringify(x) === stableStringify(y)) continue;
      const allScalar = [...x, ...y].every((v) => v === null || typeof v !== 'object');
      if (allScalar || x.length !== y.length) {
        out.push(enc(path));
        continue;
      }
      for (let i = x.length - 1; i >= 0; i--) stack.push({ a: x[i], b: y[i], path: [...path, String(i)] });
      continue;
    }
    const xr = x as Record<string, unknown>;
    const yr = y as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(xr), ...Object.keys(yr)])].sort().reverse();
    for (const k of keys) stack.push({ a: xr[k], b: yr[k], path: [...path, k] });
  }
  return out.sort();
}

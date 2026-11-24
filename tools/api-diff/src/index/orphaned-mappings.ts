// The `discriminator-mapping-orphaned` check: a `discriminator.mapping` value
// beside a `oneOf`/`anyOf` that points at a schema that isn't one of its
// branches, or at a schema that doesn't exist. A payload with that value can
// never be valid. Run on the revision only (decision record
// 2026-11-24T0217-orphaned-discriminator-mapping-values).

import { encodePointer, isObject, type DocumentSet, type Ref } from '../load/documents.ts';
import type { Change } from '../types.ts';
import type { SchemaIndex } from './schema-index.ts';

/** Keys whose values are data, not schemas, so they are not searched. */
const DATA = new Set(['example', 'examples', 'default', 'const', 'enum']);
const UNIONS = ['oneOf', 'anyOf'] as const;

const key = (r: Ref): string => `${r.file.path}#${encodePointer(r.segs)}`;

/** The ids along a `$ref` chain starting at `r` (r itself included), or undefined if it breaks or loops. */
function chain(docs: DocumentSet, r: Ref): { ids: string[]; value: unknown } | undefined {
  const ids: string[] = [];
  let cur = r;
  for (;;) {
    if (ids.includes(key(cur))) return undefined;
    ids.push(key(cur));
    const v = docs.value(cur);
    if (!isObject(v) || typeof v.$ref !== 'string') return { ids, value: v };
    const next = docs.resolveRef(cur.file, v.$ref);
    if ('error' in next) return undefined;
    cur = next;
  }
}

export function orphanedMappings(docs: DocumentSet, index: SchemaIndex, side: 'base' | 'revision'): Change[] {
  const out: Change[] = [];
  const seen = new Set<string>();

  const check = (at: Ref, v: Record<string, unknown>, subject: string): void => {
    const d = v.discriminator;
    if (!isObject(d) || !isObject(d.mapping)) return;
    const unions = UNIONS.filter((k) => Array.isArray(v[k]));
    if (!unions.length) return; // A parent schema extended with allOf: its targets aren't branches.
    const branches = new Set<string>();
    for (const k of unions) {
      for (const [i, b] of (v[k] as unknown[]).entries()) {
        if (!isObject(b)) return;
        if (UNIONS.some((u) => u in b)) return; // A nested union may contain the target.
        if (typeof b.$ref !== 'string') continue; // An inline branch can't be a mapping target.
        const c = chain(docs, { file: at.file, segs: [...at.segs, k, String(i)] });
        if (!c) return; // Reported as ref-unresolved.
        if (isObject(c.value) && UNIONS.some((u) => u in (c.value as object))) return;
        for (const id of c.ids) branches.add(id);
      }
    }
    for (const [value, ref] of Object.entries(d.mapping)) {
      if (typeof ref !== 'string') continue;
      const spelled = ref.includes('#') || ref.includes('/') ? ref : `#/components/schemas/${ref}`;
      const loc = docs.location({ file: at.file, segs: [...at.segs, 'discriminator', 'mapping', value] });
      const t = docs.resolveRef(at.file, spelled);
      let reason: 'missing' | 'not-a-branch' | undefined;
      if ('error' in t) reason = /external URLs/.test(t.error) ? undefined : 'missing';
      else {
        const c = chain(docs, t);
        if (c && !c.ids.some((id) => branches.has(id))) reason = 'not-a-branch';
      }
      if (reason) out.push({ rule: 'discriminator-mapping-orphaned', subject, [side]: loc, details: { value, target: ref, reason, union: unions.join('/'), side } });
    }
  };

  const walk = (at: Ref, v: unknown, subject: string): void => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk({ file: at.file, segs: [...at.segs, String(i)] }, x, subject));
    if (!isObject(v)) return;
    const k = key(at);
    if (seen.has(k)) return;
    seen.add(k);
    check(at, v, subject);
    for (const [name, child] of Object.entries(v)) {
      if (DATA.has(name) || name.startsWith('x-') || name === 'discriminator') continue;
      walk({ file: at.file, segs: [...at.segs, name] }, child, subject);
    }
  };

  // Inline schemas used by an operation have no name of their own; the location points at them.
  for (const n of index.nodes) walk(n.ref, docs.value(n.ref), n.named ? n.logical : `${side} document`);
  return out;
}

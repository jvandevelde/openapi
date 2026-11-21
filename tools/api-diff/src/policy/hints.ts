// In-spec hints (POLICY.md section 12): the `x-api-diff` extension on a
// schema, operation, path item or the document.
//
//   x-api-diff: { enum: open }                 adding enum values is info
//   x-api-diff: { ignore: true }               this node is not compared
//   x-api-diff: { rules: { <rule-id>: <sev> } } severities for this node and everything under it
//
// Hints are indexed per side by file and JSON Pointer. A finding looks up
// hints on the nodes that contain its location, nearest first.

import { encodePointer, isObject, type DocumentSet } from '../load/documents.ts';
import type { Change, Location, Side } from '../types.ts';
import { PolicyError } from './errors.ts';
import type { RuleSetting } from './policy.ts';

export const HINT = 'x-api-diff';

export interface Hint {
  file: string;
  pointer: string;
  /** Pointer of the hint's file root: hints at the document root apply last. */
  atRoot: boolean;
  ignore: boolean;
  enumOpen: boolean;
  rules: Map<string, RuleSetting> | undefined;
}

type ParseRules = (v: unknown, where: string) => Map<string, RuleSetting>;

const KEYS = ['enum', 'ignore', 'rules'];

export class HintIndex {
  readonly #byKey = new Map<string, Hint>();
  /** Invalid hints, as spec-invalid changes. */
  readonly problems: Change[] = [];
  readonly ignored: Hint[] = [];
  #docs: DocumentSet | undefined;

  static build(docs: DocumentSet, side: Side, parseRules: ParseRules): HintIndex {
    const idx = new HintIndex();
    idx.#docs = docs;
    for (const file of docs.files.values()) {
      const isRoot = file === docs.root;
      // Iterative walk: specs can be deeply nested.
      const stack: [unknown, string[]][] = [[file.parsed.value, []]];
      while (stack.length) {
        const [v, segs] = stack.pop()!;
        if (Array.isArray(v)) {
          for (let i = v.length - 1; i >= 0; i--) stack.push([v[i], [...segs, String(i)]]);
          continue;
        }
        if (!isObject(v)) continue;
        if (HINT in v) {
          const pointer = encodePointer(segs);
          try {
            const hint = parseHint(v[HINT], `${file.display}#${pointer}/${HINT}`, parseRules);
            const h: Hint = { file: file.display, pointer, atRoot: isRoot && segs.length === 0, ...hint };
            idx.#byKey.set(`${file.display}#${pointer}`, h);
            if (h.ignore) idx.ignored.push(h);
          } catch (e) {
            if (!(e instanceof PolicyError)) throw e;
            idx.problems.push({ rule: 'spec-invalid', subject: side === 'base' ? 'base document' : 'revision document', [side]: docs.location({ file, segs: [...segs, HINT] }), details: { reason: e.message, side } });
          }
        }
        for (const [k, child] of Object.entries(v)) if (k !== HINT && typeof child === 'object' && child !== null) stack.push([child, [...segs, k]]);
      }
    }
    return idx;
  }

  /** The hint at the root document's top level, if any. */
  get root(): Hint | undefined {
    for (const h of this.#byKey.values()) if (h.atRoot) return h;
    return undefined;
  }

  get size(): number {
    return this.#byKey.size;
  }

  /** The hint on exactly this node, if any. */
  at(loc: Pick<Location, 'file' | 'pointer'>): Hint | undefined {
    return this.#byKey.get(`${loc.file}#${loc.pointer}`);
  }

  /** Hints on the nodes containing `loc` (including itself), nearest first. */
  around(loc: Pick<Location, 'file' | 'pointer'>): Hint[] {
    const out: Hint[] = [];
    let p = loc.pointer;
    for (;;) {
      const h = this.#byKey.get(`${loc.file}#${p}`);
      if (h) out.push(h);
      if (p === '') break;
      p = p.slice(0, p.lastIndexOf('/'));
    }
    return out;
  }

  /** The value of the node at `loc` (by display name and pointer), if loaded. */
  node(loc: Pick<Location, 'file' | 'pointer'>): unknown {
    if (!this.#docs) return undefined;
    for (const f of this.#docs.files.values()) {
      if (f.display !== loc.file) continue;
      const segs = loc.pointer === '' ? [] : loc.pointer.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
      return this.#docs.value({ file: f, segs });
    }
    return undefined;
  }

  /** True if `loc` is inside a node marked `ignore: true`. */
  isIgnored(loc: Pick<Location, 'file' | 'pointer'> | undefined): boolean {
    return !!loc && this.around(loc).some((h) => h.ignore);
  }
}

function parseHint(v: unknown, where: string, parseRules: ParseRules): Omit<Hint, 'file' | 'pointer' | 'atRoot'> {
  if (!isObject(v)) throw new PolicyError(`${where}: must be a mapping with enum, ignore or rules`);
  const out: Omit<Hint, 'file' | 'pointer' | 'atRoot'> = { ignore: false, enumOpen: false, rules: undefined };
  for (const [k, val] of Object.entries(v)) {
    if (!KEYS.includes(k)) throw new PolicyError(`${where}.${k}: unknown key (x-api-diff takes enum, ignore and rules)`);
    if (k === 'enum') {
      if (val !== 'open') throw new PolicyError(`${where}.enum: must be open`);
      out.enumOpen = true;
    } else if (k === 'ignore') {
      if (typeof val !== 'boolean') throw new PolicyError(`${where}.ignore: must be true or false`);
      out.ignore = val;
    } else out.rules = parseRules(val, `${where}.rules`);
  }
  return out;
}

/** `/components/schemas/Pet/properties/name/enum` → `/components/schemas/Pet/properties/name`. */
export function parentPointer(pointer: string): string {
  return pointer.slice(0, pointer.lastIndexOf('/'));
}

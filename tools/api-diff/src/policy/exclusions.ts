// Exclusion sets (POLICY.md section 8): named sets of operations and
// components, by path, extension, tag, operationId or component name.
// Nothing is excluded unless the policy says so.
//
// - Sets listed in `ignore` are not compared at all (one not-compared notice
//   per set).
// - Every other finding records the sets it belongs to (`exclusions`), so
//   reports can leave them out (`exclude`, section 10).

import { componentName, type OperationInfo, type SpecContext } from './context.ts';
import { PolicyError } from './errors.ts';
import { glob } from './overrides.ts';

export interface ExclusionSet {
  name: string;
  paths: RegExp[];
  /** Extension name → accepted values; `undefined` means any value except false/null. */
  extensions: Map<string, unknown[] | undefined>;
  tags: string[];
  operationIds: RegExp[];
  components: RegExp[];
}

const KEYS = ['paths', 'extensions', 'tags', 'operationIds', 'components'] as const;

function strings(v: unknown, where: string): string[] {
  if (!Array.isArray(v) || !v.every((s) => typeof s === 'string' && s !== '')) throw new PolicyError(`${where}: must be a list of text`);
  return v as string[];
}

export function parseExclusions(raw: Record<string, unknown>, where: string, suggest: (w: string, c: readonly string[]) => string): Map<string, ExclusionSet> {
  const out = new Map<string, ExclusionSet>();
  for (const [name, v] of Object.entries(raw)) {
    const at = `${where}.${name}`;
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new PolicyError(`${at}: must be a mapping with ${KEYS.join(', ')}`);
    const set: ExclusionSet = { name, paths: [], extensions: new Map(), tags: [], operationIds: [], components: [] };
    for (const [k, val] of Object.entries(v)) {
      const w = `${at}.${k}`;
      switch (k) {
        case 'paths':
          set.paths = strings(val, w).map((p) => {
            if (!p.startsWith('/')) throw new PolicyError(`${w}: '${p}' must start with /`);
            return glob(p, true);
          });
          break;
        case 'tags':
          set.tags = strings(val, w);
          break;
        case 'operationIds':
          set.operationIds = strings(val, w).map((s) => glob(s));
          break;
        case 'components':
          set.components = strings(val, w).map((s) => glob(s));
          break;
        case 'extensions': {
          // [x-internal] (any value but false) or { x-audience: internal } / { x-audience: [a, b] }.
          const entries: [string, unknown[] | undefined][] = Array.isArray(val)
            ? strings(val, w).map((x) => [x, undefined])
            : val !== null && typeof val === 'object'
              ? Object.entries(val).map(([x, vs]) => [x, Array.isArray(vs) ? vs : [vs]])
              : (() => {
                  throw new PolicyError(`${w}: must be a list of x- extension names, or a mapping of x- extensions to values`);
                })();
          for (const [x, vs] of entries) {
            if (!x.startsWith('x-')) throw new PolicyError(`${w}: '${x}' is not an x- extension name`);
            set.extensions.set(x, vs);
          }
          break;
        }
        default:
          throw new PolicyError(`${w}: unknown key${suggest(k, KEYS)}`);
      }
    }
    out.set(name, set);
  }
  return out;
}

function hasExtension(set: ExclusionSet, exts: Record<string, unknown>): boolean {
  for (const [x, values] of set.extensions) {
    if (!(x in exts)) continue;
    const v = exts[x];
    if (values === undefined ? v !== false && v !== null : values.some((w) => JSON.stringify(w) === JSON.stringify(v))) return true;
  }
  return false;
}

/** True if the operation is in the set (any key matching is enough). */
export function operationInSet(set: ExclusionSet, op: OperationInfo): boolean {
  return (
    set.paths.some((r) => r.test(op.path)) ||
    (op.operationId !== undefined && set.operationIds.some((r) => r.test(op.operationId!))) ||
    op.tags.some((t) => set.tags.includes(t)) ||
    hasExtension(set, op.extensions)
  );
}

/** True if the component schema is in the set, by name or extension. */
export function componentInSet(set: ExclusionSet, name: string, ctx: SpecContext): boolean {
  return set.components.some((r) => r.test(name)) || hasExtension(set, ctx.components.get(name) ?? {});
}

/**
 * The sets a finding belongs to: its operation's, its component's, or, for a
 * finding with affected operations, the sets that contain all of them.
 */
export function setsFor(subject: string, impact: string[] | undefined, sets: Map<string, ExclusionSet>, ctx: SpecContext): string[] {
  const out: string[] = [];
  const isOp = /^[A-Z]+ \//.test(subject);
  const component = componentName(subject);
  for (const set of sets.values()) {
    const opIn = (s: string): boolean => {
      const op = ctx.operations.get(s);
      return !!op && operationInSet(set, op);
    };
    if (isOp ? opIn(subject) : component !== undefined && componentInSet(set, component, ctx)) out.push(set.name);
    else if (impact?.length && impact.every(opIn)) out.push(set.name);
  }
  return out;
}

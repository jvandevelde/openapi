// What the policy needs to know about the parts of the spec a finding is in:
// each operation's method, path, operationId, tags, stability and `x-`
// extensions, each component schema's extensions, and the document's. Built
// once per comparison from both models; the revision wins when an operation
// or component exists on both sides, and removed ones come from the base.

import { isObject } from '../load/documents.ts';
import type { Model, Operation } from '../model/model.ts';
import type { Hint, HintIndex } from './hints.ts';

export interface OperationInfo {
  method: string;
  path: string;
  operationId: string | undefined;
  tags: string[];
  /** `x-` extensions on the operation, then its path item (the operation's win). */
  extensions: Record<string, unknown>;
  stability: string;
  /** `x-api-diff` hints on the operation, then its path item. */
  hints: Hint[];
}

export interface SpecContext {
  /** Keyed by finding subject, e.g. `GET /pets/{id}`. */
  operations: Map<string, OperationInfo>;
  /** `x-` extensions of each component schema, keyed by name. */
  components: Map<string, Record<string, unknown>>;
  /** `x-` extensions at the document root. */
  document: Record<string, unknown>;
}

export interface LifecycleSettings {
  stability: string;
  defaultStability: string;
  deprecatedSince: string;
  sunset: string;
}

export const DEFAULT_LIFECYCLE: LifecycleSettings = { stability: 'x-stability-level', defaultStability: 'stable', deprecatedSince: 'x-deprecated-since', sunset: 'x-sunset' };

function extensionsOf(v: unknown): Record<string, unknown> {
  if (!isObject(v)) return {};
  return Object.fromEntries(Object.entries(v).filter(([k]) => k.startsWith('x-')));
}

function operationInfo(m: Model, op: Operation, lc: LifecycleSettings, hints: HintIndex | undefined): OperationInfo {
  const node = m.docs.value(op.at);
  const item = m.docs.value({ file: op.at.file, segs: op.at.segs.slice(0, -1) });
  const extensions = { ...extensionsOf(item), ...extensionsOf(node) };
  const level = extensions[lc.stability];
  const opHints: Hint[] = [];
  if (hints?.size) {
    const itemSegs = op.at.segs.slice(0, -1);
    for (const segs of [op.at.segs, itemSegs]) {
      const h = hints.at(m.docs.location({ file: op.at.file, segs }));
      if (h) opHints.push(h);
    }
  }
  return { method: op.method, path: op.path, operationId: op.operationId, tags: op.tags, extensions, stability: typeof level === 'string' ? level : lc.defaultStability, hints: opHints };
}

export function buildContext(base: Model | undefined, revision: Model | undefined, lc: LifecycleSettings = DEFAULT_LIFECYCLE, hints: { base?: HintIndex; revision?: HintIndex } = {}): SpecContext {
  const ctx: SpecContext = { operations: new Map(), components: new Map(), document: {} };
  for (const [m, h] of [[base, hints.base], [revision, hints.revision]] as const) {
    if (!m) continue;
    for (const op of m.operations.values()) ctx.operations.set(`${op.method.toUpperCase()} ${op.path}`, operationInfo(m, op, lc, h));
    const doc = m.docs.root.parsed.value;
    if (!isObject(doc)) continue;
    ctx.document = { ...ctx.document, ...extensionsOf(doc) };
    const schemas = isObject(doc.components) && isObject(doc.components.schemas) ? doc.components.schemas : {};
    for (const [name, s] of Object.entries(schemas)) ctx.components.set(name, extensionsOf(s));
  }
  return ctx;
}

/** The component name of a subject like `#/components/schemas/Pet`, or undefined. */
export function componentName(subject: string): string | undefined {
  const m = /^#\/components\/schemas\/([^/]+)/.exec(subject);
  return m ? m[1]!.replace(/~1/g, '/').replace(/~0/g, '~') : undefined;
}

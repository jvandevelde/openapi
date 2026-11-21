// Bulk-change collapsing: the same change made in 3 or more operations
// (e.g. a header added inline to every operation) becomes one change whose
// subject is "N operations" and whose impact lists them
// (decision record 2026-11-21T1539-schema-engine).

import { canonicalString } from '../index/canonical.ts';
import type { Change } from '../types.ts';

export const BULK_MIN = 3;

/** Rules whose subject is the identity of the change itself, so grouping would hide it. */
const NEVER = new Set(['operation-added', 'operation-removed', 'operation-path-changed', 'not-compared', 'spec-invalid', 'ref-unresolved']);

const isOperation = (subject: string): boolean => /^[A-Z]+ \//.test(subject);

function sortKeys(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sortKeys);
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
}

export function collapseBulk(changes: Change[], min = BULK_MIN): Change[] {
  const groups = new Map<string, Change[]>();
  const out: Change[] = [];
  for (const c of changes) {
    if (!isOperation(c.subject) || NEVER.has(c.rule)) {
      out.push(c);
      continue;
    }
    const sig = [c.rule, c.location ?? '', c.direction ?? '', canonicalString(sortKeys(c.details))].join('|');
    const g = groups.get(sig);
    if (g) g.push(c);
    else groups.set(sig, [c]);
  }
  for (const g of groups.values()) {
    const ops = [...new Set(g.map((c) => c.subject))].sort();
    if (ops.length < min) {
      out.push(...g);
      continue;
    }
    const first = [...g].sort((a, b) => a.subject.localeCompare(b.subject))[0]!;
    out.push({ ...first, subject: `${ops.length} operations`, impact: ops, details: { ...first.details, operations: ops.length } });
  }
  return out;
}

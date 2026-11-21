// Schema comparison (M4): finds schema roots whose shape changed and reports
// each as `unclassified-change`, one finding per schema root, until the M5
// schema rules classify them (decision record 2026-11-21T0548-unclassified-change-in-m4).
//
// - Named schemas (component schemas and other `$ref` targets) are matched by
//   logical name and reported once, with the operations that use them.
// - Schemas written inline in an operation are matched through the operation.
// Only local changes are reported: a change inside `Address` is reported for
// `Address`, not again for every schema that references it.

import { changedPointers } from '../index/canonical.ts';
import type { SchemaIndex, SchemaNode } from '../index/schema-index.ts';
import type { Model, Operation } from '../model/model.ts';
import type { Change } from '../types.ts';

const opSubject = (op: Operation): string => `${op.method.toUpperCase()} ${op.path}`;

/** Operations (as subjects) whose schemas reach `n`, from the base side. */
function impactOf(model: Model, index: SchemaIndex, n: SchemaNode): string[] {
  const roots = new Set(index.usageRootsReaching(n).map((r) => r.id));
  const ops = new Set<string>();
  for (const op of model.operations.values()) {
    for (const u of op.schemas.values()) {
      const node = index.get(u.at);
      if (node && roots.has(node.id)) {
        ops.add(opSubject(op));
        break;
      }
    }
  }
  return [...ops].sort();
}

export function diffSchemas(base: Model, rev: Model, pairs: [Operation, Operation][]): Change[] {
  const bi = base.schemaIndex!;
  const ri = rev.schemaIndex!;
  const out: Change[] = [];

  for (const b of bi.nodes) {
    if (!b.named) continue;
    const r = ri.byLogical.get(b.logical);
    if (!r || b.deep.shape === r.deep.shape || b.local.shape === r.local.shape) continue;
    const impact = impactOf(base, bi, b);
    const c: Change = {
      rule: 'unclassified-change',
      subject: b.logical,
      base: base.docs.location(b.ref),
      revision: rev.docs.location(r.ref),
      details: { where: b.logical, changed: changedPointers(bi.tree(b, 'shape'), ri.tree(r, 'shape')) },
    };
    if (impact.length) c.impact = impact;
    out.push(c);
  }

  for (const [bo, ro] of pairs) {
    for (const [key, bu] of bo.schemas) {
      const ru = ro.schemas.get(key);
      if (!ru) continue;
      const b = bi.get(bu.at);
      const r = ri.get(ru.at);
      // Named nodes are compared above; here only schemas written inline in the operation.
      if (!b || !r || b.named || r.named || b.local.shape === r.local.shape) continue;
      out.push({
        rule: 'unclassified-change',
        subject: opSubject(ro),
        base: base.docs.location(b.ref),
        revision: rev.docs.location(r.ref),
        details: { where: ru.label, changed: changedPointers(bi.tree(b, 'shape'), ri.tree(r, 'shape')) },
      });
    }
  }
  return out;
}

// Docs rules outside schemas (schemas are handled by the schema engine):
// document info and tags, operations, parameters, request bodies, media
// types, responses, headers and security schemes. One finding per changed
// annotation (decision record 2026-11-21T1539-schema-engine).

import { canonicalString } from '../index/canonical.ts';
import { encodePointer, isObject, type Ref } from '../load/documents.ts';
import type { Model, Operation } from '../model/model.ts';
import type { Change } from '../types.ts';

const RULE: Record<string, string> = {
  summary: 'summary-changed',
  description: 'description-changed',
  externalDocs: 'external-docs-changed',
  example: 'example-changed',
  examples: 'example-changed',
};

const sortedCanon = (v: unknown): string => canonicalString(sortKeys(v));
function sortKeys(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sortKeys);
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
}

const opSubject = (op: Operation): string => `${op.method.toUpperCase()} ${op.path}`;

/** `interpreted`: extensions other rules read (e.g. the lifecycle ones), so they aren't reported as extension-changed. */
export function diffDocs(base: Model, rev: Model, pairs: [Operation, Operation][], interpreted: ReadonlySet<string> = new Set()): Change[] {
  const out: Change[] = [];
  const seen = new Set<string>();

  /** Compares the annotations of two objects, one finding per changed key. */
  const annotations = (b: Ref, r: Ref, subject: string, keys: string[] = Object.keys(RULE)): void => {
    const bv = base.docs.value(b);
    const rv = rev.docs.value(r);
    if (!isObject(bv) || !isObject(rv)) return;
    const all = new Set([...Object.keys(bv), ...Object.keys(rv)]);
    for (const k of all) {
      const rule = keys.includes(k) ? RULE[k] : k.startsWith('x-') && k !== 'x-api-diff' && !interpreted.has(k) ? 'extension-changed' : undefined; // x-api-diff configures this tool, not the API
      if (!rule || sortedCanon(bv[k]) === sortedCanon(rv[k])) continue;
      const bl = base.docs.location({ file: b.file, segs: [...b.segs, k] });
      const rl = rev.docs.location({ file: r.file, segs: [...r.segs, k] });
      const key = `${rule}|${bl.file}${bl.pointer}|${rl.file}${rl.pointer}`;
      if (seen.has(key)) continue; // shared objects (path items, $ref'd parameters) are reported once
      seen.add(key);
      out.push({ rule, subject, base: bl, revision: rl, details: { path: encodePointer([...r.segs, k]) } });
    }
  };

  const root = (m: Model, ...segs: string[]): Ref => ({ file: m.docs.root, segs });
  const bDoc = base.docs.root.parsed.value as Record<string, unknown>;
  const rDoc = rev.docs.root.parsed.value as Record<string, unknown>;

  // Document: info, externalDocs, extensions, tags.
  const bInfo = isObject(bDoc.info) ? bDoc.info : {};
  const rInfo = isObject(rDoc.info) ? rDoc.info : {};
  if (bInfo.title !== rInfo.title) out.push({ rule: 'title-changed', subject: 'document', base: base.docs.location(root(base, 'info', 'title')), revision: rev.docs.location(root(rev, 'info', 'title')), details: { path: '/info/title', from: bInfo.title ?? null, to: rInfo.title ?? null } });
  for (const k of ['contact', 'license', 'termsOfService']) {
    if (sortedCanon(bInfo[k]) !== sortedCanon(rInfo[k])) out.push({ rule: 'info-changed', subject: 'document', base: base.docs.location(root(base, 'info', k)), revision: rev.docs.location(root(rev, 'info', k)), details: { path: `/info/${k}`, name: k } });
  }
  annotations(root(base, 'info'), root(rev, 'info'), 'document', ['summary', 'description']);
  annotations(root(base), root(rev), 'document', ['externalDocs']);

  const tags = (doc: Record<string, unknown>): Map<string, number> => new Map((Array.isArray(doc.tags) ? doc.tags : []).map((t, i) => [String(isObject(t) ? t.name : ''), i]));
  const bt = tags(bDoc);
  const rt = tags(rDoc);
  for (const [name, i] of bt) {
    const j = rt.get(name);
    if (j === undefined) out.push({ rule: 'tag-removed', subject: 'document', base: base.docs.location(root(base, 'tags', String(i))), details: { name } });
    else {
      const bv = (bDoc.tags as Record<string, unknown>[])[i]!;
      const rv = (rDoc.tags as Record<string, unknown>[])[j]!;
      if (sortedCanon(bv.description) !== sortedCanon(rv.description)) out.push({ rule: 'tag-description-changed', subject: 'document', base: base.docs.location(root(base, 'tags', String(i), 'description')), revision: rev.docs.location(root(rev, 'tags', String(j), 'description')), details: { name } });
      annotations(root(base, 'tags', String(i)), root(rev, 'tags', String(j)), 'document', ['externalDocs']);
    }
  }
  for (const [name, j] of rt) if (!bt.has(name)) out.push({ rule: 'tag-added', subject: 'document', revision: rev.docs.location(root(rev, 'tags', String(j))), details: { name } });

  // Security schemes.
  for (const [name, b] of base.securitySchemes) {
    const r = rev.securitySchemes.get(name);
    if (r) annotations(b.at, r.at, `securitySchemes/${name}`, ['description']);
  }

  // Operations and everything under them.
  for (const [bo, ro] of pairs) {
    const subject = opSubject(ro);
    const pathItem = (op: Operation): Ref => ({ file: op.at.file, segs: op.at.segs.slice(0, op.at.segs[op.at.segs.length - 2] === 'additionalOperations' ? -2 : -1) });
    annotations(pathItem(bo), pathItem(ro), subject, ['summary', 'description']);
    annotations(bo.at, ro.at, subject, ['summary', 'description', 'externalDocs']);
    for (const [key, bp] of bo.params) {
      const rp = ro.params.get(key);
      if (rp) annotations(bp.at, rp.at, subject, ['description', 'example', 'examples']);
    }
    if (bo.requestBody && ro.requestBody) {
      annotations(bo.requestBody.at, ro.requestBody.at, subject, ['description']);
      for (const [mt, b] of bo.requestBody.content) {
        const r = ro.requestBody.content.get(mt);
        if (r) annotations(b, r, subject, ['example', 'examples']);
      }
    }
    for (const [status, br] of bo.responses) {
      const rr = ro.responses.get(status);
      if (!rr) continue;
      annotations(br.at, rr.at, subject, ['description']);
      for (const [mt, b] of br.content) {
        const r = rr.content.get(mt);
        if (r) annotations(b, r, subject, ['example', 'examples']);
      }
      for (const [name, bh] of br.headers) {
        const rh = rr.headers.get(name);
        if (rh) annotations(bh.at, rh.at, subject, ['description', 'example', 'examples']);
      }
    }
  }
  return out;
}

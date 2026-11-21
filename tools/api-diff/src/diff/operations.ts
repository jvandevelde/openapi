// Operation-level diff: paths, operations, security, parameters, request
// bodies and responses. Produces changes only; severities are decided by the
// classify stage.

import type { Ref } from '../load/documents.ts';
import type { Model, Operation, Param, Requirement, Response } from '../model/model.ts';
import { isStatusRange, isSuccessStatus, statusRange } from '../normalize/normalize.ts';
import type { Change, Location } from '../types.ts';

interface Ctx {
  base: Model;
  rev: Model;
  out: Change[];
}

const bLoc = (ctx: Ctx, r: Ref): Location => ctx.base.docs.location(r);
const rLoc = (ctx: Ctx, r: Ref): Location => ctx.rev.docs.location(r);

const opSubject = (op: Operation): string => `${op.method.toUpperCase()} ${op.path}`;

function push(ctx: Ctx, c: Omit<Change, 'details'> & { details?: Record<string, unknown> }): void {
  ctx.out.push({ details: {}, ...c });
}

export function diffOperations(base: Model, rev: Model): Change[] {
  const ctx: Ctx = { base, rev, out: [] };
  diffDocumentServers(ctx);
  diffSecuritySchemes(ctx);

  const removed: Operation[] = [];
  const added = new Map(rev.operations);
  for (const [key, b] of base.operations) {
    const r = rev.operations.get(key);
    if (r) {
      added.delete(key);
      diffOperation(ctx, b, r, false);
    } else removed.push(b);
  }

  // Same operationId and method at a different path: the path changed.
  const byId = new Map<string, Operation>();
  for (const r of added.values()) if (r.operationId) byId.set(`${r.method} ${r.operationId}`, r);
  for (const b of removed) {
    const r = b.operationId ? byId.get(`${b.method} ${b.operationId}`) : undefined;
    if (r && added.has(r.key)) {
      added.delete(r.key);
      push(ctx, { rule: 'operation-path-changed', subject: opSubject(r), base: bLoc(ctx, b.at), revision: rLoc(ctx, r.at), details: { from: b.path, to: r.path, operationId: b.operationId } });
      diffOperation(ctx, b, r, true);
    } else {
      push(ctx, { rule: 'operation-removed', subject: opSubject(b), base: bLoc(ctx, b.at) });
    }
  }
  for (const r of added.values()) push(ctx, { rule: 'operation-added', subject: opSubject(r), revision: rLoc(ctx, r.at) });

  notCompared(ctx);
  return ctx.out;
}

function notCompared(ctx: Ctx): void {
  if (ctx.base.hasWebhooks || ctx.rev.hasWebhooks) push(ctx, { rule: 'not-compared', subject: 'document', details: { what: 'webhooks' } });
  const callbacks = [...ctx.base.operations.values(), ...ctx.rev.operations.values()].filter((o) => o.hasCallbacks).length;
  if (callbacks) push(ctx, { rule: 'not-compared', subject: 'document', details: { what: 'callbacks', count: callbacks } });
}

function diffOperation(ctx: Ctx, b: Operation, r: Operation, pathChanged: boolean): void {
  const subject = opSubject(r);
  const at = { base: bLoc(ctx, b.at), revision: rLoc(ctx, r.at) };

  if (!pathChanged && b.path !== r.path) {
    b.pathParams.forEach((from, i) => {
      const to = r.pathParams[i];
      if (to !== undefined && to !== from) push(ctx, { rule: 'path-param-renamed', subject, ...at, details: { from, to } });
    });
  }
  if (b.operationId !== r.operationId) push(ctx, { rule: 'operation-id-changed', subject, ...at, details: { from: b.operationId ?? null, to: r.operationId ?? null } });

  const bt = [...b.tags].sort();
  const rt = [...r.tags].sort();
  if (bt.join('\u0000') !== rt.join('\u0000')) push(ctx, { rule: 'operation-tags-changed', subject, ...at, details: { from: bt, to: rt } });

  // Operation- and path-level servers; document-level servers are compared once.
  if (b.serversLevel !== 'document' || r.serversLevel !== 'document') {
    const removed = b.servers.filter((u) => !r.servers.includes(u));
    if (removed.length) push(ctx, { rule: 'server-url-changed', subject, base: bLoc(ctx, b.serversAt), revision: rLoc(ctx, r.serversAt), details: { removed, added: r.servers.filter((u) => !b.servers.includes(u)) } });
  }

  diffSecurity(ctx, b, r, subject);
  diffParams(ctx, b, r, subject);
  diffRequestBody(ctx, b, r, subject);
  diffResponses(ctx, b, r, subject);
}

function diffDocumentServers(ctx: Ctx): void {
  const removed = ctx.base.documentServers.filter((u) => !ctx.rev.documentServers.includes(u));
  if (removed.length) {
    push(ctx, {
      rule: 'server-url-changed',
      subject: 'document',
      base: bLoc(ctx, ctx.base.documentServersAt),
      revision: rLoc(ctx, ctx.rev.documentServersAt),
      details: { removed, added: ctx.rev.documentServers.filter((u) => !ctx.base.documentServers.includes(u)) },
    });
  }
}

// --- Security -------------------------------------------------------------

const schemeSet = (req: Requirement): string => [...req.keys()].sort().join(' + ');
const isAnonymous = (reqs: Requirement[]): boolean => reqs.length === 0 || reqs.some((r) => r.size === 0);

function diffSecurity(ctx: Ctx, b: Operation, r: Operation, subject: string): void {
  const at = { base: bLoc(ctx, b.securityAt), revision: rLoc(ctx, r.securityAt) };
  const bAnon = isAnonymous(b.security);
  const rAnon = isAnonymous(r.security);
  const bReqs = b.security.filter((x) => x.size > 0);
  const rReqs = r.security.filter((x) => x.size > 0);

  if (bAnon && !rAnon) {
    push(ctx, { rule: 'security-requirement-added', subject, ...at, details: { schemes: rReqs.map(schemeSet).join(' | ') } });
    return;
  }
  if (!bAnon && rAnon) {
    push(ctx, { rule: 'security-requirement-removed', subject, ...at, details: { schemes: bReqs.map(schemeSet).join(' | ') } });
    return;
  }

  // Match alternatives: same scheme set first, then supersets/subsets.
  const unmatchedR = new Set(rReqs);
  const pairs: [Requirement, Requirement][] = [];
  const leftB: Requirement[] = [];
  for (const br of bReqs) {
    const m = [...unmatchedR].find((x) => schemeSet(x) === schemeSet(br));
    if (m) {
      unmatchedR.delete(m);
      pairs.push([br, m]);
    } else leftB.push(br);
  }
  for (const br of leftB) {
    const sup = [...unmatchedR].find((x) => [...br.keys()].every((k) => x.has(k)));
    const sub = sup ? undefined : [...unmatchedR].find((x) => [...x.keys()].every((k) => br.has(k)));
    if (sup) {
      unmatchedR.delete(sup);
      const extra = [...sup.keys()].filter((k) => !br.has(k)).sort();
      push(ctx, { rule: 'security-requirement-added', subject, ...at, details: { schemes: extra.join(' + '), alternative: schemeSet(sup) } });
      pairs.push([br, sup]);
    } else if (sub) {
      unmatchedR.delete(sub);
      const gone = [...br.keys()].filter((k) => !sub.has(k)).sort();
      push(ctx, { rule: 'security-requirement-removed', subject, ...at, details: { schemes: gone.join(' + '), alternative: schemeSet(sub) } });
      pairs.push([br, sub]);
    } else {
      push(ctx, { rule: 'security-alternative-removed', subject, ...at, details: { schemes: schemeSet(br) } });
    }
  }
  for (const rr of unmatchedR) push(ctx, { rule: 'security-alternative-added', subject, ...at, details: { schemes: schemeSet(rr) } });

  for (const [br, rr] of pairs) {
    for (const [scheme, bScopes] of br) {
      const rScopes = rr.get(scheme);
      if (!rScopes) continue;
      const addedScopes = rScopes.filter((s) => !bScopes.includes(s));
      const removedScopes = bScopes.filter((s) => !rScopes.includes(s));
      if (addedScopes.length) push(ctx, { rule: 'security-scope-added', subject, ...at, details: { scheme, scopes: addedScopes } });
      if (removedScopes.length) push(ctx, { rule: 'security-scope-removed', subject, ...at, details: { scheme, scopes: removedScopes } });
    }
  }
}

const FLOW_URLS = ['authorizationUrl', 'tokenUrl', 'refreshUrl'] as const;

function diffSecuritySchemes(ctx: Ctx): void {
  for (const [name, b] of ctx.base.securitySchemes) {
    const r = ctx.rev.securitySchemes.get(name);
    if (!r) continue;
    const fields: string[] = [];
    for (const f of ['type', 'in', 'name', 'openIdConnectUrl'] as const) if (b.value[f] !== r.value[f]) fields.push(f);
    if (String(b.value.scheme ?? '').toLowerCase() !== String(r.value.scheme ?? '').toLowerCase()) fields.push('scheme');
    const bf = (b.value.flows ?? {}) as Record<string, Record<string, unknown> | undefined>;
    const rf = (r.value.flows ?? {}) as Record<string, Record<string, unknown> | undefined>;
    for (const flow of Object.keys(bf)) {
      if (!rf[flow]) fields.push(`flows.${flow}`);
      else for (const u of FLOW_URLS) if (bf[flow]?.[u] !== rf[flow]?.[u]) fields.push(`flows.${flow}.${u}`);
    }
    if (!fields.length) continue;
    const impact = [...ctx.rev.operations.values()].filter((op) => op.security.some((req) => req.has(name))).map(opSubject).sort();
    push(ctx, { rule: 'security-scheme-changed', subject: `securitySchemes/${name}`, base: bLoc(ctx, b.at), revision: rLoc(ctx, r.at), details: { scheme: name, fields: fields.join(', ') }, impact });
  }
}

// --- Parameters -------------------------------------------------------------

function diffParams(ctx: Ctx, b: Operation, r: Operation, subject: string): void {
  const removed: Param[] = [];
  const added = new Map(r.params);
  for (const [key, bp] of b.params) {
    const rp = r.params.get(key);
    if (rp) {
      added.delete(key);
      diffParam(ctx, bp, rp, subject);
    } else if (bp.in !== 'path') removed.push(bp);
  }
  // Path parameters follow the template. A renamed one appears as removed + added under different keys.
  for (const [key, rp] of added) if (rp.in === 'path') added.delete(key);

  for (const bp of removed) {
    const moved = [...added.values()].find((rp) => rp.in !== 'path' && rp.name.toLowerCase() === bp.name.toLowerCase());
    if (moved) {
      added.delete(moved.key);
      push(ctx, { rule: 'parameter-location-changed', subject, location: bp.in, base: bLoc(ctx, bp.at), revision: rLoc(ctx, moved.at), details: { name: bp.name, from: bp.in, to: moved.in } });
      continue;
    }
    push(ctx, { rule: 'parameter-removed', subject, location: bp.in, base: bLoc(ctx, bp.at), revision: rLoc(ctx, r.at), details: { name: bp.name } });
  }
  for (const rp of added.values()) {
    push(ctx, { rule: rp.required ? 'parameter-added-required' : 'parameter-added-optional', subject, location: rp.in, base: bLoc(ctx, b.at), revision: rLoc(ctx, rp.at), details: { name: rp.name } });
  }
}

function diffParam(ctx: Ctx, bp: Param, rp: Param, subject: string): void {
  const at = { base: bLoc(ctx, bp.at), revision: rLoc(ctx, rp.at) };
  if (bp.in !== 'path') {
    if (!bp.required && rp.required) push(ctx, { rule: 'parameter-became-required', subject, location: rp.in, ...at, details: { name: rp.name } });
    if (bp.required && !rp.required) push(ctx, { rule: 'parameter-became-optional', subject, location: rp.in, ...at, details: { name: rp.name } });
  }
  const fields: string[] = [];
  if (bp.style !== rp.style) fields.push(`style ${bp.style} → ${rp.style}`);
  if (bp.explode !== rp.explode) fields.push(`explode ${bp.explode} → ${rp.explode}`);
  if (bp.allowReserved !== rp.allowReserved) fields.push(`allowReserved ${bp.allowReserved} → ${rp.allowReserved}`);
  const bc = bp.content?.join(', ') ?? '(schema)';
  const rc = rp.content?.join(', ') ?? '(schema)';
  if (bc !== rc) fields.push(`content ${bc} → ${rc}`);
  if (fields.length) push(ctx, { rule: 'parameter-serialization-changed', subject, location: rp.in, ...at, details: { name: rp.name, fields: fields.join('; ') } });
}

// --- Request bodies -----------------------------------------------------------

function diffRequestBody(ctx: Ctx, b: Operation, r: Operation, subject: string): void {
  const bb = b.requestBody;
  const rb = r.requestBody;
  if (!bb && !rb) return;
  if (!bb && rb) {
    push(ctx, { rule: rb.required ? 'request-body-added-required' : 'request-body-added-optional', subject, base: bLoc(ctx, b.at), revision: rLoc(ctx, rb.at) });
    return;
  }
  if (bb && !rb) {
    push(ctx, { rule: 'request-body-removed', subject, base: bLoc(ctx, bb.at), revision: rLoc(ctx, r.at) });
    return;
  }
  if (!bb || !rb) return;
  const at = { base: bLoc(ctx, bb.at), revision: rLoc(ctx, rb.at) };
  if (!bb.required && rb.required) push(ctx, { rule: 'request-body-became-required', subject, ...at });
  if (bb.required && !rb.required) push(ctx, { rule: 'request-body-became-optional', subject, ...at });
  for (const [mt, ref] of bb.content) if (!rb.content.has(mt)) push(ctx, { rule: 'request-media-type-removed', subject, base: bLoc(ctx, ref), revision: rLoc(ctx, rb.at), details: { mediaType: mt } });
  for (const [mt, ref] of rb.content) if (!bb.content.has(mt)) push(ctx, { rule: 'request-media-type-added', subject, base: bLoc(ctx, bb.at), revision: rLoc(ctx, ref), details: { mediaType: mt } });
}

// --- Responses ----------------------------------------------------------------

function diffResponses(ctx: Ctx, b: Operation, r: Operation, subject: string): void {
  const respAt = (op: Operation, side: 'base' | 'rev'): Location => (side === 'base' ? bLoc(ctx, { file: op.at.file, segs: [...op.at.segs, 'responses'] }) : rLoc(ctx, { file: op.at.file, segs: [...op.at.segs, 'responses'] }));
  /** Revision keys already accounted for by range matching. */
  const consumed = new Set<string>();
  /** Range widening (200, 201 → 2XX), reported once per range. */
  const widened = new Map<string, string[]>();

  for (const [key, br] of b.responses) {
    const rr = r.responses.get(key);
    if (rr) {
      diffResponse(ctx, br, rr, subject);
      continue;
    }
    // A specific code now covered by its range, which the base didn't have.
    const range = statusRange(key);
    const rRange = range && !b.responses.has(range) ? r.responses.get(range) : undefined;
    if (range && rRange) {
      consumed.add(range);
      widened.set(range, [...(widened.get(range) ?? []), br.status]);
      diffResponse(ctx, br, rRange, subject);
      continue;
    }
    // A range now split into specific codes the base didn't have.
    if (isStatusRange(key)) {
      const codes = [...r.responses.keys()].filter((k) => statusRange(k) === key && !b.responses.has(k));
      if (codes.length) {
        for (const c of codes) {
          consumed.add(c);
          diffResponse(ctx, br, r.responses.get(c)!, subject);
        }
        push(ctx, { rule: 'response-status-range-narrowed', subject, base: bLoc(ctx, br.at), revision: rLoc(ctx, r.responses.get(codes[0]!)!.at), details: { from: br.status, to: codes.map((c) => r.responses.get(c)!.status), status: br.status } });
        continue;
      }
    }
    const rule = key === 'default' ? 'response-default-removed' : isSuccessStatus(key) ? 'response-success-status-removed' : 'response-error-status-removed';
    push(ctx, { rule, subject, base: bLoc(ctx, br.at), revision: respAt(r, 'rev'), details: { status: br.status } });
  }
  for (const [range, from] of widened) {
    const rr = r.responses.get(range)!;
    push(ctx, { rule: 'response-status-range-widened', subject, base: respAt(b, 'base'), revision: rLoc(ctx, rr.at), details: { from, to: rr.status, status: rr.status } });
  }
  for (const [key, rr] of r.responses) {
    if (b.responses.has(key) || consumed.has(key) || key === 'default') continue;
    push(ctx, { rule: isSuccessStatus(key) ? 'response-success-status-added' : 'response-error-status-added', subject, base: respAt(b, 'base'), revision: rLoc(ctx, rr.at), details: { status: rr.status } });
  }
}

function diffResponse(ctx: Ctx, br: Response, rr: Response, subject: string): void {
  const status = rr.status;
  const at = { base: bLoc(ctx, br.at), revision: rLoc(ctx, rr.at) };
  if (br.content.size > 0 && rr.content.size === 0) {
    push(ctx, { rule: 'response-body-removed', subject, ...at, details: { status } });
  } else {
    for (const [mt, ref] of br.content) if (!rr.content.has(mt)) push(ctx, { rule: 'response-media-type-removed', subject, base: bLoc(ctx, ref), revision: at.revision, details: { status, mediaType: mt } });
    if (br.content.size > 0) for (const [mt, ref] of rr.content) if (!br.content.has(mt)) push(ctx, { rule: 'response-media-type-added', subject, base: at.base, revision: rLoc(ctx, ref), details: { status, mediaType: mt } });
  }
  for (const [key, bh] of br.headers) {
    const rh = rr.headers.get(key);
    if (!rh) push(ctx, { rule: 'response-header-removed', subject, base: bLoc(ctx, bh.at), revision: at.revision, details: { status, name: bh.name, required: bh.required } });
    else if (bh.required && !rh.required) push(ctx, { rule: 'response-header-became-optional', subject, base: bLoc(ctx, bh.at), revision: rLoc(ctx, rh.at), details: { status, name: rh.name } });
  }
  for (const [key, rh] of rr.headers) if (!br.headers.has(key)) push(ctx, { rule: 'response-header-added', subject, base: at.base, revision: rLoc(ctx, rh.at), details: { status, name: rh.name } });
}

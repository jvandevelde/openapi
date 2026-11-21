// Builds the operation-level model of one document: operations keyed by
// `METHOD path-key`, with their effective parameters, request body,
// responses, security and servers. `$ref`s are followed on demand.

import type { SchemaIndex } from '../index/schema-index.ts';
import { DocumentSet, isObject, type Ref } from '../load/documents.ts';
import { detectVersion, mediaTypeKey, pathKey, pathParamNames, statusKey, type OasVersion } from '../normalize/normalize.ts';
import type { ParamLocation } from '../types.ts';

export const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query'] as const;

/** Header parameters OpenAPI says to ignore. */
const IGNORED_HEADERS = new Set(['accept', 'content-type', 'authorization']);

export interface Param {
  key: string;
  name: string;
  in: ParamLocation;
  required: boolean;
  style: string;
  explode: boolean;
  allowReserved: boolean;
  /** Media types when the parameter uses `content` instead of `schema`. */
  content: string[] | undefined;
  at: Ref;
}

export interface Body {
  required: boolean;
  content: Map<string, Ref>;
  at: Ref;
}

export interface Header {
  name: string;
  required: boolean;
  at: Ref;
}

export interface Response {
  status: string;
  content: Map<string, Ref>;
  headers: Map<string, Header>;
  at: Ref;
}

/** A schema used directly by an operation. Keys are the same on both sides. */
export interface SchemaUsage {
  key: string;
  /** e.g. `query parameter 'limit'` or `response 200 (application/json)`. */
  label: string;
  direction: 'in' | 'out';
  at: Ref;
}

/** One security requirement: scheme name → required scopes. */
export type Requirement = Map<string, string[]>;

export interface Operation {
  key: string;
  method: string;
  path: string;
  pathKey: string;
  operationId: string | undefined;
  tags: string[];
  pathParams: string[];
  params: Map<string, Param>;
  requestBody: Body | undefined;
  responses: Map<string, Response>;
  security: Requirement[];
  securityAt: Ref;
  servers: string[];
  /** Where `servers` was declared: 'operation', 'path' or 'document'. */
  serversLevel: 'operation' | 'path' | 'document';
  serversAt: Ref;
  hasCallbacks: boolean;
  schemas: Map<string, SchemaUsage>;
  at: Ref;
}

export interface SecurityScheme {
  name: string;
  value: Record<string, unknown>;
  at: Ref;
}

export interface Model {
  version: OasVersion;
  infoVersion: string;
  openapi: string;
  operations: Map<string, Operation>;
  securitySchemes: Map<string, SecurityScheme>;
  documentServers: string[];
  documentServersAt: Ref;
  hasWebhooks: boolean;
  docs: DocumentSet;
  /** Every schema usage of every operation, for the schema index. */
  usages: Ref[];
  /** Built by the engine after the model. */
  schemaIndex?: SchemaIndex;
}

export class InvalidSpecError extends Error {}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function serverUrls(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter(isObject).map((s) => String(s.url ?? '/').replace(/\/+$/, '') || '/');
}

function requirements(v: unknown): Requirement[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObject).map((req) => new Map(Object.entries(req).map(([k, scopes]) => [k, Array.isArray(scopes) ? scopes.map(String).sort() : []])));
}

export function buildModel(docs: DocumentSet): Model {
  const root = docs.root;
  const doc = root.parsed.value;
  const version = detectVersion(doc);
  if (typeof version === 'object') throw new InvalidSpecError(version.error);
  const d = doc as Record<string, unknown>;
  const info = isObject(d.info) ? d.info : {};
  const rootRef = (...segs: string[]): Ref => ({ file: root, segs });

  const docServers = serverUrls(d.servers) ?? ['/'];
  const docSecurity = requirements(d.security);

  const model: Model = {
    version,
    openapi: String(d.openapi),
    infoVersion: info.version === undefined ? 'unknown' : String(info.version),
    operations: new Map(),
    securitySchemes: new Map(),
    documentServers: docServers,
    documentServersAt: rootRef('servers'),
    hasWebhooks: isObject(d.webhooks) && Object.keys(d.webhooks).length > 0,
    docs,
    usages: [],
  };

  const components = isObject(d.components) ? d.components : {};
  if (isObject(components.securitySchemes)) {
    for (const name of Object.keys(components.securitySchemes)) {
      const r = docs.deref(rootRef('components', 'securitySchemes', name));
      if (r && isObject(r.value)) model.securitySchemes.set(name, { name, value: r.value, at: r.ref });
    }
  }

  const paths = isObject(d.paths) ? d.paths : {};
  // Sorted, so when two templates clash (/a/{x} and /a/{y}) the same one is kept whatever the key order.
  for (const path of Object.keys(paths).sort()) {
    const pr = docs.deref(rootRef('paths', path));
    if (!pr || !isObject(pr.value)) continue;
    const item = pr.value;
    const itemRef = pr.ref;
    const pathServers = serverUrls(item.servers);
    const sharedParams = collectParams(docs, item.parameters, { file: itemRef.file, segs: [...itemRef.segs, 'parameters'] });

    const methods: [string, Ref][] = [];
    for (const m of METHODS) if (isObject(item[m])) methods.push([m, { file: itemRef.file, segs: [...itemRef.segs, m] }]);
    if (isObject(item.additionalOperations)) {
      for (const m of Object.keys(item.additionalOperations)) {
        methods.push([m.toLowerCase(), { file: itemRef.file, segs: [...itemRef.segs, 'additionalOperations', m] }]);
      }
    }

    for (const [method, opRef] of methods) {
      const op = docs.value(opRef) as Record<string, unknown>;
      const key = `${method.toUpperCase()} ${pathKey(path)}`;
      if (model.operations.has(key)) {
        docs.notices.push({ rule: 'spec-invalid', details: { reason: `${key} is defined by more than one path template (${model.operations.get(key)!.path} and ${path})` }, at: docs.location(opRef) });
        continue;
      }
      const params = new Map(sharedParams);
      for (const [k, p] of collectParams(docs, op.parameters, { file: opRef.file, segs: [...opRef.segs, 'parameters'] })) params.set(k, p);

      const pathParams = pathParamNames(path);
      for (const p of params.values()) {
        if (p.in === 'path' && !pathParams.includes(p.name)) {
          docs.notices.push({ rule: 'spec-invalid', details: { reason: `path parameter '${p.name}' is not in the path template ${path}` }, at: docs.location(p.at) });
        }
      }

      const opServers = serverUrls(op.servers);
      const servers = opServers ?? pathServers ?? docServers;
      const serversLevel = opServers ? 'operation' : pathServers ? 'path' : 'document';
      const serversAt = opServers ? { file: opRef.file, segs: [...opRef.segs, 'servers'] } : pathServers ? { file: itemRef.file, segs: [...itemRef.segs, 'servers'] } : rootRef('servers');

      const hasOwnSecurity = Array.isArray(op.security);
      const requestBody = buildBody(docs, op.requestBody, { file: opRef.file, segs: [...opRef.segs, 'requestBody'] });
      const responses = buildResponses(docs, op.responses, { file: opRef.file, segs: [...opRef.segs, 'responses'] });
      const schemas = schemaUsages(docs, params, requestBody, responses);
      for (const u of schemas.values()) model.usages.push(u.at);
      model.operations.set(key, {
        key,
        method,
        path,
        pathKey: pathKey(path),
        operationId: str(op.operationId),
        tags: Array.isArray(op.tags) ? op.tags.map(String) : [],
        pathParams,
        params,
        requestBody,
        responses,
        security: hasOwnSecurity ? requirements(op.security) : docSecurity,
        securityAt: hasOwnSecurity ? { file: opRef.file, segs: [...opRef.segs, 'security'] } : rootRef('security'),
        servers,
        serversLevel,
        serversAt,
        hasCallbacks: isObject(op.callbacks) && Object.keys(op.callbacks).length > 0,
        schemas,
        at: opRef,
      });
    }
  }
  return model;
}

function paramDefaults(loc: ParamLocation): { style: string } {
  return { style: loc === 'query' || loc === 'cookie' ? 'form' : 'simple' };
}

function collectParams(docs: DocumentSet, list: unknown, at: Ref): Map<string, Param> {
  const out = new Map<string, Param>();
  if (!Array.isArray(list)) return out;
  for (let i = 0; i < list.length; i++) {
    const r = docs.deref({ file: at.file, segs: [...at.segs, String(i)] });
    if (!r || !isObject(r.value)) continue;
    const p = r.value;
    const loc = p.in;
    if (loc !== 'path' && loc !== 'query' && loc !== 'header' && loc !== 'cookie') continue;
    const name = String(p.name ?? '');
    if (loc === 'header' && IGNORED_HEADERS.has(name.toLowerCase())) continue;
    const key = `${loc}:${loc === 'header' ? name.toLowerCase() : name}`;
    const style = str(p.style) ?? paramDefaults(loc).style;
    out.set(key, {
      key,
      name,
      in: loc,
      required: loc === 'path' ? true : p.required === true,
      style,
      explode: typeof p.explode === 'boolean' ? p.explode : style === 'form',
      allowReserved: p.allowReserved === true,
      content: isObject(p.content) ? Object.keys(p.content).map(mediaTypeKey).sort() : undefined,
      at: r.ref,
    });
  }
  return out;
}

function contentMap(docs: DocumentSet, content: unknown, at: Ref): Map<string, Ref> {
  const out = new Map<string, Ref>();
  if (!isObject(content)) return out;
  for (const mt of Object.keys(content)) out.set(mediaTypeKey(mt), { file: at.file, segs: [...at.segs, mt] });
  return out;
}

function buildBody(docs: DocumentSet, v: unknown, at: Ref): Body | undefined {
  if (v === undefined) return undefined;
  const r = docs.deref(at);
  if (!r || !isObject(r.value)) return undefined;
  return { required: r.value.required === true, content: contentMap(docs, r.value.content, { file: r.ref.file, segs: [...r.ref.segs, 'content'] }), at: r.ref };
}

function buildResponses(docs: DocumentSet, v: unknown, at: Ref): Map<string, Response> {
  const out = new Map<string, Response>();
  if (!isObject(v)) return out;
  for (const status of Object.keys(v)) {
    if (status.startsWith('x-')) continue;
    const r = docs.deref({ file: at.file, segs: [...at.segs, status] });
    if (!r || !isObject(r.value)) continue;
    const headers = new Map<string, Header>();
    if (isObject(r.value.headers)) {
      for (const name of Object.keys(r.value.headers)) {
        if (name.toLowerCase() === 'content-type') continue;
        const h = docs.deref({ file: r.ref.file, segs: [...r.ref.segs, 'headers', name] });
        if (!h || !isObject(h.value)) continue;
        headers.set(name.toLowerCase(), { name, required: h.value.required === true, at: h.ref });
      }
    }
    out.set(statusKey(status), {
      status,
      content: contentMap(docs, r.value.content, { file: r.ref.file, segs: [...r.ref.segs, 'content'] }),
      headers,
      at: r.ref,
    });
  }
  return out;
}

/** Schema locations used by an operation: parameters, request body media types, response media types and headers. */
function schemaUsages(docs: DocumentSet, params: Map<string, Param>, body: Body | undefined, responses: Map<string, Response>): Map<string, SchemaUsage> {
  const out = new Map<string, SchemaUsage>();
  const add = (key: string, label: string, direction: 'in' | 'out', holder: Ref): void => {
    const at: Ref = { file: holder.file, segs: [...holder.segs, 'schema'] };
    const v = docs.value(at);
    if (v !== undefined && (typeof v === 'boolean' || isObject(v))) out.set(key, { key, label, direction, at });
  };
  for (const p of params.values()) {
    const label = `${p.in} parameter '${p.name}'`;
    const content = (docs.value(p.at) as Record<string, unknown>).content;
    if (isObject(content)) for (const mt of Object.keys(content)) add(`param:${p.key}:${mediaTypeKey(mt)}`, `${label} (${mt})`, 'in', { file: p.at.file, segs: [...p.at.segs, 'content', mt] });
    else add(`param:${p.key}`, label, 'in', p.at);
  }
  if (body) for (const [mt, at] of body.content) add(`request:${mt}`, `request body (${mt})`, 'in', at);
  for (const [status, r] of responses) {
    for (const [mt, at] of r.content) add(`response:${status}:${mt}`, `response ${r.status} (${mt})`, 'out', at);
    for (const [name, h] of r.headers) add(`response-header:${status}:${name}`, `response ${r.status} header '${h.name}'`, 'out', h.at);
  }
  return out;
}

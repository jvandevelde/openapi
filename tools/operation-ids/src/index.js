/**
 * openapi-operation-ids
 *
 * Fills in missing operationIds with short, deterministic, unique names.
 * Existing operationIds are never changed.
 */
import YAML from 'yaml';
import {
  collectTopLevel,
  collectCallbacks,
  existingIds,
  hasOperationId,
  requiredQueryParams,
} from './collect.js';
import { pathOperationLadder, webhookOperationLadder, callbackOperationLadder } from './naming.js';
import { resolveNames } from './resolve.js';
import { CASES } from './tokenize.js';

export { CASES };

const SUPPORTED_VERSION = /^3\.[012](\.|$)/;

function assertSupported(spec) {
  if (spec === null || typeof spec !== 'object') throw new Error('Input is not an OpenAPI document');
  if (spec.swagger) throw new Error(`Swagger ${spec.swagger} is not supported; only OpenAPI 3.0 - 3.2`);
  if (typeof spec.openapi !== 'string' || !SUPPORTED_VERSION.test(spec.openapi)) {
    throw new Error(`Unsupported OpenAPI version "${spec.openapi}"; expected 3.0.x, 3.1.x or 3.2.x`);
  }
}

function ladderFor(spec, record, style) {
  const requiredQuery = requiredQueryParams(spec, record.pathItem, record.op);
  switch (record.kind) {
    case 'path':
      return pathOperationLadder({ ...record, requiredQuery }, style);
    case 'webhook':
      return webhookOperationLadder({ ...record, requiredQuery }, style);
    case 'callback':
      return callbackOperationLadder(record, style);
    default:
      throw new Error(`Unknown operation kind ${record.kind}`);
  }
}

/** Drop operations whose object is shared (e.g. via YAML aliases). */
function dropShared(records, warnings) {
  const count = new Map();
  for (const r of records) count.set(r.op, (count.get(r.op) ?? 0) + 1);
  return records.filter((r) => {
    if (count.get(r.op) === 1) return true;
    warnings.push(`Skipped ${r.key}: the operation object is shared with another location.`);
    return false;
  });
}

/**
 * Work out which operationIds to add, without modifying the document.
 *
 * @param {object} spec  parsed OpenAPI document (plain JS object)
 * @param {{case?: 'camel'|'pascal'|'snake'|'kebab'}} [options]
 * @returns {{added: Array<{location: string[], operationId: string, key: string}>, warnings: string[]}}
 */
export function planOperationIds(spec, options = {}) {
  const style = options.case ?? 'camel';
  if (!CASES.includes(style)) throw new Error(`Unknown case "${style}" (expected one of: ${CASES.join(', ')})`);
  assertSupported(spec);

  const warnings = [];
  const reserved = new Set(existingIds(spec));
  const seenExisting = new Map();
  for (const id of existingIds(spec)) seenExisting.set(id, (seenExisting.get(id) ?? 0) + 1);
  for (const [id, n] of seenExisting) {
    if (n > 1) warnings.push(`Existing operationId "${id}" is used ${n} times (left unchanged).`);
  }

  const generated = new Map(); // record -> id
  const idOf = (r) => (hasOperationId(r.op) ? r.op.operationId : generated.get(r));
  const added = [];

  // Waves: top-level operations first, then callbacks (which are named after
  // their parent), then callbacks of callbacks, and so on.
  let wave = dropShared(collectTopLevel(spec, warnings), warnings);
  for (let depth = 0; wave.length > 0 && depth < 10; depth++) {
    const missing = wave
      .filter((r) => !hasOperationId(r.op))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const names = resolveNames(
      missing.map((r) => ({ nameAt: ladderFor(spec, r, style) })),
      reserved,
    );
    missing.forEach((r, i) => {
      generated.set(r, names[i]);
      reserved.add(names[i]);
      added.push({ location: r.location, operationId: names[i], key: r.key });
    });
    wave = dropShared(collectCallbacks(spec, wave, idOf, warnings), warnings);
  }

  added.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { added, warnings };
}

// Keys after which operationId is inserted, so it sits near the top.
const ANCHOR_KEYS = ['tags', 'summary', 'description'];

function insertIndex(keys) {
  let idx = 0;
  keys.forEach((k, i) => {
    if (ANCHOR_KEYS.includes(k)) idx = Math.max(idx, i + 1);
  });
  return idx;
}

function getAt(obj, location) {
  return location.reduce((cur, k) => (cur == null ? undefined : cur[k]), obj);
}

/** Apply planned ids to a plain object in place, preserving key order. */
export function applyToObject(spec, added) {
  for (const { location, operationId } of added) {
    const op = getAt(spec, location);
    if (!op || typeof op !== 'object') throw new Error(`No operation at ${location.join(' > ')}`);
    if ('operationId' in op) {
      op.operationId = operationId;
      continue;
    }
    const entries = Object.entries(op);
    entries.splice(insertIndex(Object.keys(op)), 0, ['operationId', operationId]);
    for (const k of Object.keys(op)) delete op[k];
    for (const [k, v] of entries) op[k] = v;
  }
  return spec;
}

/**
 * Fill missing operationIds on a plain object. The input is not modified.
 * @returns {{spec: object, added: Array, warnings: string[]}}
 */
export function fillOperationIds(spec, options = {}) {
  const { added, warnings } = planOperationIds(spec, options);
  const copy = applyToObject(structuredClone(spec), added);
  return { spec: copy, added, warnings };
}

function detectFormat(text, filename) {
  if (filename) {
    if (/\.json$/i.test(filename)) return 'json';
    if (/\.ya?ml$/i.test(filename)) return 'yaml';
  }
  return /^\s*[{[]/.test(text) ? 'json' : 'yaml';
}

function applyToYamlDocument(doc, added) {
  for (const { location, operationId } of added) {
    const node = doc.getIn(location, true);
    if (!YAML.isMap(node)) {
      throw new Error(`Cannot write operationId at ${location.join(' > ')} (aliases/merge keys are not supported)`);
    }
    if (node.has('operationId')) {
      node.set('operationId', operationId);
      continue;
    }
    const keys = node.items.map((p) => (YAML.isScalar(p.key) ? p.key.value : p.key));
    node.items.splice(insertIndex(keys), 0, doc.createPair('operationId', operationId));
  }
}

/**
 * Fill missing operationIds in a JSON or YAML string, keeping formatting,
 * comments and key order as close to the original as possible.
 *
 * @param {string} text
 * @param {{case?: string, format?: 'json'|'yaml', filename?: string}} [options]
 * @returns {{text: string, added: Array, warnings: string[], format: 'json'|'yaml'}}
 */
export function fillOperationIdsInText(text, options = {}) {
  const format = options.format ?? detectFormat(text, options.filename);
  if (format === 'json') {
    const spec = JSON.parse(text);
    const { added, warnings } = planOperationIds(spec, options);
    if (added.length === 0) return { text, added, warnings, format };
    applyToObject(spec, added);
    const indentMatch = text.match(/^[{[]\s*\n([ \t]+)/);
    const indent = indentMatch ? indentMatch[1] : 2;
    const trailing = text.endsWith('\n') ? '\n' : '';
    return { text: JSON.stringify(spec, null, indent) + trailing, added, warnings, format };
  }

  const doc = YAML.parseDocument(text);
  if (doc.errors.length) throw doc.errors[0];
  const { added, warnings } = planOperationIds(doc.toJS(), options);
  if (added.length === 0) return { text, added, warnings, format };
  applyToYamlDocument(doc, added);
  return { text: doc.toString({ lineWidth: 0 }), added, warnings, format };
}

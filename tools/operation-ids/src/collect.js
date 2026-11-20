/**
 * Finds every operation in an OpenAPI 3.0 / 3.1 / 3.2 document.
 */

export const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isExtension = (k) => k.startsWith('x-');

export function hasOperationId(op) {
  return typeof op.operationId === 'string' && op.operationId.trim() !== '';
}

/** Resolve a local "#/a/b" reference; returns undefined for anything else. */
export function resolveLocalRef(spec, value) {
  if (!isObject(value) || typeof value.$ref !== 'string') return value;
  const ref = value.$ref;
  if (!ref.startsWith('#/')) return undefined;
  let cur = spec;
  for (const part of ref.slice(2).split('/')) {
    const key = decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isObject(cur) && !Array.isArray(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** Required query parameter names (path-item + operation level), sorted. */
export function requiredQueryParams(spec, pathItem, op) {
  const byKey = new Map();
  for (const list of [pathItem?.parameters, op.parameters]) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const p = resolveLocalRef(spec, raw);
      if (!isObject(p) || typeof p.name !== 'string') continue;
      byKey.set(`${p.in}:${p.name}`, p); // operation level overrides path level
    }
  }
  return [...byKey.values()]
    .filter((p) => p.in === 'query' && p.required === true)
    .map((p) => p.name)
    .sort();
}

/** Yields [method, operation, locationSuffix] for each operation in a path item. */
function* pathItemOperations(pathItem) {
  for (const m of HTTP_METHODS) {
    if (isObject(pathItem[m])) yield [m, pathItem[m], [m]];
  }
  // OpenAPI 3.2: custom HTTP methods
  if (isObject(pathItem.additionalOperations)) {
    for (const [m, op] of Object.entries(pathItem.additionalOperations)) {
      if (isObject(op)) yield [m, op, ['additionalOperations', m]];
    }
  }
}

/**
 * Collect operations from a map of path items (paths, webhooks or a callback).
 * `make(key, method, op, pathItem, location)` returns the record to store.
 */
function collectFromPathItems(container, baseLocation, label, warnings, make) {
  const out = [];
  if (!isObject(container)) return out;
  for (const [key, pathItem] of Object.entries(container)) {
    if (isExtension(key) || !isObject(pathItem)) continue;
    if (typeof pathItem.$ref === 'string') {
      warnings.push(
        `Skipped ${label} "${key}": it is a $ref (${pathItem.$ref}). Writing an operationId into a shared ` +
          'path item would give the same id to every path that references it.',
      );
      continue;
    }
    for (const [method, op, suffix] of pathItemOperations(pathItem)) {
      out.push(make(key, method, op, pathItem, [...baseLocation, key, ...suffix]));
    }
  }
  return out;
}

/** Top-level operations: everything under `paths` and `webhooks`. */
export function collectTopLevel(spec, warnings) {
  const paths = collectFromPathItems(spec.paths, ['paths'], 'path', warnings, (path, method, op, pathItem, location) => ({
    kind: 'path',
    path,
    method,
    op,
    pathItem,
    location,
    key: `path ${method.toUpperCase()} ${path}`,
  }));
  const webhooks = collectFromPathItems(
    spec.webhooks,
    ['webhooks'],
    'webhook',
    warnings,
    (name, method, op, pathItem, location) => ({
      kind: 'webhook',
      name,
      method,
      op,
      pathItem,
      location,
      key: `webhook ${method.toUpperCase()} ${name}`,
    }),
  );
  return [...paths, ...webhooks];
}

/** Callback operations of the given parent records (one nesting level). */
export function collectCallbacks(spec, parents, idOf, warnings) {
  const out = [];
  for (const parent of parents) {
    const callbacks = parent.op.callbacks;
    if (!isObject(callbacks)) continue;
    const parentId = idOf(parent);
    for (const [callbackName, callback] of Object.entries(callbacks)) {
      if (isExtension(callbackName) || !isObject(callback)) continue;
      if (typeof callback.$ref === 'string') {
        warnings.push(
          `Skipped callback "${callbackName}" of ${parent.key}: it is a $ref (${callback.$ref}) and may be shared.`,
        );
        continue;
      }
      out.push(
        ...collectFromPathItems(
          callback,
          [...parent.location, 'callbacks', callbackName],
          `callback expression in "${callbackName}" of ${parent.key}`,
          warnings,
          (expression, method, op, pathItem, location) => ({
            kind: 'callback',
            parentId,
            callbackName,
            expression,
            method,
            op,
            pathItem,
            location,
            key: `callback ${parent.key} > ${callbackName} > ${method.toUpperCase()} ${expression}`,
          }),
        ),
      );
    }
  }
  return out;
}

/**
 * Existing operationIds anywhere they can be defined, including reusable
 * components that this tool does not modify.
 */
export function existingIds(spec) {
  const ids = [];
  const visitPathItem = (pathItem, depth = 0) => {
    if (!isObject(pathItem) || depth > 10) return;
    for (const [, op] of pathItemOperations(pathItem)) {
      if (hasOperationId(op)) ids.push(op.operationId);
      if (isObject(op.callbacks)) {
        for (const cb of Object.values(op.callbacks)) {
          if (isObject(cb)) for (const pi of Object.values(cb)) visitPathItem(pi, depth + 1);
        }
      }
    }
  };
  for (const container of [spec.paths, spec.webhooks, spec.components?.pathItems]) {
    if (isObject(container)) Object.values(container).forEach((pi) => visitPathItem(pi));
  }
  if (isObject(spec.components?.callbacks)) {
    for (const cb of Object.values(spec.components.callbacks)) {
      if (isObject(cb)) Object.values(cb).forEach((pi) => visitPathItem(pi));
    }
  }
  return ids;
}

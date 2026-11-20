/**
 * Builds the widening "ladder" of candidate names for each operation.
 *
 * Every operation gets a `nameAt(level)` function. Level 0 is the shortest
 * name; each higher level adds more information from the route. Past the
 * last informative level, a short hash of the operation's unique key is
 * appended (growing in length if needed), which guarantees uniqueness.
 */
import { createHash } from 'node:crypto';
import pluralize from 'pluralize';
import { words, parsePath, formatCase, hashSeparator } from './tokenize.js';

// Words that pluralize mangles ("data" -> "datum") but should stay as-is.
for (const w of ['data', 'metadata', 'media', 'info', 'health', 'auth', 'me']) {
  pluralize.addUncountableRule(w);
}

/** HTTP method -> verb. Unknown/custom methods use their own lower-cased name. */
export const METHOD_VERBS = {
  get: 'get', // becomes "list" for plural collection paths
  post: 'create',
  put: 'replace',
  patch: 'update',
  delete: 'delete',
  head: 'head',
  options: 'options',
  trace: 'trace',
  query: 'query',
};

const isPluralOnly = (w) => pluralize.isPlural(w) && !pluralize.isSingular(w);
const singularLast = (ws) => (ws.length ? [...ws.slice(0, -1), pluralize.singular(ws.at(-1))] : ws);

function methodVerb(method) {
  const m = method.toLowerCase();
  return METHOD_VERBS[m] ?? (words(m).join('') || m);
}

/** Decide verb + inflected resource words for a resource at the end of a route. */
function verbAndResource(method, resourceWords, isItem) {
  const m = method.toLowerCase();
  const base = methodVerb(method);
  if (resourceWords.length === 0) return { verb: base, resource: [] };
  if (isItem) return { verb: base, resource: singularLast(resourceWords) };
  if (m === 'get') {
    return isPluralOnly(resourceWords.at(-1))
      ? { verb: 'list', resource: resourceWords }
      : { verb: 'get', resource: resourceWords };
  }
  if (m === 'post') return { verb: base, resource: singularLast(resourceWords) };
  return { verb: base, resource: resourceWords };
}

function byWords(names) {
  const out = [];
  names.forEach((n, i) => out.push(i === 0 ? 'by' : 'and', ...words(n)));
  return out;
}

function withWords(names) {
  const out = [];
  names.forEach((n, i) => out.push(i === 0 ? 'with' : 'and', ...words(n)));
  return out;
}

function hashOf(key, length) {
  return createHash('sha1').update(key).digest('hex').slice(0, length);
}

/**
 * Wrap a list of informative word-lists (level 0..n) with the hash fallback.
 */
function ladder(levels, key, style) {
  const informative = levels.map((ws) => formatCase(ws, style));
  const last = informative.at(-1);
  const sep = hashSeparator(style);
  return (level) => {
    if (level < informative.length) return informative[level];
    const extra = level - informative.length; // 0 -> 4 chars, 1 -> 8, 2 -> 16, ...
    const length = 4 * 2 ** extra;
    if (length > 40) {
      throw new Error(`Unable to generate a unique operationId for ${key}`);
    }
    return `${last}${sep}${hashOf(key, length)}`;
  };
}

/** Ladder for an operation under `paths`. */
export function pathOperationLadder({ path, method, requiredQuery, key }, style) {
  const { segments, params } = parsePath(path);
  const lastStatic = segments.findLastIndex((s) => s.type === 'static');
  const isItem = segments.length > 0 && segments.at(-1).type === 'param';

  let resourceWords;
  if (segments.length === 0) resourceWords = ['root'];
  else if (lastStatic === -1) resourceWords = [];
  else resourceWords = segments[lastStatic].words;

  const { verb, resource } = verbAndResource(method, resourceWords, isItem);

  // Parent static segments, nearest first. A parent that is directly followed
  // by a path parameter refers to a single item, so it is singularized.
  const parents = [];
  for (let i = lastStatic - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg.type !== 'static') continue;
    const followedByParam = segments[i + 1]?.type === 'param';
    parents.push(followedByParam ? singularLast(seg.words) : seg.words);
  }

  const build = (parentCount, extra = []) => [
    verb,
    ...parents.slice(0, parentCount).reverse().flat(),
    ...resource,
    ...extra,
  ];

  const by = byWords(params);
  const levels = [];
  // A route with no static words at all ("/{id}") needs its params to be meaningful.
  levels.push(resource.length === 0 ? build(0, by) : build(0));
  for (let p = 1; p <= parents.length; p++) levels.push(build(p));
  levels.push(build(parents.length, by));
  levels.push(build(parents.length, [...by, ...withWords(requiredQuery)]));

  return ladder(levels, key, style);
}

/** Ladder for an operation under `webhooks` (OpenAPI 3.1+). */
export function webhookOperationLadder({ name, method, requiredQuery, key }, style) {
  const { verb, resource } = verbAndResource(method, words(name), false);
  const base = [verb, ...resource, 'webhook'];
  return ladder([base, [...base, ...withWords(requiredQuery)]], key, style);
}

/** Ladder for an operation inside a callback, named after its parent operation. */
export function callbackOperationLadder({ parentId, callbackName, expression, method, key }, style) {
  const base = [...words(parentId), ...words(callbackName)];
  const withMethod = [...base, ...words(method)];
  const withExpression = [...withMethod, ...words(expression)];
  return ladder([base, withMethod, withExpression], key, style);
}

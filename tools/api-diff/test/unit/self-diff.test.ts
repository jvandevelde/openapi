// Property tests: comparing a spec with itself, or with a copy that only
// differs cosmetically (key order, JSON vs YAML), finds nothing.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { dump } from 'js-yaml';
import { compareOpened } from '../../src/engine.ts';
import { MemorySource } from '../../src/sources/memory.ts';

const name = fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,7}$/);
const param = fc.record({
  name,
  in: fc.constantFrom('query', 'header', 'cookie'),
  required: fc.boolean(),
  schema: fc.constant({ type: 'string' }),
});
const response = fc.record({ description: fc.constant('ok') });
const operation = fc.record(
  {
    operationId: name,
    tags: fc.array(name, { maxLength: 2 }),
    parameters: fc.uniqueArray(param, { selector: (p) => `${p.in}:${p.name.toLowerCase()}`, maxLength: 4 }),
    responses: fc.dictionary(fc.constantFrom('200', '201', '400', '404', 'default'), response, { minKeys: 1, maxKeys: 3 }),
    security: fc.array(fc.dictionary(fc.constantFrom('apiKey', 'oauth'), fc.array(fc.constantFrom('read', 'write'), { maxLength: 2 }), { maxKeys: 2 }), { maxLength: 2 }),
  },
  { requiredKeys: ['responses'] },
);
const pathItem = fc.dictionary(fc.constantFrom('get', 'put', 'post', 'delete'), operation, { minKeys: 1, maxKeys: 3 });
const spec = fc.record({
  openapi: fc.constantFrom('3.0.3', '3.1.0', '3.2.0'),
  info: fc.constant({ title: 't', version: '1' }),
  // Valid specs only: no two templates that differ only in parameter names (/a/{x} and /a/{y}).
  paths: fc.dictionary(fc.stringMatching(/^\/[a-z]{1,6}(\/\{[a-z]{1,4}\})?$/), pathItem, { maxKeys: 4 }).filter((p) => new Set(Object.keys(p).map((k) => k.replace(/\{[^}]*\}/g, '{}'))).size === Object.keys(p).length),
  components: fc.constant({ securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'X-Key' }, oauth: { type: 'oauth2', flows: { implicit: { authorizationUrl: 'https://a', scopes: {} } } } } }),
});

/** Same content, keys in reverse order at every level. */
function reverseKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)]));
  return v;
}

/** Path parameters every template needs, so specs are valid. */
function withPathParams(input: { paths: Record<string, Record<string, { parameters?: unknown[] }>> }): typeof input {
  // Clone: fast-check reuses generated values while shrinking, so mutating them in place corrupts later runs.
  const s = structuredClone(input);
  for (const [path, item] of Object.entries(s.paths)) {
    const names = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    for (const op of Object.values(item)) op.parameters = [...(op.parameters ?? []), ...names.map((n) => ({ name: n, in: 'path', required: true, schema: { type: 'string' } }))];
  }
  return s;
}

const compare = (a: string, aName: string, b: string, bName: string) =>
  compareOpened({ source: new MemorySource({ [aName]: a }), root: aName }, { source: new MemorySource({ [bName]: b }), root: bName });

test('a spec compared with itself has no findings', async () => {
  await fc.assert(
    fc.asyncProperty(spec, async (s) => {
      const text = dump(withPathParams(s));
      const r = await compare(text, 'a.yaml', text, 'b.yaml');
      assert.deepEqual(r.findings, [], text);
    }),
    { numRuns: 300 },
  );
});

test('key order and JSON vs YAML make no difference', async () => {
  await fc.assert(
    fc.asyncProperty(spec, async (s) => {
      const v = withPathParams(s);
      const r = await compare(dump(v), 'a.yaml', JSON.stringify(reverseKeys(v)), 'b.json');
      assert.deepEqual(r.findings, []);
    }),
    { numRuns: 300 },
  );
});

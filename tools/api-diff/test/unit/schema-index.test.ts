// The schema index on recursive, deep and large schema graphs.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dump } from 'js-yaml';
import { compareOpened } from '../../src/engine.ts';
import { changedPointers } from '../../src/index/canonical.ts';
import { SchemaIndex } from '../../src/index/schema-index.ts';
import { DocumentSet } from '../../src/load/documents.ts';
import { buildModel } from '../../src/model/model.ts';
import { MemorySource } from '../../src/sources/memory.ts';

async function index(spec: unknown, name = 'a.json'): Promise<SchemaIndex> {
  const docs = new DocumentSet(new MemorySource({ [name]: name.endsWith('.json') ? JSON.stringify(spec) : dump(spec) }), name);
  await docs.load();
  const model = buildModel(docs);
  return SchemaIndex.build(docs, model.version, model.usages);
}

const doc = (schemas: Record<string, unknown>, rootSchema = { $ref: '#/components/schemas/A' }) => ({
  openapi: '3.1.0',
  info: { title: 't', version: '1' },
  paths: { '/a': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema: rootSchema } } } } } } },
  components: { schemas },
});
const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` });

test('self-reference, union over a collection of the base type, and a three-schema cycle are recursive', async () => {
  const idx = await index(
    doc({
      TreeNode: { type: 'object', properties: { children: { type: 'array', items: ref('TreeNode') } } },
      Shape: { oneOf: [ref('Circle'), ref('Group')] },
      Circle: { type: 'object', properties: { r: { type: 'number' } } },
      Group: { type: 'object', properties: { children: { type: 'array', items: ref('Shape') } } },
      A: { type: 'object', properties: { b: ref('B') } },
      B: { type: 'object', properties: { c: ref('C') } },
      C: { type: 'object', properties: { a: ref('A') } },
      Leaf: { type: 'string' },
    }),
  );
  const rec = (n: string) => idx.byLogical.get(`#/components/schemas/${n}`)!.recursive;
  assert.ok(rec('TreeNode') && rec('Shape') && rec('Group') && rec('A') && rec('B') && rec('C'));
  assert.ok(!rec('Circle') && !rec('Leaf'));
  assert.equal(idx.byLogical.get('#/components/schemas/Shape')!.scc, idx.byLogical.get('#/components/schemas/Group')!.scc);
  assert.deepEqual(idx.notices, [], 'all these cycles are productive');
});

test('non-productive cycles are reported, productive ones are not', async () => {
  const idx = await index(doc({ A: { allOf: [ref('B')] }, B: { oneOf: [ref('A'), { type: 'string' }] }, C: { anyOf: [ref('C')] }, D: { properties: { d: ref('D') } } }));
  const cycles = idx.notices.filter((n) => n.rule === 'cycle-not-productive').map((n) => n.details.cycle);
  assert.deepEqual(cycles.sort(), [['#/components/schemas/A', '#/components/schemas/B'], ['#/components/schemas/C']].sort());
});

test('deep hashes change when anything reachable changes, local hashes only where the change is', async () => {
  const schemas = (cityMin: number) => ({ A: { properties: { b: ref('B') } }, B: { properties: { c: ref('C'), a: ref('A') } }, C: { properties: { city: { type: 'string', minLength: cityMin } } } });
  const x = await index(doc(schemas(1)));
  const y = await index(doc(schemas(2)));
  const n = (i: SchemaIndex, s: string) => i.byLogical.get(`#/components/schemas/${s}`)!;
  assert.equal(n(x, 'A').local.shape, n(y, 'A').local.shape);
  assert.notEqual(n(x, 'A').deep.shape, n(y, 'A').deep.shape);
  assert.notEqual(n(x, 'C').local.shape, n(y, 'C').local.shape);
  // Same document, different key order: identical hashes.
  const reverseKeys = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(reverseKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)])) : v;
  const z = await index(reverseKeys(doc(schemas(1))));
  assert.equal(n(x, 'A').deep.shape, n(z, 'A').deep.shape);
});

test('a 20,000-schema cycle and a 700-level nested schema load without overflowing the stack', async () => {
  const n = 20_000;
  const schemas: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) schemas[`S${i}`] = { type: 'object', properties: { next: ref(`S${(i + 1) % n}`) } };
  // JSON.stringify can't serialise very deep values, so the deep schema is spliced in as text.
  const deepText = '{"type":"object","properties":{"x":'.repeat(700) + '{"type":"string"}' + '}}'.repeat(700);
  const text = JSON.stringify(doc({ ...schemas, A: 'DEEP' }, ref('S0'))).replace('"DEEP"', deepText);
  const docs = new DocumentSet(new MemorySource({ 'a.json': text }), 'a.json');
  await docs.load();
  const model = buildModel(docs);
  const idx = SchemaIndex.build(docs, model.version, model.usages);
  assert.equal(idx.byLogical.get('#/components/schemas/S0')!.recursive, true);
  assert.equal(idx.usageRootsReaching(idx.byLogical.get('#/components/schemas/S123')!).length, 1);
  assert.ok(idx.byLogical.get('#/components/schemas/A')!.local.shape);
});

test('files nested too deeply to parse are spec-invalid, not a crash', async () => {
  const deep = (d: number) => 'openapi: 3.1.0\ninfo: {title: t, version: "1"}\npaths: {}\nx-deep:\n' + Array.from({ length: d }, (_, i) => ' '.repeat(i + 1) + 'p:\n').join('') + ' '.repeat(d + 1) + 'x: 1\n';
  const r = await compareOpened({ source: new MemorySource({ 'a.yaml': deep(10) }), root: 'a.yaml' }, { source: new MemorySource({ 'b.yaml': deep(5000) }), root: 'b.yaml' });
  assert.deepEqual(r.findings.map((f) => [f.rule, f.subject]), [['spec-invalid', 'revision document']]);
  assert.match(r.findings[0]!.message, /nested too deeply to parse/);
});

test('a change deep inside a cycle is reported once, for the schema that changed', async () => {
  const mk = (fmt?: string) =>
    dump(doc({ A: { type: 'object', properties: { b: ref('B') } }, B: { type: 'object', properties: { c: ref('C') } }, C: { type: 'object', properties: { a: ref('A'), note: { type: 'string', ...(fmt ? { format: fmt } : {}) } } } }));
  const r = await compareOpened({ source: new MemorySource({ 'a.yaml': mk() }), root: 'a.yaml' }, { source: new MemorySource({ 'b.yaml': mk('uuid') }), root: 'b.yaml' });
  assert.deepEqual(
    r.findings.map((f) => [f.rule, f.subject, f.details.changed, f.impact]),
    [['unclassified-change', '#/components/schemas/C', ['/properties/note/format'], ['GET /a']]],
  );
});

test('changedPointers', () => {
  assert.deepEqual(changedPointers({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 3] }, d: true }), ['/b/c', '/d']);
  assert.deepEqual(changedPointers({ allOf: [{ type: 'string' }] }, { allOf: [{ type: 'number' }] }), ['/allOf/0/type']);
  assert.deepEqual(changedPointers('x', 'x'), []);
});

test('hashes do not depend on key order, on random schema graphs with cycles', async () => {
  const { default: fc } = await import('fast-check');
  const names = ['A', 'B', 'C', 'D', 'E'];
  const schema = fc.letrec((tie) => ({
    s: fc.oneof({ depthSize: 'small' }, fc.constantFrom(...names).map(ref), fc.record({ type: fc.constantFrom('string', 'integer') }), tie('obj'), tie('arr'), tie('union')),
    obj: fc.record({ type: fc.constant('object'), properties: fc.dictionary(fc.constantFrom('a', 'b', 'c'), tie('s'), { maxKeys: 3 }) }),
    arr: fc.record({ type: fc.constant('array'), items: tie('s') }),
    union: fc.record({ oneOf: fc.array(tie('s'), { minLength: 1, maxLength: 3 }) }),
  })).s;
  const reverseKeys = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(reverseKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)])) : v;
  await fc.assert(
    fc.asyncProperty(fc.record(Object.fromEntries(names.map((n) => [n, schema]))), async (schemas) => {
      const a = await index(doc(schemas));
      const b = await index(reverseKeys(doc(schemas)));
      for (const n of a.nodes.filter((x) => x.named)) {
        const m = b.byLogical.get(n.logical)!;
        assert.equal(m.deep.shape, n.deep.shape, n.logical);
        assert.equal(m.local.shape, n.local.shape, n.logical);
        assert.equal(m.recursive, n.recursive, n.logical);
      }
    }),
    { numRuns: 200 },
  );
});

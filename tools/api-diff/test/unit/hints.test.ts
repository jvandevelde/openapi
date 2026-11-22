// In-spec hints (x-api-diff): validation, precedence and scope. The golden
// cases enum-value-added-open-*, hint-ignore-operation and
// hint-rules-on-operation cover the main behaviour end to end.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareOpened } from '../../src/engine.ts';
import { parsePolicy } from '../../src/policy/policy.ts';
import { MemorySource } from '../../src/sources/memory.ts';
import type { Finding } from '../../src/types.ts';

const doc = (o: { root?: string; op?: string; schema?: string; param?: boolean; status?: string[] }): string => `
openapi: 3.1.0
info: { title: Pets, version: 1.0.0 }
${o.root ?? ''}
paths:
  /pets:
    get:
      operationId: listPets
${o.op ?? ''}
${o.param === false ? '' : '      parameters: [{ name: limit, in: query, schema: { type: integer } }]'}
      responses:
        '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/Pet' } } } }
components:
  schemas:
    Pet:
${o.schema ?? ''}
      type: object
      properties:
        status: { type: string, enum: [${(o.status ?? ['a']).join(', ')}] }
`;

async function run(base: string, revision: string, policy: unknown = {}): Promise<Finding[]> {
  const r = await compareOpened({ source: new MemorySource({ 'a.yaml': base }), root: 'a.yaml' }, { source: new MemorySource({ 'b.yaml': revision }), root: 'b.yaml' }, { policy: parsePolicy(policy, 'p.yaml') });
  return r.findings.filter((f) => !f.baseRule.startsWith('version-')); // version checks have their own tests
}
const brief = (fs: Finding[]): string[] => fs.map((f) => `${f.rule} ${f.severity}`).sort();

test('an invalid hint is spec-invalid, with where and why', async () => {
  const fs = await run(doc({}), doc({ op: '      x-api-diff: { ignre: true }' }));
  const f = fs.find((x) => x.rule === 'spec-invalid')!;
  assert.match(f.message, /b\.yaml#\/paths\/~1pets\/get\/x-api-diff\.ignre: unknown key/);
  assert.equal(f.revision?.pointer, '/paths/~1pets/get/x-api-diff');
  const badRule = await run(doc({}), doc({ op: '      x-api-diff: { rules: { parameter-remove: info } }' }));
  assert.match(badRule.find((x) => x.rule === 'spec-invalid')!.message, /did you mean parameter-removed\?/);
});

test('adding or changing x-api-diff is not reported as an extension change', async () => {
  assert.deepEqual(await run(doc({}), doc({ op: '      x-api-diff: { rules: { operation-added: warn } }', schema: '      x-api-diff: { enum: open }' })), []);
});

test('hints beat overrides and rules', async () => {
  const fs = await run(doc({ op: '      x-api-diff: { rules: { parameter-removed: info } }' }), doc({ op: '      x-api-diff: { rules: { parameter-removed: info } }', param: false }), {
    rules: { 'parameter-removed': 'error' },
    overrides: [{ match: { path: '/pets' }, severity: 'error' }],
  });
  assert.deepEqual(brief(fs), ['query-parameter-removed info']);
});

test('a document-level hint applies to everything, after nearer hints', async () => {
  const root = 'x-api-diff: { rules: { parameter-removed: error, enum-value-added: error } }';
  const fs = await run(doc({ root }), doc({ root, param: false, status: ['a', 'b'], schema: '      x-api-diff: { rules: { enum-value-added: info } }' }));
  assert.deepEqual(brief(fs), ['enum-value-added-in-response info', 'query-parameter-removed error']);
});

test('an operation hint applies to shared component findings through usage', async () => {
  const fs = await run(doc({ op: '      x-api-diff: { rules: { enum-value-added: error } }' }), doc({ op: '      x-api-diff: { rules: { enum-value-added: error } }', status: ['a', 'b'] }));
  const f = fs.find((x) => x.baseRule === 'enum-value-added')!;
  assert.equal(f.severity, 'error');
  assert.equal(f.severitySource, 'in-spec hint b.yaml#/paths/~1pets/get: rules.enum-value-added');
});

test('honour-open-hint: false ignores enum: open', async () => {
  const base = doc({}).replace('status: { type: string,', "status: { 'x-api-diff': { enum: open }, type: string,");
  const rev = doc({ status: ['a', 'b'] }).replace('status: { type: string,', "status: { 'x-api-diff': { enum: open }, type: string,");
  assert.deepEqual(brief(await run(base, rev)), ['enum-value-added-in-response info']);
  assert.deepEqual(brief(await run(base, rev, { rules: { 'enum-value-added': { 'honour-open-hint': false } } })), ['enum-value-added-in-response warn']);
});

test('hints in a referenced file apply to changes in that file', async () => {
  const main = (status: string) => `
openapi: 3.1.0
info: { title: Pets, version: 1.0.0 }
paths:
  /pets:
    get:
      responses:
        '200': { description: ok, content: { application/json: { schema: { $ref: './pet-${status}.yaml' } } } }
`;
  const pet = (values: string) => `x-api-diff: { rules: { enum-value-added: error } }\ntype: string\nenum: [${values}]\n`;
  const r = await compareOpened(
    { source: new MemorySource({ 'a/openapi.yaml': main('a'), 'a/pet-a.yaml': pet('a') }), root: 'a/openapi.yaml' },
    { source: new MemorySource({ 'b/openapi.yaml': main('a'), 'b/pet-a.yaml': pet('a, b') }), root: 'b/openapi.yaml' },
  );
  assert.deepEqual(brief(r.findings.filter((f) => !f.baseRule.startsWith('version-'))), ['enum-value-added-in-response error']);
});

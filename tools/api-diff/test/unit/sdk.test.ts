// The sdk report: renames, methods and types, and the SDK bump under the
// sdk profile whatever profile the run used.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareOpened } from '../../src/engine.ts';
import { parsePolicy } from '../../src/policy/policy.ts';
import { renderSdk, sdkData } from '../../src/render/sdk.ts';
import { MemorySource } from '../../src/sources/memory.ts';

const doc = (o: { opId: string; type: string; param: string; status: string; extra?: string }): string => `
openapi: 3.1.0
info: { title: Shop, version: 1.0.0 }
paths:
  /orders:
    get:
      operationId: ${o.opId}
      parameters: [{ name: ${o.param}, in: query, schema: { type: integer } }]
      responses: { '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/${o.type}' } } } } }
${o.extra ?? ''}
components:
  schemas:
    ${o.type}: { type: object, properties: { status: { type: string, enum: [${o.status}] } } }
`;

// The type also gains an enum value, so only match: similar sees the rename.
const SIMILAR = { rules: { 'component-renamed': { match: 'similar' } } };

async function data(policy: Record<string, unknown> = SIMILAR, profile: 'wire' | 'sdk' = 'wire') {
  const r = await compareOpened(
    { source: new MemorySource({ 'a.yaml': doc({ opId: 'listOrders', type: 'Order', param: 'limit', status: 'open' }) }), root: 'a.yaml' },
    { source: new MemorySource({ 'b.yaml': doc({ opId: 'getOrders', type: 'PurchaseOrder', param: 'max', status: 'open, closed', extra: '  /orders/{id}: { delete: { operationId: deleteOrder, responses: { "204": { description: gone } } } }' }) }), root: 'b.yaml' },
    { policy: parsePolicy(policy), profile },
  );
  return { r, d: sdkData(r) };
}

test('renames table, methods by operationId, types by component', async () => {
  const { d } = await data();
  assert.deepEqual(d.renames.map((x) => `${x.what} ${x.from}→${x.to}`), ['argument limit→max', 'method listOrders→getOrders', 'type Order→PurchaseOrder']);
  assert.deepEqual(d.methods.map((m) => m.name), ['deleteOrder', 'getOrders']);
  assert.deepEqual(d.types.map((t) => t.name), ['PurchaseOrder']);
  assert.equal(d.types[0]!.changes.filter((c) => c.rule.startsWith('enum-value-added')).length, 1, 'request and response lines merged');
});

test('the SDK bump uses sdk-profile severities whatever the run profile', async () => {
  const wire = (await data(SIMILAR, 'wire')).d;
  const sdk = (await data(SIMILAR, 'sdk')).d;
  assert.equal(wire.bump, 'major');
  assert.equal(wire.breaking, sdk.breaking);
  assert.ok(wire.breaking >= 3, `${wire.breaking}`); // operationId, argument rename, type rename
  const lowered = (await data({ rules: { 'operation-id-changed': 'info', 'component-renamed': { severity: 'info', match: 'similar' }, 'parameter-renamed': 'info', 'parameter-removed': 'info' } })).d;
  assert.equal(lowered.bump, 'minor', 'policy-set severities are kept');
});

test('text', async () => {
  const { r } = await data();
  const txt = renderSdk(r);
  assert.match(txt, /^SDK changes: Shop 1\.0\.0 → 1\.0\.0\n\nSDK release: major version \(\d+ changes break generated code\)/);
  assert.match(txt, /^  method    listOrders → getOrders   \(GET \/orders\)$/m);
  assert.match(txt, /^Methods\n  deleteOrder  \(DELETE \/orders\/\{id\}\)/m);
});

// Pet is sent (POST) and received (GET): its `age` changes type (an error in
// both directions) and `status` gains a value (info for requests, warn for responses).
const pets = (ageType: string, statuses: string): string => `
openapi: 3.1.0
info: { title: Pets, version: 1.0.0 }
paths:
  /pets:
    get:
      operationId: listPets
      responses: { '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/Pet' } } } } }
    post:
      operationId: addPet
      requestBody: { content: { application/json: { schema: { $ref: '#/components/schemas/Pet' } } } }
      responses: { '201': { description: created } }
components:
  schemas:
    Pet: { type: object, properties: { age: { type: ${ageType} }, status: { type: string, enum: [${statuses}] } } }
`;

async function petsData() {
  const r = await compareOpened({ source: new MemorySource({ 'a.yaml': pets('integer', 'available') }), root: 'a.yaml' }, { source: new MemorySource({ 'b.yaml': pets('string', 'available, sold') }), root: 'b.yaml' });
  return { r, d: sdkData(r) };
}

test('a change in requests and responses is one entry with each direction, and is counted once', async () => {
  const { r, d } = await petsData();
  const pet = d.types.find((t) => t.name === 'Pet')!;
  const en = pet.changes.find((c) => c.text.includes('enum value added'))!;
  const req = r.findings.find((f) => f.rule === 'enum-value-added-in-request')!;
  const res = r.findings.find((f) => f.rule === 'enum-value-added-in-response')!;
  assert.equal(en.rule, 'enum-value-added', 'the rule without direction');
  assert.equal(en.id, res.id, 'the worse direction');
  assert.equal(en.severity, 'warn');
  assert.deepEqual(en.directions, [
    { direction: 'request', severity: req.severity, rule: req.rule, id: req.id },
    { direction: 'response', severity: res.severity, rule: res.rule, id: res.id },
  ]);
  const typeChanges = r.findings.filter((f) => f.baseRule === 'type-changed');
  assert.equal(typeChanges.length, 2, 'two findings in the result');
  assert.ok(typeChanges.every((f) => f.severity === 'error'));
  assert.equal(pet.changes.filter((c) => c.rule === 'type-changed').length, 1);
  assert.equal(d.breaking, 1, 'the type change breaks generated code once, not once per direction');
});

test('text: both directions and their IDs under the change', async () => {
  const { r } = await petsData();
  const txt = renderSdk(r);
  const req = r.findings.find((f) => f.rule === 'enum-value-added-in-request')!;
  const res = r.findings.find((f) => f.rule === 'enum-value-added-in-response')!;
  assert.match(txt, /^ {4}check {2}enum value added: 'sold' at \/properties\/status\/enum {2}\[enum-value-added\]$/m);
  assert.match(txt, new RegExp(`^ {11}request INFO · id ${req.id} {3}response WARN · id ${res.id}$`, 'm'));
  assert.match(txt, /\(1 change breaks generated code\)/);
});

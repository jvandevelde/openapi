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

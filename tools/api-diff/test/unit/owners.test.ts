// Ownership routing: where owners come from, in order (operation, path
// item, tags, policy owners.assign, document), owners of shared-component
// changes, invalid x-owner values, the policy section and
// acknowledgements.require-owner. The golden case acknowledgement-not-owner
// covers the notice.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareOpened } from '../../src/engine.ts';
import { parseAcknowledgements } from '../../src/policy/acks.ts';
import { parsePolicy, PolicyError } from '../../src/policy/policy.ts';
import { MemorySource } from '../../src/sources/memory.ts';

const ok = { '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } } };
const plain = { '200': { description: 'ok' } };

function spec(opts: { all: boolean; orderProps: Record<string, unknown>; billingOwner?: unknown }): string {
  const paths: Record<string, unknown> = {
    '/orders': { get: { operationId: 'listOrders', tags: ['orders'], responses: ok } },
    '/misc': { get: { operationId: 'misc', responses: ok } },
  };
  if (opts.all) {
    paths['/orders/{id}'] = { 'x-owner': '@order-detail', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], get: { 'x-owner': '@op', responses: plain }, delete: { responses: plain } };
    paths['/invoices/{id}'] = { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], get: { tags: ['billing'], responses: plain } };
  }
  return JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Shop', version: '1.0.0' },
    'x-owner': '@api',
    tags: [{ name: 'orders', 'x-owner': '@orders' }, { name: 'billing', ...(opts.billingOwner !== undefined ? { 'x-owner': opts.billingOwner } : {}) }],
    paths,
    components: { schemas: { Order: { 'x-owner': ['@schemas'], type: 'object', properties: opts.orderProps } } },
  });
}

const POLICY = { owners: { assign: [{ match: { path: '/invoices/**' }, owners: '@wrong' }, { match: { path: '/invoices/**' }, owners: ['@billing'] }] }, rules: { 'documents-unrelated': 'off' } };

async function compare(policy: unknown = POLICY, billingOwner?: unknown, acks?: unknown) {
  return compareOpened(
    { source: new MemorySource({ 'a.json': spec({ all: true, orderProps: { id: { type: 'string' }, note: { type: 'string' } } }) }), root: 'a.json' },
    { source: new MemorySource({ 'b.json': spec({ all: false, orderProps: { id: { type: 'string' } }, billingOwner }) }), root: 'b.json' },
    { policy: parsePolicy(policy), asOf: '2026-11-22', ...(acks ? { acknowledgements: parseAcknowledgements(acks, 'a.yaml') } : {}) },
  );
}

test('owners come from the operation, path item, tags, policy and document, in that order', async () => {
  const r = await compare();
  const owners = (subject: string, rule: string) => r.findings.find((f) => f.subject === subject && f.rule === rule)?.owners;
  assert.deepEqual(owners('GET /orders/{id}', 'operation-removed'), ['@op']);
  assert.deepEqual(owners('DELETE /orders/{id}', 'operation-removed'), ['@order-detail']);
  assert.deepEqual(owners('GET /invoices/{id}', 'operation-removed'), ['@billing'], 'the last matching assign entry wins');
  // A shared component: its own owners plus those of the operations using it (tag @orders; document @api for /misc).
  assert.deepEqual(owners('#/components/schemas/Order', 'property-removed-in-response'), ['@api', '@orders', '@schemas']);
  assert.deepEqual(r.operations?.['GET /orders']?.owners, ['@orders']);
  assert.equal(r.findings.find((f) => f.rule === 'version-unchanged')?.owners, undefined, 'version checks have no owners');
});

test('without a policy, unowned operations fall back to the document owner', async () => {
  const r = await compare({ rules: { 'documents-unrelated': 'off' } });
  assert.deepEqual(r.findings.find((f) => f.subject === 'GET /invoices/{id}')?.owners, ['@api']);
});

test('an invalid x-owner is spec-invalid and ignored', async () => {
  const r = await compare(POLICY, 42);
  const bad = r.findings.find((f) => f.rule === 'spec-invalid');
  assert.match(bad?.message ?? '', /x-owner at #\/tags\/1 must be a team name or a list of team names/);
  assert.equal(bad?.revision?.pointer, '/tags/1/x-owner');
});

test('the owners policy section is validated', () => {
  const bad = (owners: unknown, msg: RegExp): void => assert.throws(() => parsePolicy({ owners }, 'p.yaml'), (e: unknown) => e instanceof PolicyError && msg.test(e.message));
  bad({ extension: 'owner' }, /owners\.extension: must be an x- extension name/);
  bad({ assign: [{ match: { path: '/a' } }] }, /assign\[0\]\.owners: must be a team name/);
  bad({ assign: [{ owners: '@a' }] }, /assign\[0\]: needs match/);
  bad({ assign: [{ match: { rule: 'operation-removed' }, owners: '@a' }] }, /assign\[0\]\.match\.rule: unknown match key/);
  bad({ asign: [] }, /owners\.asign: unknown key \(did you mean assign\?\)/);
  assert.throws(() => parsePolicy({ acknowledgements: { 'require-owner': 'yes' } }), /require-owner: must be true or false/);
  assert.equal(parsePolicy({ owners: { extension: 'x-team' } }).owners.extension, 'x-team');
});

test('require-owner: an owner of the finding can acknowledge it', async () => {
  const removal = (await compare()).findings.find((f) => f.subject === 'GET /invoices/{id}')!;
  const ack = (owner: string) => [{ finding: removal.id, reason: 'agreed', owner, expires: '2027-01-31' }];
  const policy = { ...POLICY, acknowledgements: { 'require-owner': true } };
  const yes = await compare(policy, undefined, ack('@billing'));
  assert.ok(yes.findings.find((f) => f.id === removal.id)?.acknowledged);
  const no = await compare(policy, undefined, ack('@orders'));
  assert.equal(no.findings.find((f) => f.id === removal.id)?.acknowledged, undefined);
  assert.match(no.findings.find((f) => f.rule === 'acknowledgement-not-owner')!.message, /acknowledgement by @orders for operation-removed .* doesn't apply: the finding is owned by @billing/);
  assert.ok((await compare(POLICY, undefined, ack('@orders'))).findings.find((f) => f.id === removal.id)?.acknowledged, 'off by default');
});

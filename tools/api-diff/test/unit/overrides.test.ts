// Policy overrides: matching, last-match-wins, precedence over rules, and
// splitting findings that affect several operations.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareInputs, compareOpened } from '../../src/engine.ts';
import { glob } from '../../src/policy/overrides.ts';
import { parsePolicy, PolicyError } from '../../src/policy/policy.ts';
import { MemorySource } from '../../src/sources/memory.ts';
import type { Finding } from '../../src/types.ts';

const spec = (statuses: string[], withDelete: boolean): string => `
openapi: 3.1.0
info: { title: Shop, version: 1.0.0 }
x-team: shop
paths:
  /orders:
    get:
      operationId: listOrders
      tags: [orders]
      x-audience: partner
      x-stability-level: beta
      responses:
        '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/Order' } } } }
  /legacy/orders:
    get:
      operationId: legacyOrders
      responses:
        '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/Order' } } } }
${withDelete ? `  /legacy/orders/{id}:
    delete:
      operationId: deleteLegacyOrder
      responses: { '204': { description: gone } }
` : ''}  /admin/orders:
    get:
      operationId: adminOrders
      tags: [admin]
      responses:
        '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/Order' } } } }
components:
  schemas:
    Order:
      x-owner: orders-team
      type: object
      properties:
        status: { type: string, enum: [${statuses.join(', ')}] }
`;

const BASE = spec(['open', 'closed'], true);
const REVISION = spec(['open', 'closed', 'archived'], false);

async function findings(policy: unknown): Promise<Finding[]> {
  const r = await compareOpened({ source: new MemorySource({ 'a.yaml': BASE }), root: 'a.yaml' }, { source: new MemorySource({ 'b.yaml': REVISION }), root: 'b.yaml' }, { policy: parsePolicy(policy, 'p.yaml') });
  return r.findings;
}

const summary = (fs: Finding[]): string[] => fs.map((f) => `${f.rule} ${f.severity} ${f.subject}${f.impact ? ` [${f.impact.join(', ')}]` : ''}`).sort();
const ENUM = 'enum-value-added-in-response';
const ALL3 = '[GET /admin/orders, GET /legacy/orders, GET /orders]';

test('without overrides: one enum finding for the shared component, one removal', async () => {
  assert.deepEqual(summary(await findings({})), [`${ENUM} warn #/components/schemas/Order ${ALL3}`, 'operation-removed error DELETE /legacy/orders/{id}']);
});

test('path glob and method', async () => {
  const fs = await findings({ overrides: [{ match: { path: '/legacy/**', method: ['delete'] }, severity: 'off' }] });
  assert.deepEqual(summary(fs), [`${ENUM} warn #/components/schemas/Order ${ALL3}`]);
});

test('a shared component is split when its operations get different severities', async () => {
  const fs = await findings({ overrides: [{ match: { stability: ['beta'] }, severity: 'info' }] });
  assert.deepEqual(summary(fs), [
    `${ENUM} info #/components/schemas/Order [GET /orders]`,
    `${ENUM} warn #/components/schemas/Order [GET /admin/orders, GET /legacy/orders]`,
    'operation-removed error DELETE /legacy/orders/{id}',
  ]);
  const parts = fs.filter((f) => f.rule === ENUM);
  assert.notEqual(parts[0]!.id, parts[1]!.id);
  assert.equal(parts.find((f) => f.severity === 'info')!.severitySource, 'policy p.yaml: overrides #1 (stability ["beta"])');
  assert.equal(parts.find((f) => f.severity === 'warn')!.severitySource, 'default');
});

test('extension on the operation, with a rules map', async () => {
  const fs = await findings({ overrides: [{ match: { extension: { 'x-audience': 'partner' } }, rules: { [ENUM]: 'error' } }] });
  assert.ok(summary(fs).includes(`${ENUM} error #/components/schemas/Order [GET /orders]`));
});

test('extension on the component or the document', async () => {
  const onComponent = await findings({ overrides: [{ match: { extension: { 'x-owner': 'orders-team' }, rule: 'enum-*' }, severity: 'error' }] });
  assert.ok(summary(onComponent).includes(`${ENUM} error #/components/schemas/Order ${ALL3}`));
  const onDocument = await findings({ overrides: [{ match: { extension: { 'x-team': ['shop', 'other'] } }, severity: 'info' }] });
  assert.ok(onDocument.every((f) => f.severity === 'info'));
});

test('component glob and direction', async () => {
  const fs = await findings({ overrides: [{ match: { component: 'Ord*', direction: 'out' }, rules: { 'enum-value-added': 'info' } }] });
  const f = fs.find((x) => x.rule === ENUM)!;
  assert.equal(f.severity, 'info');
  assert.deepEqual(f.impact, ['GET /admin/orders', 'GET /legacy/orders', 'GET /orders']);
  assert.equal((await findings({ overrides: [{ match: { component: 'Ord*', direction: 'in' }, severity: 'info' }] })).find((x) => x.rule === ENUM)!.severity, 'warn');
});

test('tag, operationId glob and kind', async () => {
  assert.ok(summary(await findings({ overrides: [{ match: { tag: 'admin' }, severity: 'error' }] })).includes(`${ENUM} error #/components/schemas/Order [GET /admin/orders]`));
  assert.ok(summary(await findings({ overrides: [{ match: { operationId: 'legacy*' }, severity: 'info' }] })).includes(`${ENUM} info #/components/schemas/Order [GET /legacy/orders]`));
  assert.equal((await findings({ overrides: [{ match: { kind: 'wire' }, severity: 'off' }] })).length, 0);
});

test('the last matching override wins, and overrides beat rules', async () => {
  const fs = await findings({
    rules: { [ENUM]: 'error' },
    overrides: [
      { match: { rule: 'enum-*' }, severity: 'info' },
      { match: { path: '/admin/**' }, rules: { 'operation-removed': 'off' } }, // matches, but says nothing about the enum rule
    ],
  });
  assert.equal(fs.find((f) => f.rule === ENUM)!.severity, 'info');
  const later = await findings({ overrides: [{ match: { rule: 'enum-*' }, severity: 'info' }, { match: { rule: 'enum-*' }, severity: 'error' }] });
  assert.equal(later.find((f) => f.rule === ENUM)!.severitySource, 'policy p.yaml: overrides #2 (rule enum-*)');
});

test('operation keys match a component finding through its impact', async () => {
  assert.deepEqual(await findings({ overrides: [{ match: { path: '/**' }, severity: 'off' }] }), []);
});

test('operation keys never match findings without an operation', async () => {
  const dir = fileURLToPath(new URL('../cases/title-changed/', import.meta.url));
  const r = await compareInputs({ kind: 'fs', arg: 'base.yaml', path: 'base.yaml' }, { kind: 'fs', arg: 'revision.yaml', path: 'revision.yaml' }, dir, { policy: parsePolicy({ overrides: [{ match: { path: '/**' }, severity: 'off' }] }) });
  assert.deepEqual(r.findings.map((f) => f.subject), ['document']);
});

test('glob: * is one path segment, a trailing /** is zero or more', () => {
  assert.ok(glob('/legacy/**', true).test('/legacy'));
  assert.ok(glob('/legacy/**', true).test('/legacy/orders/{id}'));
  assert.ok(!glob('/legacy/**', true).test('/legacyx'));
  assert.ok(glob('/orders/*', true).test('/orders/{id}'));
  assert.ok(!glob('/orders/*', true).test('/orders/{id}/items'));
  assert.ok(glob('admin*').test('adminOrders'));
});

test('overrides are validated', () => {
  const bad = (overrides: unknown, msg: RegExp): void => assert.throws(() => parsePolicy({ overrides }, 'p.yaml'), (e: unknown) => e instanceof PolicyError && msg.test(e.message));
  bad([{ match: { path: '/x' }, severity: 'info', rules: { 'operation-removed': 'off' } }], /overrides\[0\]: set either severity or rules, not both/);
  bad([{ match: { paths: '/x' }, severity: 'info' }], /overrides\[0\]\.match\.paths: unknown match key \(did you mean path\?\)/);
  bad([{ match: { path: 'x' }, severity: 'info' }], /'x' must start with \//);
  bad([{ match: { method: 'fetch' }, severity: 'info' }], /'fetch' is not an HTTP method/);
  bad([{ match: { extension: { audience: 'x' } }, severity: 'info' }], /extension names start with x-/);
  bad([{ match: {}, severity: 'info' }], /must have at least one key/);
  bad([{ severity: 'info' }], /needs match/);
  bad([{ match: { kind: 'wire' }, rules: { 'enum-value-added': { 'honour-open-hint': false } } }], /rule options can't be set in overrides/);
  bad([{ match: { kind: 'wire' }, rules: { 'enum-value-aded': 'info' } }], /unknown rule \(did you mean enum-value-added\?\)/);
  parsePolicy({ overrides: [{ match: { kind: 'wire' }, rules: { 'property-removed': { 'closed-object-severity': 'warn' } } }] });
});

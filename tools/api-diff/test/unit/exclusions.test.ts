// Policy extensions (kinds) and exclusion sets: validation, tagging findings
// with their sets, and the sdk profile. The golden cases
// extension-changed-sdk, extension-changed-wire and exclusion-set-ignored
// cover the main behaviour end to end.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareInputs, compareOpened } from '../../src/engine.ts';
import { parsePolicy, PolicyError } from '../../src/policy/policy.ts';
import { MemorySource } from '../../src/sources/memory.ts';
import type { Finding } from '../../src/types.ts';

const bad = (policy: unknown, msg: RegExp): void => assert.throws(() => parsePolicy(policy, 'p.yaml'), (e: unknown) => e instanceof PolicyError && msg.test(e.message));

test('extensions, exclusions and ignore are validated', () => {
  bad({ extensions: { 'enum-varnames': 'sdk' } }, /extension names start with x-/);
  bad({ extensions: { 'x-go-type': 'sdkk' } }, /must be one of wire, sdk, docs \(did you mean sdk\?\)/);
  bad({ extensions: { 'x-api-diff': 'wire' } }, /x-api-diff configures api-diff and can't be classified/);
  bad({ exclusions: { internal: { path: ['/internal/**'] } } }, /exclusions\.internal\.path: unknown key \(did you mean paths\?\)/);
  bad({ exclusions: { internal: { paths: ['internal'] } } }, /'internal' must start with \//);
  bad({ exclusions: { internal: { extensions: ['internal'] } } }, /'internal' is not an x- extension name/);
  bad({ exclusions: { internal: { paths: ['/i/**'] } }, ignore: ['internl'] }, /ignore: 'internl' is not an exclusion set \(did you mean internal\?\)/);
  parsePolicy({ exclusions: { partner: { extensions: { 'x-audience': ['partner', 'beta-partner'] }, tags: ['partners'], operationIds: ['partner*'], components: ['Partner*'] } } });
});

const doc = (status: string, extra = ''): string => `
openapi: 3.1.0
info: { title: Shop, version: 1.0.0 }
paths:
  /orders:
    get:
      responses: { '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/Order' } } } } }
  /internal/orders:
    get:
      responses: { '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/Order' } } } } }
  /internal/stats:
    get:
      x-audience: internal
      responses: { '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/Stats' } } } } }
components:
  schemas:
    Order: { type: object, properties: { status: { type: string, enum: [${status}] } } }
    Stats: { type: object, properties: { n: { type: string, enum: [${status}] } } }
${extra}
`;

async function run(policy: unknown): Promise<Finding[]> {
  const r = await compareOpened({ source: new MemorySource({ 'a.yaml': doc('a') }), root: 'a.yaml' }, { source: new MemorySource({ 'b.yaml': doc('a, b') }), root: 'b.yaml' }, { policy: parsePolicy(policy) });
  return r.findings;
}

test('findings record the exclusion sets they belong to', async () => {
  const fs = await run({ exclusions: { internal: { paths: ['/internal/**'] }, audience: { extensions: { 'x-audience': 'internal' } } } });
  const order = fs.find((f) => f.subject === '#/components/schemas/Order')!;
  const stats = fs.find((f) => f.subject === '#/components/schemas/Stats')!;
  assert.equal(order.exclusions, undefined); // also used by the public /orders
  assert.deepEqual(stats.exclusions, ['internal', 'audience']); // only used by an internal operation
});

test('an ignored set leaves shared components in for their other operations', async () => {
  const fs = await run({ exclusions: { internal: { paths: ['/internal/**'] } }, ignore: ['internal'] });
  assert.deepEqual(fs.map((f) => `${f.rule} ${f.subject} ${JSON.stringify(f.impact ?? [])}`).sort(), [
    `enum-value-added-in-response #/components/schemas/Order ["GET /orders"]`,
    `not-compared document ["GET /internal/orders","GET /internal/stats"]`,
  ]);
});

test('extension-changed-sdk is warn under --profile sdk; docs-classified extensions stay extension-changed', async () => {
  const dir = fileURLToPath(new URL('../cases/extension-changed-sdk/', import.meta.url));
  const go = async (policy: unknown, profile: 'wire' | 'sdk') => (await compareInputs({ kind: 'fs', arg: 'base.yaml', path: 'base.yaml' }, { kind: 'fs', arg: 'revision.yaml', path: 'revision.yaml' }, dir, { policy: parsePolicy(policy), profile })).findings.map((f) => `${f.rule} ${f.severity}`);
  assert.deepEqual(await go({ extensions: { 'x-enum-varnames': 'sdk' } }, 'sdk'), ['extension-changed-sdk warn']);
  assert.deepEqual(await go({ extensions: { 'x-enum-varnames': 'docs' } }, 'wire'), ['extension-changed info']);
});

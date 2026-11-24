// The changelog report: grouping by tag and operation, entry kinds, notes,
// shared types, and what it leaves out.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareOpened } from '../../src/engine.ts';
import { parsePolicy } from '../../src/policy/policy.ts';
import { changelogData, renderChangelog } from '../../src/render/changelog.ts';
import { viewFor } from '../../src/render/config.ts';
import { renderChangelogHtml } from '../../src/render/html.ts';
import { countFindings, stateOf } from '../../src/engine.ts';
import { MemorySource } from '../../src/sources/memory.ts';
import type { Result } from '../../src/types.ts';

const doc = (v: { version: string; status: string; limit: number; extra?: string; deprecate?: boolean; description?: string }): string => `
openapi: 3.1.0
info: { title: Shop, version: ${v.version} }
paths:
  /orders:
    get:
      tags: [orders]
      summary: List orders
      description: ${v.description ?? 'All orders'}
      parameters: [{ name: limit, in: query, schema: { type: integer, maximum: ${v.limit} } }]
      responses: { '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/Order' } } } } }
  /orders/{id}:
    get:
      tags: [orders]
${v.deprecate ? '      deprecated: true\n' : ''}      responses: { '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/Order' } } } } }
  /internal/sync:
    post:
      tags: [internal]
      responses: { '204': { description: done } }
${v.extra ?? ''}
components:
  schemas:
    Order: { type: object, properties: { status: { type: string, enum: [${v.status}] } } }
`;

async function result(policy: unknown = {}): Promise<Result> {
  const base = doc({ version: '1.0.0', status: 'open', limit: 100 });
  const rev = doc({ version: '2.0.0', status: 'open, closed', limit: 50, deprecate: true, description: 'Every order', extra: '  /refunds: { get: { tags: [refunds], responses: { "200": { description: ok } } } }' }).replace(/  \/internal\/sync:[\s\S]*?done } }\n/, '');
  return compareOpened({ source: new MemorySource({ 'a.yaml': base }), root: 'a.yaml' }, { source: new MemorySource({ 'b.yaml': rev }), root: 'b.yaml' }, { policy: parsePolicy(policy) });
}

test('grouped by tag, then operation; shared types separate; docs and notices left out', async () => {
  const d = changelogData(await result());
  assert.equal(d.title, 'Shop');
  assert.deepEqual([d.from, d.to, d.breaking], ['1.0.0', '2.0.0', 2]);
  assert.deepEqual(d.tags.map((t) => [t.tag, t.operations.map((o) => o.operation)]), [
    ['internal', ['POST /internal/sync']],
    ['orders', ['GET /orders', 'GET /orders/{id}']],
    ['refunds', ['GET /refunds']],
  ]);
  const list = d.tags[1]!.operations[0]!;
  assert.equal(list.summary, 'List orders');
  assert.deepEqual(list.entries.map((e) => [e.kind, e.breaking]), [['changed', true]]);
  assert.equal(list.entries[0]!.note, 'Send the query parameter `limit` within the new limit: `maximum` is now 50 (was 100).');
  assert.deepEqual(d.tags[1]!.operations[1]!.entries.map((e) => e.kind), ['deprecated']);
  assert.deepEqual(d.tags[0]!.operations[0]!.entries.map((e) => [e.kind, e.breaking]), [['removed', true]]);
  assert.deepEqual(d.components.map((c) => [c.component, c.operations, c.entries.length]), [['Order', ['GET /orders', 'GET /orders/{id}'], 1]]);
  assert.equal(d.components[0]!.entries[0]!.note, 'Handle the new `status` value `closed`.');
  const all = JSON.stringify(d);
  assert.doesNotMatch(all, /description-changed|version-|acknowledg/);
});

test('exclusion sets from the policy apply', async () => {
  const policy = { exclusions: { internal: { tags: ['internal'] } }, reports: { changelog: { exclude: ['internal'] } } };
  const r = await result(policy);
  const p = parsePolicy(policy);
  const view = viewFor(r, p.reports.get('changelog'), (fs) => ({ counts: countFindings(fs), state: stateOf(fs) }));
  assert.ok(!changelogData(view).tags.some((t) => t.tag === 'internal'));
});

test('text and HTML', async () => {
  const r = await result();
  const txt = renderChangelog(r);
  assert.match(txt, /^# Shop 1\.0\.0 → 2\.0\.0\n\n\*\*2 breaking changes\.\*\*/);
  assert.match(txt, /^### `GET \/orders`: List orders\n\n- \*\*Changed \(breaking\):\*\* maximum decreased/m);
  assert.match(txt, /^## Shared types\n\n### `Order`\n\nUsed by `GET \/orders`, `GET \/orders\/\{id\}`\./m);
  const html = renderChangelogHtml(r);
  assert.match(html, /<h1>Shop 1\.0\.0 &#x2192; 2\.0\.0<\/h1>/);
  assert.match(html, /Handle the new <code>status<\/code> value <code>closed<\/code>\./);
  assert.doesNotMatch(html, /<script/);
  // Up to 3 operations using a shared type are listed in its header; more fold into a count with one per line.
  assert.match(html, /<span class="aside muted">used by 2 operations: GET \/orders, GET \/orders\/\{id\}<\/span>/);
  const many = Array.from({ length: 3 }, (_, i) => `  /shops/${i}: { get: { tags: [orders], responses: { '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/Order' } } } } } } }`).join('\n');
  const wide = renderChangelogHtml(await compareOpened(
    { source: new MemorySource({ 'a.yaml': doc({ version: '1.0.0', status: 'open', limit: 100, extra: many }) }), root: 'a.yaml' },
    { source: new MemorySource({ 'b.yaml': doc({ version: '2.0.0', status: 'closed', limit: 100, extra: many }) }), root: 'b.yaml' },
  ));
  assert.match(wide, /<span class="aside muted">used by 5 operations<\/span><\/summary><div class="g-ops"><span class="muted">used by<\/span><details class="ops"><summary>5 operations<\/summary><ul class="mono">/);
  assert.equal(wide.match(/<details class="ops">[\s\S]*?<\/details>/)![0].match(/<li>/g)!.length, 5);
});

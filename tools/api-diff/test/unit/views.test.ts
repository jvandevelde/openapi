// Report views that keep only the changes reaching some operations: --uses
// (a consumer's operations), include.extensions and include.owners; and
// group-by for the review report.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { main, type Io } from '../../src/cli/main.ts';
import { compareOpened, countFindings, placesOf, stateOf } from '../../src/engine.ts';
import { checkSupported, parseReports, resolveUses, viewFor } from '../../src/render/config.ts';
import { PolicyError } from '../../src/policy/errors.ts';
import { suggest } from '../../src/policy/policy.ts';
import { MemorySource } from '../../src/sources/memory.ts';
import type { Result } from '../../src/types.ts';

const order = { content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } };
const id = [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }];

function spec(rev: boolean): string {
  const paths: Record<string, unknown> = {
    '/orders': { get: { operationId: 'listOrders', 'x-audience': 'partner', 'x-owner': '@orders', responses: { '200': { description: 'ok', ...order } } } },
    '/admin/{id}': { parameters: id, get: { operationId: 'getAdmin', 'x-owner': '@admin', responses: { '200': { description: 'ok', ...order } } } },
  };
  if (!rev) paths['/orders/{id}'] = { parameters: id, get: { operationId: 'getOrder', 'x-owner': '@orders', responses: { '200': { description: 'ok' } } } };
  return JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Shop', version: '1.0.0' },
    servers: [{ url: rev ? 'https://new.example.com' : 'https://old.example.com' }],
    paths,
    components: { schemas: { Order: { type: 'object', properties: rev ? { id: { type: 'string' } } : { id: { type: 'string' }, note: { type: 'string' } } } } },
  });
}

async function compare(): Promise<Result> {
  return compareOpened({ source: new MemorySource({ 'a.json': spec(false) }), root: 'a.json' }, { source: new MemorySource({ 'b.json': spec(true) }), root: 'b.json' }, { asOf: '2026-11-22' });
}

const recount = (fs: Result['findings']) => ({ counts: countFindings(fs), state: stateOf(fs) });
const summary = (r: Result) => r.findings.filter((f) => !['version-unchanged'].includes(f.rule)).map((f) => `${f.rule} ${f.subject}${f.impact ? ` [${f.impact.join(', ')}]` : ''}`).sort();

test('resolveUses: METHOD /path with any parameter names, or an operationId', async () => {
  const r = await compare();
  const u = resolveUses('# my SDK\nGET /orders/{orderId}\n\ngetAdmin   # comment\nget /orders?limit=1\nPOST /nope\nnoSuchId\n', placesOf(r)?.ctx);
  assert.deepEqual(u.operations, ['GET /admin/{id}', 'GET /orders', 'GET /orders/{id}']);
  assert.deepEqual(u.unmatched, ['POST /nope', 'noSuchId']);
});

test('--uses keeps only changes that reach the operations, narrowing impact lists', async () => {
  const r = await compare();
  assert.deepEqual(summary(r), ['operation-removed GET /orders/{id}', 'property-removed-in-response #/components/schemas/Order [GET /admin/{id}, GET /orders]', 'server-url-changed document']);
  const v = viewFor(r, undefined, recount, { uses: new Set(['GET /admin/{id}']), places: placesOf(r)! });
  assert.deepEqual(summary(v), ['property-removed-in-response #/components/schemas/Order [GET /admin/{id}]', 'server-url-changed document'], 'API-wide changes reach everyone');
  assert.equal(v.counts.bySeverity.error, 1, 'the server change (an error) reaches every consumer; the removed operation is gone');
});

test('include.extensions and include.owners keep changes that reach matching operations', async () => {
  const r = await compare();
  const places = placesOf(r)!;
  const reports = parseReports({ partner: { extends: 'changelog', include: { extensions: { 'x-audience': 'partner' } } }, admin: { extends: 'review', include: { owners: '@admin' } } }, 'reports', [], suggest);
  assert.deepEqual(summary(viewFor(r, reports.get('partner'), recount, { places })), ['property-removed-in-response #/components/schemas/Order [GET /orders]', 'server-url-changed document']);
  assert.deepEqual(summary(viewFor(r, reports.get('admin'), recount, { places })), ['property-removed-in-response #/components/schemas/Order [GET /admin/{id}]', 'server-url-changed document']);
  const orders = viewFor(r, parseReports({ o: { include: { owners: ['@orders'] } } }, 'reports', [], suggest).get('o'), recount, { places });
  assert.deepEqual(summary(orders), ['operation-removed GET /orders/{id}', 'property-removed-in-response #/components/schemas/Order [GET /orders]', 'server-url-changed document']);
});

test('group-by: review and audit can be regrouped; other reports keep their grouping', () => {
  const reports = parseReports({ review: { 'group-by': 'owner' }, changelog: { 'group-by': 'owner' }, audit: { exclude: [] } }, 'reports', [], suggest);
  checkSupported('review', reports.get('review'));
  assert.throws(() => checkSupported('changelog', reports.get('changelog')), (e: unknown) => e instanceof PolicyError && /changelog report always groups by tag; review and audit can be grouped by/.test(e.message));
  assert.throws(() => parseReports({ x: { include: { extensions: {} } } }, 'reports', [], suggest), /include\.extensions: must be a mapping/);
});

async function run(cwd: string, ...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const io: Io = { stdout: { write: (s: string) => (out += s), isTTY: false }, stderr: { write: (s: string) => (err += s) }, env: {} };
  return { code: await main(['-C', cwd, ...argv], io), out, err };
}

test('the CLI: --uses in the header, changelog headline and exit code; review grouped by owner', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'api-diff-views-'));
  try {
    writeFileSync(join(dir, 'base.json'), spec(false));
    writeFileSync(join(dir, 'revision.json'), spec(true));
    writeFileSync(join(dir, 'ops.txt'), 'getAdmin\nPOST /nope\n');
    const review = await run(dir, '--uses', 'ops.txt', '--fail-on', 'error', '--rule', 'server-url-changed=warn', '--rule', 'property-removed=warn', 'base.json', 'revision.json');
    assert.match(review.out, /uses {6}only changes that reach 1 operation listed in ops\.txt \(1 entry matched nothing: POST \/nope\)/);
    assert.doesNotMatch(review.out, /GET \/orders\/\{id\}/);
    assert.match(review.err, /--uses ops\.txt: 1 entry matches no operation in either document: POST \/nope/);
    assert.equal(review.code, 0, 'the removed operation, which fails CI, is not one the consumer uses');
    assert.equal((await run(dir, '--fail-on', 'error', '--rule', 'server-url-changed=warn', '--rule', 'property-removed=warn', 'base.json', 'revision.json')).code, 1);
    const changelog = await run(dir, '--uses', 'ops.txt', '--report', 'changelog', 'base.json', 'revision.json');
    assert.match(changelog.out, /\*\*2 changes affect you \(operations listed in ops\.txt\)\.\*\*/);
    writeFileSync(join(dir, 'api-diff.yaml'), 'reports:\n  review:\n    group-by: owner\n');
    const byOwner = await run(dir, 'base.json', 'revision.json');
    assert.match(byOwner.out, /Changes \(3 owners, 2 with breaking changes\)/);
    assert.match(byOwner.out, /ERROR  @orders  affects 2 operations: GET \/orders, GET \/orders\/\{id\}\n/);
    assert.match(byOwner.out, /ERROR  @admin  affects 1 operation: GET \/admin\/\{id\}\n/);
    assert.match(byOwner.out, /WARN   \(no owner\)\n.*server-url-changed/);
    assert.match((await run(dir, '--uses', 'missing.txt', 'base.json', 'revision.json')).err, /--uses: can't read missing\.txt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

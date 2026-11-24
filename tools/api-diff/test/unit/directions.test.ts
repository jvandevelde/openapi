// A schema change's request and response findings are one entry in the
// review report (text and HTML) and one row in the explore page; the result,
// finding IDs and acknowledgements stay per finding.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareOpened } from '../../src/engine.ts';
import { mergeDirections } from '../../src/render/common.ts';
import { renderExplore } from '../../src/render/explore.ts';
import { renderReviewHtml } from '../../src/render/html.ts';
import { renderReview } from '../../src/render/review.ts';
import { MemorySource } from '../../src/sources/memory.ts';
import type { Acknowledgement } from '../../src/policy/acks.ts';

// Pet is sent (POST) and received (GET): a shorter maxLength is an error for
// requests and info for responses, a new enum value info and warn.
const doc = (max: number, statuses: string[]): string => `openapi: 3.1.0
info: { title: Pets, version: 1.0.0 }
paths:
  /pets:
    get:
      responses:
        '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/Pet' } } } }
    post:
      requestBody: { content: { application/json: { schema: { $ref: '#/components/schemas/Pet' } } } }
      responses:
        '201': { description: created }
components:
  schemas:
    Pet:
      type: object
      properties:
        name: { type: string, maxLength: ${max} }
        status: { type: string, enum: [${statuses.join(', ')}] }
`;

const compare = (acknowledgements?: Acknowledgement[]) =>
  compareOpened({ source: new MemorySource({ 'a.yaml': doc(100, ['available', 'sold']) }), root: 'a.yaml' }, { source: new MemorySource({ 'b.yaml': doc(50, ['available', 'sold', 'adopted']) }), root: 'b.yaml' }, { snippets: true, ...(acknowledgements ? { acknowledgements: { file: 'api-diff.ack.yaml', entries: acknowledgements } } : {}) });

const byRule = (r: Awaited<ReturnType<typeof compare>>, rule: string) => r.findings.find((f) => f.rule === rule)!;

test('the result keeps one finding per direction', async () => {
  const r = await compare();
  for (const rule of ['max-length-decreased-in-request', 'max-length-decreased-in-response', 'enum-value-added-in-request', 'enum-value-added-in-response']) assert.ok(byRule(r, rule), rule);
});

test('each finding records its direction; rules without direction variants have none', async () => {
  const r = await compare();
  for (const f of r.findings) {
    const expected = f.rule.endsWith('-in-request') ? 'in' : f.rule.endsWith('-in-response') ? 'out' : undefined;
    assert.equal(f.direction, expected, f.rule);
  }
  assert.ok(r.findings.some((f) => f.direction === 'in') && r.findings.some((f) => f.direction === 'out'));
  assert.ok(r.findings.some((f) => f.direction === undefined), 'e.g. version-unchanged');
});

test('a readOnly property is judged for responses only', async () => {
  const spec = (values: string[]): string => doc(100, ['available']).replace('    status:', `    id: { type: string, readOnly: true, enum: [${values.join(', ')}] }\n        status:`);
  const r = await compareOpened({ source: new MemorySource({ 'a.yaml': spec(['x']) }), root: 'a.yaml' }, { source: new MemorySource({ 'b.yaml': spec(['x', 'y']) }), root: 'b.yaml' });
  const added = r.findings.filter((f) => f.baseRule === 'enum-value-added');
  assert.deepEqual(added.map((f) => [f.rule, f.direction]), [['enum-value-added-in-response', 'out']]);
});

test('mergeDirections pairs request and response findings of one change, worst first, request listed first', async () => {
  const r = await compare();
  const entries = mergeDirections(r.findings);
  const max = entries.find((e) => e.finding.baseRule === 'max-length-decreased')!;
  assert.deepEqual(max.parts.map((p) => p.rule), ['max-length-decreased-in-request', 'max-length-decreased-in-response']);
  assert.equal(max.finding.severity, 'error');
  const en = entries.find((e) => e.finding.baseRule === 'enum-value-added')!;
  assert.deepEqual(en.parts.map((p) => p.rule), ['enum-value-added-in-request', 'enum-value-added-in-response']);
  assert.equal(en.finding.rule, 'enum-value-added-in-response', 'the warn direction is the worst');
  assert.equal(entries.reduce((n, e) => n + e.parts.length, 0), r.findings.length, 'every finding is in exactly one entry');
});

test('findings in different places, or with different messages, are not merged', async () => {
  const r = await compare();
  const req = byRule(r, 'max-length-decreased-in-request');
  const res = byRule(r, 'max-length-decreased-in-response');
  assert.equal(mergeDirections([req, { ...res, message: 'other wording' }]).length, 2);
  assert.equal(mergeDirections([req, { ...res, revision: { ...res.revision!, pointer: '/elsewhere' } }]).length, 2);
  assert.equal(mergeDirections([req, { ...req, id: 'x' }]).length, 2, 'two findings of the same direction stay apart');
});

test('review text: one entry with the rule without direction, then each direction with its ID', async () => {
  const r = await compare();
  const text = renderReview(r, { color: false });
  const req = byRule(r, 'max-length-decreased-in-request');
  const res = byRule(r, 'max-length-decreased-in-response');
  assert.match(text, /maxLength decreased \(100 → 50\) at \/properties\/name\/maxLength {2}b\.yaml:\d+ · max-length-decreased\n/);
  assert.match(text, new RegExp(`^ {14}request ERROR · id ${req.id} {3}response INFO · id ${res.id}$`, 'm'));
  assert.equal(text.match(/maxLength decreased/g)!.length, 1);
});

test('review text: an acknowledged direction says so, with its direction', async () => {
  const first = await compare();
  const res = byRule(first, 'max-length-decreased-in-response');
  const r = await compare([{ finding: res.id, reason: 'clients ignore it', expires: '2099-01-01' }]);
  assert.match(renderReview(r, { color: false }), /^ {14}response: acknowledged until 2099-01-01: clients ignore it$/m);
});

test('review HTML merges the same way', async () => {
  const r = await compare();
  const html = renderReviewHtml(r);
  assert.equal(html.match(/maxLength decreased/g)!.length, 1);
  assert.match(html, /<code>max-length-decreased<\/code>/);
  for (const rule of ['max-length-decreased-in-request', 'max-length-decreased-in-response']) assert.match(html, new RegExp(`id <code>${byRule(r, rule).id}</code>`));
});

test('explore: one row per change, listing its findings', async () => {
  const r = await compare();
  const data = JSON.parse(renderExplore(r).match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/)![1]!);
  assert.equal(data.findings.length, r.findings.length, 'every finding is still in the data');
  const rows: { parts: number[] }[] = data.rows;
  assert.equal(rows.flatMap((row) => row.parts).length, r.findings.length);
  const rule = (n: number): string => data.findings[n].rule;
  assert.ok(rows.some((row) => row.parts.map(rule).join() === 'max-length-decreased-in-request,max-length-decreased-in-response'));
  assert.ok(rows.some((row) => row.parts.map(rule).join() === 'enum-value-added-in-request,enum-value-added-in-response'));
});

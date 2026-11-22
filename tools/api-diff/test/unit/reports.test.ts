// Reports: --report parsing, several reports from one run, and the review,
// ci and summary views.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { main, type Io } from '../../src/cli/main.ts';
import { compareOpened } from '../../src/engine.ts';
import { parseReportSpec, renderReport, ReportError } from '../../src/render/reports.ts';
import { groupFindings, renderReview } from '../../src/render/review.ts';
import { summaryData } from '../../src/render/summary.ts';
import { MemorySource } from '../../src/sources/memory.ts';
import type { Result } from '../../src/types.ts';

const cases = fileURLToPath(new URL('../cases/', import.meta.url));

async function run(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const io: Io = { stdout: { write: (s: string) => (out += s), isTTY: false }, stderr: { write: (s: string) => (err += s) }, env: {} };
  return { code: await main(argv, io), out, err };
}

test('--report specs', () => {
  assert.deepEqual(parseReportSpec('ci'), { name: 'ci' }); // format from the policy, else txt
  assert.deepEqual(parseReportSpec('review:json:out/r.json'), { name: 'review', format: 'json', file: 'out/r.json' });
  assert.deepEqual(parseReportSpec('summary:txt:-'), { name: 'summary', format: 'txt' });
  assert.deepEqual(parseReportSpec('summary::out.txt'), { name: 'summary', file: 'out.txt' });
  assert.deepEqual(parseReportSpec('summary:txt:C:\\out\\s.txt'), { name: 'summary', format: 'txt', file: 'C:\\out\\s.txt' });
  assert.throws(() => parseReportSpec('changelog'), (e: unknown) => e instanceof ReportError && /changelog arrives in a later milestone/.test(e.message));
  assert.throws(() => parseReportSpec('ci:xml'), (e: unknown) => e instanceof ReportError && /report ci has no xml format; formats: txt, json/.test(e.message));
});

test('several reports from one run, at most one to stdout', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'api-diff-reports-'));
  try {
    const r = await run('-C', `${cases}version-bump-too-small`, '--report', 'ci', '--report', `review:json:${dir}/review.json`, '--report', `summary:txt:${dir}/summary.txt`, 'base.yaml', 'revision.yaml');
    assert.equal(r.code, 0);
    assert.match(r.out, /ERROR\s+DELETE \/pets\/\{id\}\s+operation removed/);
    assert.equal(JSON.parse(readFileSync(join(dir, 'review.json'), 'utf8')).state, 'breaking');
    assert.match(readFileSync(join(dir, 'summary.txt'), 'utf8'), /Size and risk/);
    const two = await run('-C', `${cases}version-bump-too-small`, '--report', 'ci', '--report', 'summary', 'base.yaml', 'revision.yaml');
    assert.equal(two.code, 2);
    assert.match(two.err, /only one --report can write to stdout/);
    assert.match((await run('-C', `${cases}version-bump-too-small`, '--report', 'ci', '-f', 'json', 'base.yaml', 'revision.yaml')).err, /--format and --output set the default report/);
    assert.equal((await run('-C', `${cases}version-bump-too-small`, '--report', 'nope', 'base.yaml', 'revision.yaml')).code, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the header shows versions, labels, the policy and the bump advice', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'api-diff-header-'));
  try {
    for (const f of ['base.yaml', 'revision.yaml']) writeFileSync(join(dir, f), readFileSync(join(cases, 'version-bump-too-small', f)));
    writeFileSync(join(dir, 'api-diff.yaml'), 'profile: wire\n');
    const r = await run('-C', dir, '--revision-label', 'build=845', 'base.yaml', 'revision.yaml');
    assert.match(r.out, /^api-diff \S+ · profile wire · policy api-diff\.yaml \([0-9a-f]{7}\)$/m);
    assert.match(r.out, /^revision  revision\.yaml  \(OpenAPI 3\.1\.0, version 1\.3\.0, build 845\)$/m);
    assert.match(r.out, /^advice    major bump needed \(1 breaking change\); revision is a minor bump \(too small\)$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const shop = (status: string, extra: string): string => `
openapi: 3.1.0
info: { title: Shop, version: 1.0.0 }
paths:
  /orders: { get: { responses: { '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/Order' } } } } } } }
  /orders/{id}: { get: { responses: { '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/Order' } } } } } } }
${extra}
components:
  schemas:
    Order: { type: object, description: ${status === 'a' ? 'An order' : 'One order'}, properties: { status: { type: string, enum: [${status}] }, total: { type: ${status === 'a' ? 'integer' : 'string'} } } }
`;

async function shopResult(): Promise<Result> {
  return compareOpened(
    { source: new MemorySource({ 'a.yaml': shop('a', '  /legacy: { delete: { responses: { "204": { description: gone } } } }') }), root: 'a.yaml' },
    { source: new MemorySource({ 'b.yaml': shop('a, b', '') }), root: 'b.yaml' },
  );
}

test('review: grouped by root cause, worst first, docs collapsed, versions separate, no fix advice', async () => {
  const r = await shopResult();
  const groups = groupFindings(r.findings);
  assert.deepEqual(groups.map((g) => [g.subject, g.severity, g.findings.length]), [
    ['#/components/schemas/Order', 'error', 2],
    ['DELETE /legacy', 'error', 1],
  ]);
  assert.deepEqual(groups[0]!.operations, ['GET /orders', 'GET /orders/{id}']);
  const txt = renderReview(r, { color: false, failOn: 'never' });
  assert.match(txt, /^Version\n  WARN   the spec changed/m);
  assert.match(txt, /^Changes \(2 places, 2 with breaking changes\)$/m);
  assert.match(txt, /^ERROR  #\/components\/schemas\/Order  affects 2 operations: GET \/orders, GET \/orders\/\{id\}$/m);
  assert.match(txt, /^       ERROR  type changed/m); // mixed severities in the group: labels shown
  assert.match(txt, /^Documentation changes \(1\)\n  description-changed ×1  #\/components\/schemas\/Order$/m);
  assert.doesNotMatch(txt, /Fix:|fix/);
});

test('review stays under its size budget and lists what it left out', async () => {
  const r = await shopResult();
  const txt = renderReview(r, { color: false, maxChars: 900 });
  assert.ok(txt.length < 1400, `${txt.length} chars`);
  assert.match(txt, /… 1 more place \(1 finding\), shortened to fit; the JSON and HTML reports have them all:\n  error  DELETE \/legacy \(1 finding\)/);
});

test('ci: warn and above when nothing gates, the threshold when it does, acknowledged left out', async () => {
  const r = await shopResult();
  const quiet = renderReport({ name: 'ci', format: 'txt' }, r, { color: false, failOn: 'never' });
  assert.doesNotMatch(quiet, /description changed/);
  assert.match(quiet, /not failing CI/);
  assert.doesNotMatch(quiet, /FAIL/);
  const gate = renderReport({ name: 'ci', format: 'txt' }, r, { color: false, failOn: 'error' });
  assert.match(gate, /FAIL: 2 findings at error or above/);
  assert.doesNotMatch(gate, /version-unchanged/);
  for (const f of r.findings) if (f.severity === 'error') f.acknowledged = { reason: 'ok', expires: '2099-01-01', file: 'a' };
  assert.match(renderReport({ name: 'ci', format: 'txt' }, r, { color: false, failOn: 'error' }), /No findings at error or above/);
});

test('summary data', async () => {
  const d = summaryData(await shopResult());
  assert.deepEqual(d.places, { total: 2, breaking: 2 });
  assert.equal(d.operationsAffected, 3);
  assert.deepEqual(d.byKindAndSeverity.wire, { error: 2, warn: 1, info: 0 }); // type change + removal; enum value added in a response
  assert.equal(d.byKindAndSeverity.docs.info, 1);
  assert.equal(d.advice?.needed, 'major');
  assert.ok(d.top.every((f) => !f.rule.startsWith('version-')));
});

// Policy `reports` section

import { parsePolicy, PolicyError } from '../../src/policy/policy.ts';
import { viewFor } from '../../src/render/config.ts';
import { countFindings, stateOf } from '../../src/engine.ts';

test('report settings are validated', () => {
  const bad = (policy: unknown, msg: RegExp): void => assert.throws(() => parsePolicy(policy, 'p.yaml'), (e: unknown) => e instanceof PolicyError && msg.test(e.message));
  bad({ reports: { review: { exclude: ['internal'] } } }, /reports\.review\.exclude: 'internal' is not an exclusion set/);
  bad({ reports: { review: { includ: {} } } }, /reports\.review\.includ: unknown key \(did you mean include\?\)/);
  bad({ reports: { review: { include: { kinds: ['api'] } } } }, /include\.kinds: must be wire, sdk or docs/);
  bad({ reports: { review: { 'group-by': 'team' } } }, /group-by: must be one of severity, root-cause/);
  bad({ reports: { mine: { extends: 'reviw' } } }, /mine\.extends: 'reviw' is not a report \(did you mean review\?\)/);
  bad({ reports: { a: { extends: 'b' }, b: { extends: 'a' } } }, /extend each other in a loop \(a → b → a\)/);
  bad({ reports: { review: { extends: 'ci' } } }, /built-in reports can't extend others/);
  parsePolicy({ exclusions: { internal: { paths: ['/internal/**'] } }, reports: { changelog: { exclude: ['internal'], template: './t.html', 'group-by': 'tag' }, partner: { extends: 'changelog' } } });
});

const recount = (fs: Result['findings']) => ({ counts: countFindings(fs), state: stateOf(fs) });

test('a report view leaves out excluded sets and findings outside include; notices stay', async () => {
  const r = await shopResult();
  r.findings.find((f) => f.subject === 'DELETE /legacy')!.exclusions = ['internal'];
  const v = viewFor(r, { exclude: ['internal'], include: { kinds: ['wire'], minSeverity: 'warn' } }, recount);
  assert.ok(!v.findings.some((f) => f.subject === 'DELETE /legacy'));
  assert.ok(!v.findings.some((f) => f.kind === 'docs'));
  assert.ok(v.findings.some((f) => f.rule === 'version-unchanged'));
  assert.equal(v.counts.total, v.findings.length);
  assert.equal(viewFor(r, undefined, recount), r);
});

test('the ci report settings apply to the exit code; unsupported settings are refused when used', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'api-diff-cfg-'));
  try {
    for (const f of ['base.yaml', 'revision.yaml']) writeFileSync(join(dir, f), readFileSync(join(cases, 'operation-removed', f)));
    const policy = (p: string) => writeFileSync(join(dir, 'api-diff.yaml'), p);
    policy('defaults: { fail-on: error }\nexclusions: { legacy: { paths: ["/pets/**"] } }\nreports: { ci: { exclude: [legacy] } }\n');
    assert.equal((await run('-C', dir, '--report', 'ci', 'base.yaml', 'revision.yaml')).code, 0);
    policy('defaults: { fail-on: error }\nreports: { summary: { format: json } }\n');
    const s = await run('-C', dir, '--report', 'summary', 'base.yaml', 'revision.yaml');
    assert.equal(JSON.parse(s.out).report, 'summary');
    assert.equal(s.code, 1);
    policy('reports: { review: { template: ./t.html } }\n');
    const t = await run('-C', dir, 'base.yaml', 'revision.yaml');
    assert.equal(t.code, 2);
    assert.match(t.err, /reports\.review\.template: report templates arrive in M9/);
    assert.equal((await run('-C', dir, '--report', 'ci', 'base.yaml', 'revision.yaml')).code, 0); // review's settings don't matter here
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// HTML

import { renderReviewHtml, renderSummaryHtml } from '../../src/render/html.ts';

test('HTML reports are self-contained and escape everything from the spec', async () => {
  const r = await shopResult();
  r.findings[0]!.message = '<script>alert(1)</script> & "quotes"';
  for (const html of [renderReviewHtml(r), renderSummaryHtml(r)]) {
    assert.match(html, /^<!doctype html>/);
    assert.doesNotMatch(html, /<script|<link|src=|https?:\/\//);
    assert.match(html, /prefers-color-scheme: dark/);
  }
  const review = renderReviewHtml(r);
  assert.match(review, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quotes&quot;/);
  assert.match(review, /<h2>Changes <span class="muted">\(2 places, 2 with breaking changes\)<\/span><\/h2>/);
  assert.match(review, /<h2>Version<\/h2>/);
  assert.match(review, /<h2>Documentation changes/);
  assert.match(renderSummaryHtml(r), /<h2>Size and risk<\/h2><p>2 places changed, 2 with breaking changes; 3 operations affected\.<\/p>/);
  assert.match((await run('-C', `${cases}operation-removed`, '-f', 'html', 'base.yaml', 'revision.yaml')).out, /<title>api-diff review<\/title>/);
  assert.equal((await run('-C', `${cases}operation-removed`, '--report', 'ci:html', 'base.yaml', 'revision.yaml')).code, 2);
});

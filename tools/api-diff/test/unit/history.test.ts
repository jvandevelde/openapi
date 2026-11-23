// History mode: steps from first-parent commits that changed the spec or a
// file it $refs, skipped unrelated commits, revert links, commit details and
// the net result.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { main, type Io } from '../../src/cli/main.ts';
import { history, prNumber } from '../../src/history.ts';
import { renderTimeline, renderTimelineHtml, timelineData } from '../../src/render/timeline.ts';
import type { History, Step } from '../../src/history.ts';
import type { Finding, Result } from '../../src/types.ts';

let dir = '';
const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } }).trim();
const DEL = '  /pets/{id}: { delete: { responses: { "204": { description: gone } } } }';
const spec = (version: string, status: string, extra: string): void =>
  writeFileSync(join(dir, 'openapi.yaml'), `openapi: 3.1.0
info: { title: Pets, version: ${version} }
paths:
  /pets:
    get:
      parameters: [{ name: status, in: query, schema: { type: string, enum: [${status}] } }]
      responses: { '200': { description: ok, content: { application/json: { schema: { $ref: './schemas/pet.yaml' } } } } }
${extra}
`);

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'api-diff-history-'));
  git('init', '-q', '-b', 'main');
  mkdirSync(join(dir, 'schemas'));
  writeFileSync(join(dir, 'schemas/pet.yaml'), 'type: object\nproperties:\n  name: { type: string, maxLength: 50 }\n');
  spec('1.0.0', 'available', DEL);
  git('add', '-A');
  git('commit', '-qm', 'Initial API');
  git('tag', 'v1.0.0');
  spec('1.1.0', 'available, adopted', DEL);
  git('commit', '-qam', 'Add adopted status (#1)');
  writeFileSync(join(dir, 'README.md'), 'hi\n');
  git('add', '-A');
  git('commit', '-qm', 'Docs only');
  spec('2.0.0', 'available, adopted', '');
  git('commit', '-qam', 'Remove delete (#2)');
  git('tag', 'v2.0.0');
  spec('2.0.1', 'available, adopted', DEL);
  git('commit', '-qam', 'Revert "Remove delete" (#3)');
  writeFileSync(join(dir, 'schemas/pet.yaml'), 'type: object\nproperties:\n  name: { type: string, maxLength: 40 }\n');
  git('commit', '-qam', 'Shorter names (#4)');
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('steps, skipped commits, reverts and the net result', async () => {
  const h = await history('v1.0.0..HEAD', 'openapi.yaml', dir, { asOf: '2026-11-22' });
  assert.deepEqual(h.steps.map((s) => [s.pr, s.subject]), [[1, 'Add adopted status (#1)'], [2, 'Remove delete (#2)'], [3, 'Revert "Remove delete" (#3)'], [4, 'Shorter names (#4)']]);
  assert.deepEqual(h.steps[1]!.tags, ['v2.0.0']);
  assert.deepEqual(h.steps[0]!.versions, { base: '1.0.0', revision: '1.1.0' });
  assert.equal(h.links.length, 1);
  assert.deepEqual([h.links[0]!.step, h.links[0]!.revertedIn], [1, 2]);
  assert.ok(h.steps[3]!.result.findings.some((f) => f.baseRule === 'max-length-decreased'), 'a change in a $ref file is a step');
  assert.ok(!h.net.findings.some((f) => f.baseRule === 'operation-removed'), 'a reverted removal is not in the net result');
  const txt = renderTimeline(h);
  assert.match(txt, /#2 Remove delete  1\.1\.0 → 2\.0\.0\n {12}ERROR  DELETE \/pets\/\{id\}  operation removed  ↺ reverted in #3/);
  assert.match(txt, /^── tag v2\.0\.0 /m);
  assert.match(txt, /\(1 change reverted within the range\)/);
  const data = timelineData(h) as { steps: { findings: { id: string }[] }[] };
  assert.deepEqual(data.steps.map((s) => s.findings.length), h.steps.map((s) => s.result.findings.length));
});

test('options: --max-steps keeps the latest steps, --tags-only keeps tagged ones', async () => {
  const last2 = await history('v1.0.0..HEAD', 'openapi.yaml', dir, { maxSteps: 2 });
  assert.deepEqual([last2.omitted, last2.steps.map((s) => s.pr)], [2, [3, 4]]);
  const tagged = await history('v1.0.0..HEAD', 'openapi.yaml', dir, { tagsOnly: true });
  assert.deepEqual(tagged.steps.map((s) => s.pr), [2, 4]); // the v2.0.0 commit, and the end of the range
});

async function run(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const io: Io = { stdout: { write: (s: string) => (out += s), isTTY: false }, stderr: { write: (s: string) => (err += s) }, env: {} };
  return { code: await main(argv, io), out, err };
}

test('the CLI', async () => {
  const r = await run('history', '-C', dir, 'v1.0.0..HEAD', 'openapi.yaml', '--report', 'timeline:json');
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).steps.length, 4);
  assert.match((await run('history', '-C', dir, 'v1.0.0..HEAD', 'openapi.yaml', '--report', 'timeline:html')).out, /<h1>History of <code>openapi\.yaml<\/code><\/h1>/);
  assert.equal((await run('history', '-C', dir, 'v1.0.0', 'openapi.yaml')).code, 2);
  assert.equal((await run('history', '-C', dir, 'v1.0.0..HEAD', 'openapi.yaml', '--max-steps', '0')).code, 2);
});

test('options before the subcommand, --no-color and --help', async () => {
  const plain = (await run('history', '-C', dir, 'v1.0.0..HEAD', 'openapi.yaml')).out;
  assert.equal((await run('-C', dir, '--no-color', 'history', 'v1.0.0..HEAD', 'openapi.yaml')).out, plain);
  assert.equal((await run('history', '-C', dir, 'v1.0.0..HEAD', 'openapi.yaml', '--no-color')).out, plain);
  assert.match((await run('history', '--help')).out, /^api-diff \S+: compare two OpenAPI documents/);
});

test('PR numbers from merge commits and squash subjects', () => {
  assert.equal(prNumber('Merge pull request #42 from me/branch'), 42);
  assert.equal(prNumber('Add refunds (#7)'), 7);
  assert.equal(prNumber('Fix #7 in docs'), undefined);
});

test('the timeline HTML links findings into the spec explorer when asked', async () => {
  const r = await run('history', '-C', dir, 'v1.0.0..HEAD', 'openapi.yaml', '--report', 'timeline:html', '--explorer-url', 'https://explorer.test/#{side}{pointer}');
  assert.match(r.out, /"links":\{"base":"https:\/\/explorer\.test\/#base%2Fpaths/);
  assert.equal((await run('history', '-C', dir, 'v1.0.0..HEAD', 'openapi.yaml', '--explorer-url', 'nope')).code, 2);
});

// Synthetic steps, for what the timeline shows rather than how history finds steps.
const finding = (id: string, rule: string, severity: 'error' | 'warn' | 'info', message: string, subject = '#/components/schemas/Pet'): Finding =>
  ({ id, rule, baseRule: rule.replace(/-in-(request|response)$/, ''), kind: 'wire', severity, severitySource: 'default', subject, message, revision: { file: 'openapi.yaml', pointer: '/components/schemas/Pet/properties/name/maxLength', line: 9 }, details: {} }) as Finding;
const step = (n: number, findings: Finding[]): Step =>
  ({ commit: `${n}`.repeat(40), date: `2026-09-0${n}`, author: 't', subject: `Step ${n} (#${n})`, pr: n, tags: [], versions: { base: `1.${n - 1}.0`, revision: `1.${n}.0` }, result: { findings, state: 'breaking' } as unknown as Result });
const synthetic = (steps: Step[]): History =>
  ({ report: 'history', spec: 'openapi.yaml', range: { start: { rev: 'v1', commit: 'a'.repeat(40) }, end: { rev: 'HEAD', commit: 'b'.repeat(40) } }, steps, omitted: 0, links: [], net: { findings: [], counts: { total: 0 } } as unknown as Result });

test('each step keeps its own finding records, even when a finding ID comes up in several steps', () => {
  // A version check has the same ID in every step (same kind, same place), with different details.
  const h = synthetic([step(1, [finding('fbaf54d000d4', 'version-bump-too-small', 'warn', 'version went from 1.0.0 to 1.1.0', 'document')]), step(2, [finding('fbaf54d000d4', 'version-bump-too-small', 'warn', 'version went from 1.1.0 to 1.2.0', 'document')])]);
  const data = timelineData(h) as { steps: { findings: { id: string; message: string }[] }[] };
  assert.deepEqual(data.steps.map((s) => s.findings.map((f) => f.message)), [['version went from 1.0.0 to 1.1.0'], ['version went from 1.1.0 to 1.2.0']]);
  const html = renderTimelineHtml(h);
  for (const m of ['1.0.0 to 1.1.0', '1.1.0 to 1.2.0']) assert.match(html, new RegExp(m));
});

test('a change reported for requests and responses is one timeline line, with its worst severity', () => {
  const h = synthetic([step(1, [finding('aaaaaaaaaaaa', 'max-length-decreased-in-request', 'error', 'maxLength decreased (100 → 50)'), finding('bbbbbbbbbbbb', 'max-length-decreased-in-response', 'info', 'maxLength decreased (100 → 50)')])]);
  const txt = renderTimeline(h);
  assert.equal(txt.match(/maxLength decreased/g)!.length, 1);
  assert.match(txt, /ERROR {2}#\/components\/schemas\/Pet {2}maxLength decreased \(100 → 50\) {2}\(request ERROR, response INFO\)/);
});

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
import { renderTimeline, timelineData } from '../../src/render/timeline.ts';

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
  const data = timelineData(h) as { steps: { findings: string[] }[]; findings: Record<string, unknown> };
  assert.ok(data.steps.every((s) => s.findings.every((id) => id in data.findings)));
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

test('PR numbers from merge commits and squash subjects', () => {
  assert.equal(prNumber('Merge pull request #42 from me/branch'), 42);
  assert.equal(prNumber('Add refunds (#7)'), 7);
  assert.equal(prNumber('Fix #7 in docs'), undefined);
});

// Release-to-release timelines: --tags-only with an optional glob, tags on
// commits that didn't change the spec, releases without API changes, and the
// end of the range as a last step when it isn't a matching tag.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { main, type Io } from '../../src/cli/main.ts';
import { history, tagGlob } from '../../src/history.ts';
import { renderTimeline } from '../../src/render/timeline.ts';

let dir = '';
const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } }).trim();
const spec = (version: string, statuses: string): void =>
  writeFileSync(join(dir, 'openapi.yaml'), `openapi: 3.1.0
info: { title: Pets, version: ${version} }
paths:
  /pets:
    get:
      parameters: [{ name: status, in: query, schema: { type: string, enum: [${statuses}] } }]
      responses: { '200': { description: ok } }
`);
const notes = (text: string): void => writeFileSync(join(dir, 'CHANGELOG.md'), text);

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'api-diff-history-tags-'));
  git('init', '-q', '-b', 'main');
  spec('1.0.0', 'a');
  notes('1.0.0\n');
  git('add', '-A');
  git('commit', '-qm', 'Initial API');
  git('tag', 'v1.0.0');
  spec('1.1.0', 'a, b');
  git('commit', '-qam', 'Add b (#1)');
  notes('1.1.0\n');
  git('commit', '-qam', 'Release notes for 1.1.0'); // the release tag is on a commit that doesn't touch the spec
  git('tag', 'v1.1.0');
  notes('1.1.1\n');
  git('commit', '-qam', 'Patch release, no API change');
  git('tag', 'v1.1.1');
  spec('1.2.0', 'a, b, c');
  git('commit', '-qam', 'Add c (#2)');
  git('tag', 'v1.2.0-rc.1');
  spec('1.2.0', 'a, b, c, d');
  git('commit', '-qam', 'Add d (#3)'); // HEAD: untagged, and the spec changed after the last tag
});
after(() => rmSync(dir, { recursive: true, force: true }));

const label = (s: { tags: string[]; end?: string }): string => s.end ? `end ${s.end}` : s.tags.join(',');

test('--tags-only: every tagged commit is a step, even one that did not change the spec; then the untagged end', async () => {
  const h = await history('v1.0.0..HEAD', 'openapi.yaml', dir, { tagsOnly: true });
  assert.deepEqual(h.steps.map(label), ['v1.1.0', 'v1.1.1', 'v1.2.0-rc.1', 'end HEAD']);
  assert.ok(h.steps[0]!.result.findings.some((f) => f.baseRule === 'enum-value-added'), 'the change made before the release-notes commit is in its step');
  assert.equal(h.steps[1]!.result.findings.filter((f) => f.kind !== 'docs' && f.baseRule !== 'version-unchanged').length, 0, 'a release without API changes is still a step');
  const txt = renderTimeline(h);
  assert.match(txt, /Patch release, no API change\n {12}no API changes\n── tag v1\.1\.1 /);
  assert.match(txt, /^── HEAD \(end of range, no matching tag\) ─+$/m);
});

test('--tags-only=<glob> keeps matching tags only', async () => {
  assert.deepEqual((await history('v1.0.0..HEAD', 'openapi.yaml', dir, { tagsOnly: 'v*' })).steps.map(label), ['v1.1.0', 'v1.1.1', 'v1.2.0-rc.1', 'end HEAD']);
  assert.deepEqual((await history('v1.0.0..HEAD', 'openapi.yaml', dir, { tagsOnly: 'v[0-9].[0-9].[0-9]' })).steps.map(label), ['v1.1.0', 'v1.1.1', 'end HEAD']);
  assert.deepEqual((await history('v1.0.0..HEAD', 'openapi.yaml', dir, { tagsOnly: 'nothing-*' })).steps.map(label), ['end HEAD']);
});

test('--no-end stops at the last matching tag; an end that is a matching tag, or unchanged, adds no extra step', async () => {
  assert.deepEqual((await history('v1.0.0..HEAD', 'openapi.yaml', dir, { tagsOnly: true, noEnd: true })).steps.map(label), ['v1.1.0', 'v1.1.1', 'v1.2.0-rc.1']);
  assert.deepEqual((await history('v1.0.0..v1.2.0-rc.1', 'openapi.yaml', dir, { tagsOnly: true })).steps.map(label), ['v1.1.0', 'v1.1.1', 'v1.2.0-rc.1']);
  assert.deepEqual((await history('v1.0.0..v1.1.1', 'openapi.yaml', dir, { tagsOnly: 'v1.1.0' })).steps.map(label), ['v1.1.0'], 'the end has the same spec as the last tag');
});

test('tagGlob follows git-style globs', () => {
  const m = (p: string, t: string): boolean => tagGlob(p).test(t);
  assert.ok(m('v*', 'v1.2.3') && !m('v*', 'release-1'));
  assert.ok(m('v?.?.?', 'v1.2.3') && !m('v?.?.?', 'v1.2.30'));
  assert.ok(m('v[0-9].[0-9].[0-9]', 'v1.2.3') && !m('v[0-9].[0-9].[0-9]', 'v1.2.0-rc.1'));
  assert.ok(m('v[!0]*', 'v1.0') && !m('v[!0]*', 'v0.9'));
  assert.ok(m('a.b+c', 'a.b+c') && !m('a.b+c', 'axb+c'), 'regex characters are literal');
});

async function run(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const io: Io = { stdout: { write: (s: string) => (out += s), isTTY: false }, stderr: { write: (s: string) => (err += s) }, env: {} };
  return { code: await main(argv, io), out, err };
}

test('the CLI: --tags-only alone or with =<glob>, and --no-end', async () => {
  const steps = async (...args: string[]) => JSON.parse((await run('history', '-C', dir, 'v1.0.0..HEAD', 'openapi.yaml', '--report', 'timeline:json', ...args)).out).steps.map(label);
  assert.deepEqual(await steps('--tags-only'), ['v1.1.0', 'v1.1.1', 'v1.2.0-rc.1', 'end HEAD']);
  assert.deepEqual(await steps('--tags-only=v[0-9].[0-9].[0-9]', '--no-end'), ['v1.1.0', 'v1.1.1']);
  assert.equal((await run('history', '-C', dir, 'v1.0.0..HEAD', 'openapi.yaml', '--no-end')).code, 2);
  assert.equal((await run('history', '-C', dir, 'v1.0.0..HEAD', 'openapi.yaml', '--tags-only=')).code, 2);
});

// Git inputs against real temporary repositories.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { compareInputs } from '../../src/engine.ts';
import { inputsFromArgs, parseInput } from '../../src/sources/input.ts';

let root: string;
let repo: string;

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } }).trim();

const spec = (params: string): string => `openapi: 3.1.0
info: { title: t, version: '1' }
paths:
  /pets:
    get:
      parameters:
        - $ref: './params.yaml#/Limit'
${params}
      responses: { '200': { description: ok } }
`;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'api-diff-git-'));
  repo = join(root, 'repo');
  mkdirSync(join(repo, 'api'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'api', 'openapi.yaml'), spec(''));
  writeFileSync(join(repo, 'api', 'params.yaml'), 'Limit: { name: limit, in: query, schema: { type: integer } }\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'v1');
  // v2 on a branch: limit becomes required (in the referenced file), and a new query parameter.
  git(repo, 'checkout', '-q', '-b', 'feature');
  writeFileSync(join(repo, 'api', 'params.yaml'), 'Limit: { name: limit, in: query, required: true, schema: { type: integer } }\n');
  writeFileSync(join(repo, 'api', 'openapi.yaml'), spec("        - { name: q, in: query, schema: { type: string } }"));
  git(repo, 'commit', '-q', '-am', 'v2');
  // Meanwhile main moves on with an unrelated change.
  git(repo, 'checkout', '-q', 'main');
  writeFileSync(join(repo, 'README'), 'x\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'docs');
  git(repo, 'checkout', '-q', 'feature');
});

after(() => rmSync(root, { recursive: true, force: true }));

const rules = (r: { findings: { rule: string }[] }): string[] => r.findings.map((f) => f.rule).filter((x) => !x.startsWith('version-')).sort(); // version checks have their own tests

test('rev:path reads the file and its $ref files at that revision', async () => {
  const r = await compareInputs(parseInput('main:api/openapi.yaml', repo), parseInput('api/openapi.yaml', repo), repo);
  assert.deepEqual(rules(r), ['query-parameter-added-optional', 'query-parameter-became-required']);
  assert.equal(r.compared.base.file, 'main:api/openapi.yaml');
  assert.match(r.compared.base.commit ?? '', /^[0-9a-f]{40}$/);
  const f = r.findings.find((x) => x.rule === 'query-parameter-became-required')!;
  assert.equal(f.base?.file, 'main:api/params.yaml');
  assert.equal(f.revision?.file, 'api/params.yaml');
});

test('paths are relative to the current directory, like git show rev:./path', async () => {
  const api = join(repo, 'api');
  const r = await compareInputs(parseInput('main:openapi.yaml', api), parseInput('openapi.yaml', api), api);
  assert.equal(r.compared.base.file, 'main:openapi.yaml');
  assert.equal(rules(r).length, 2);
});

test('--base main... compares against the merge-base, not the tip of main', async () => {
  const [b, v] = inputsFromArgs(['api/openapi.yaml'], { base: 'main...' }, repo);
  const r = await compareInputs(b, v, repo);
  const mergeBase = git(repo, 'merge-base', 'main', 'feature');
  assert.equal(r.compared.base.commit, mergeBase);
  assert.notEqual(mergeBase, git(repo, 'rev-parse', 'main'));
});

test('two revisions of the same file', async () => {
  const [b, v] = inputsFromArgs(['api/openapi.yaml'], { base: 'HEAD~1', revision: 'HEAD' }, repo);
  const r = await compareInputs(b, v, repo);
  assert.deepEqual(rules(r), ['query-parameter-added-optional', 'query-parameter-became-required']);
});

test(':path reads the staged version', async () => {
  writeFileSync(join(repo, 'api', 'openapi.yaml'), spec('        - { name: x, in: header, required: true, schema: { type: string } }'));
  git(repo, 'add', 'api/openapi.yaml');
  try {
    const r = await compareInputs(parseInput('HEAD:api/openapi.yaml', repo), parseInput(':api/openapi.yaml', repo), repo);
    assert.deepEqual(rules(r), ['header-parameter-added-required', 'query-parameter-removed']);
  } finally {
    git(repo, 'reset', '-q', '--hard');
  }
});

test('a missing file or bad revision is a clear error', async () => {
  await assert.rejects(compareInputs(parseInput('nope:api/openapi.yaml', repo), parseInput('api/openapi.yaml', repo), repo), /is not a file, and 'nope' is not a git revision/);
  await assert.rejects(compareInputs(parseInput('main:api/missing.yaml', repo), parseInput('api/openapi.yaml', repo), repo), /doesn't exist at that revision/);
  await assert.rejects(compareInputs(parseInput('--upload-pack=x:api/openapi.yaml', repo), parseInput('api/openapi.yaml', repo), repo), /invalid revision/);
});

test('a shallow clone without the base commit explains how to fetch it', async () => {
  const shallow = join(root, 'shallow');
  git(root, 'clone', '-q', '--depth', '1', '--branch', 'feature', `file://${repo}`, shallow);
  const base = git(repo, 'rev-parse', 'main~1');
  await assert.rejects(compareInputs(parseInput(`${base}:api/openapi.yaml`, shallow), parseInput('api/openapi.yaml', shallow), shallow), /shallow clone.*fetch-depth: 0/s);
});

test('each side can come from a different repository', async () => {
  const other = join(root, 'other');
  mkdirSync(other);
  git(other, 'init', '-q', '-b', 'main');
  writeFileSync(join(other, 'openapi.yaml'), 'openapi: 3.1.0\ninfo: { title: o, version: "1" }\npaths: {}\n');
  git(other, 'add', '.');
  git(other, 'commit', '-q', '-m', 'o');
  const r = await compareInputs(parseInput('main:../other/openapi.yaml', repo), parseInput('api/openapi.yaml', repo), repo);
  assert.equal(r.compared.base.file, 'main:../other/openapi.yaml');
  assert.deepEqual(rules(r), ['operation-added', 'title-changed']);
});

test('parseInput prefers an existing file and never reads a drive letter as a revision', () => {
  writeFileSync(join(root, 'a:b.yaml'), 'x');
  assert.equal(parseInput('a:b.yaml', root).kind, 'fs');
  assert.equal(parseInput('C:\\specs\\api.yaml', root).kind, 'fs');
  assert.deepEqual(parseInput('main:api.yaml', root), { kind: 'git', arg: 'main:api.yaml', rev: 'main', path: 'api.yaml' });
  assert.deepEqual(parseInput(':api.yaml', root), { kind: 'git', arg: ':api.yaml', rev: '', path: 'api.yaml' });
});

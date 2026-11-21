// Versions: policy sources, labels, CLI values and the schemes. The golden
// cases version-* cover the checks end to end.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { main, type Io } from '../../src/cli/main.ts';
import { parseSemver, readSource } from '../../src/diff/versions.ts';
import { compareOpened } from '../../src/engine.ts';
import { parsePolicy, PolicyError } from '../../src/policy/policy.ts';
import { MemorySource } from '../../src/sources/memory.ts';

test('version sources and schemes are validated', () => {
  const bad = (policy: unknown, msg: RegExp): void => assert.throws(() => parsePolicy(policy, 'p.yaml'), (e: unknown) => e instanceof PolicyError && msg.test(e.message));
  bad({ versions: { primary: { from: ['version'] } } }, /primary\.from\[0\]: must be info\.<field>, an x- extension/);
  bad({ versions: { labels: { build: 'build-id' } } }, /labels\.build: must be info\.<field>/);
  bad({ versions: { primry: {} } }, /versions takes primary and labels/);
  bad({ rules: { 'version-unchanged': { scheme: 'date' } } }, /scheme: must be semver, calver or none/);
  parsePolicy({ versions: { primary: { from: ['x-api-version', 'info.version', '/info/x-meta/version'] }, labels: { commit: 'x-git.sha' } } });
});

test('sources: info fields, nested extensions and JSON Pointers', () => {
  const doc = { info: { version: '1.0.0', 'x-meta': { version: '7' } }, 'x-git': { sha: 'abc' }, 'x-build-id': 8812 };
  assert.equal(readSource(doc, 'info.version'), '1.0.0');
  assert.equal(readSource(doc, 'x-git.sha'), 'abc');
  assert.equal(readSource(doc, 'x-build-id'), '8812');
  assert.equal(readSource(doc, '/info/x-meta/version'), '7');
  assert.equal(readSource(doc, 'x-missing'), undefined);
});

test('semver parsing', () => {
  assert.deepEqual(parseSemver('v1.2.3'), { major: 1, minor: 2, patch: 3 });
  assert.deepEqual(parseSemver('2.0.0-rc.1+b5'), { major: 2, minor: 0, patch: 0 });
  assert.equal(parseSemver('2024.11'), undefined);
  assert.equal(parseSemver('01.2.3'), undefined);
});

const doc = (version: string, extra = '', description = 'Pets'): string => `
openapi: 3.1.0
${extra}
info: { title: Pets, version: '${version}', description: ${description} }
paths:
  /pets: { get: { responses: { '200': { description: ok } } } }
`;

async function rules(a: string, b: string, policy: unknown = {}): Promise<string[]> {
  const r = await compareOpened({ source: new MemorySource({ 'a.yaml': a }), root: 'a.yaml' }, { source: new MemorySource({ 'b.yaml': b }), root: 'b.yaml' }, { policy: parsePolicy(policy) });
  return r.findings.map((f) => `${f.rule} ${f.severity}`).sort();
}

test('docs-only changes need a patch bump', async () => {
  assert.deepEqual(await rules(doc('1.0.0'), doc('1.0.1', '', 'Pet store')), ['description-changed info']);
  assert.deepEqual(await rules(doc('1.0.0'), doc('1.0.0', '', 'Pet store')), ['description-changed info', 'version-unchanged warn']);
});

test('schemes: calver checks only version-unchanged, none turns both off, non-semver is a notice', async () => {
  assert.deepEqual(await rules(doc('2026.10'), doc('2026.11', '', 'Pet store')), ['description-changed info', 'not-compared info']);
  assert.deepEqual(await rules(doc('2026.10'), doc('2026.11', '', 'Pet store'), { rules: { 'version-bump-too-small': { scheme: 'calver' } } }), ['description-changed info']);
  assert.deepEqual(await rules(doc('2026.10'), doc('2026.10', '', 'Pet store'), { rules: { 'version-unchanged': { scheme: 'calver' } } }), ['description-changed info', 'version-unchanged warn']);
  assert.deepEqual(await rules(doc('1.0.0'), doc('1.0.0', '', 'Pet store'), { rules: { 'version-unchanged': { scheme: 'none' } } }), ['description-changed info']);
});

test('no changes, no version findings', async () => {
  assert.deepEqual(await rules(doc('1.0.0'), doc('1.0.0')), []);
});

async function run(...argv: string[]): Promise<{ code: number; out: string }> {
  let out = '';
  const io: Io = { stdout: { write: (s: string) => (out += s), isTTY: false }, stderr: { write: () => {} }, env: {} };
  return { code: await main(argv, io), out };
}

test('--base-version, --revision-version and labels beat the documents', async () => {
  const dir = fileURLToPath(new URL('../cases/version-unchanged/', import.meta.url));
  const r = JSON.parse((await run('-C', dir, '--no-policy', '-f', 'json', '--base-version', '1.0.0', '--revision-version', '1.1.0', '--revision-label', 'build=8812', 'base.yaml', 'revision.yaml')).out);
  assert.equal(r.compared.revision.version, '1.1.0');
  assert.equal(r.compared.revision.versionSource, 'command line');
  assert.deepEqual(r.compared.revision.labels, { build: '8812' });
  assert.equal(r.compared.base.versionSource, 'command line');
  assert.ok(!r.findings.some((f: { rule: string }) => f.rule.startsWith('version-')));
  const txt = (await run('-C', dir, '--no-policy', '--revision-label', 'build=8812', 'base.yaml', 'revision.yaml')).out;
  assert.match(txt, /revision\s+revision\.yaml\s+\(OpenAPI 3\.1\.0, version 1\.0\.0, build 8812\)/);
});

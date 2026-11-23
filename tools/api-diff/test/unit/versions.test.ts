// Versions: policy sources, labels, CLI values and the schemes. The golden
// cases version-* cover the checks end to end.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { main, type Io } from '../../src/cli/main.ts';
import { parseSemver, readSource, tagVersion } from '../../src/diff/versions.ts';
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

// Only configured sources count, and git-tag[:<glob>] reads tags on the commit
// (decision record: versions from git tags, and no silent info.version fallback).

/** A memory source whose "commit" carries these tags, like a git source. */
class TaggedSource extends MemorySource {
  readonly #tags: string[];
  constructor(files: Record<string, string>, tags: string[]) {
    super(files);
    this.#tags = tags;
  }
  async tagsAt(): Promise<string[]> {
    return this.#tags;
  }
}

const api = (version: string, required: boolean): string => `openapi: 3.1.0
info: { title: Pets, version: '${version}' }
paths:
  /pets:
    get:
      parameters: [{ name: limit, in: query, required: ${required}, schema: { type: integer } }]
      responses: { '200': { description: ok } }
`;
const compareWith = (policy: unknown, a: { version: string; tags?: string[] }, b: { version: string; tags?: string[] }) =>
  compareOpened(
    { source: a.tags ? new TaggedSource({ 'a.yaml': api(a.version, false) }, a.tags) : new MemorySource({ 'a.yaml': api(a.version, false) }), root: 'a.yaml' },
    { source: b.tags ? new TaggedSource({ 'b.yaml': api(b.version, true) }, b.tags) : new MemorySource({ 'b.yaml': api(b.version, true) }), root: 'b.yaml' },
    { policy: parsePolicy(policy) },
  );

test('when no configured source is present the version is unknown, with a notice instead of a silent info.version', async () => {
  const r = await compareWith({ versions: { primary: { from: ['x-api-version'] } } }, { version: '1.0.0' }, { version: '1.0.0' });
  assert.equal(r.compared.base.version, 'unknown');
  assert.equal(r.compared.base.versionSource, undefined);
  assert.ok(!r.findings.some((f) => f.baseRule === 'version-unchanged'), 'info.version was not configured, so it is not compared');
  const notice = r.findings.find((f) => f.rule === 'not-compared' && f.details.name === 'version-checks')!;
  assert.match(notice.message, /no version for the base and revision; tried x-api-version/);
  // With scheme none on both checks there is nothing to skip, so no notice.
  const none = await compareWith({ versions: { primary: { from: ['x-api-version'] } }, rules: { 'version-unchanged': { scheme: 'none' }, 'version-bump-too-small': { scheme: 'none' } } }, { version: '1.0.0' }, { version: '1.0.0' });
  assert.ok(!none.findings.some((f) => f.details.name === 'version-checks'));
});

test('git-tag sources: validated, the matching tag on the commit, then the next source', async () => {
  parsePolicy({ versions: { primary: { from: ['git-tag', 'git-tag:v[0-9]*', 'info.version'] }, labels: { release: 'git-tag:release-*' } } });
  assert.throws(() => parsePolicy({ versions: { primary: { from: ['git-tags'] } } }), /git-tag\[:<glob>\]/);
  const policy = { versions: { primary: { from: ['git-tag:v[0-9]*', 'info.version'] }, labels: { deploy: 'git-tag:deploy-*' } } };
  const r = await compareWith(policy, { version: '0.0.0', tags: ['v1.4.0', 'deploy-17'] }, { version: '9.9.9', tags: ['v1.5.0'] });
  assert.deepEqual([r.compared.base.version, r.compared.base.versionSource, r.compared.revision.version], ['v1.4.0', 'git-tag:v[0-9]*', 'v1.5.0']);
  assert.equal(r.compared.base.labels?.deploy, 'deploy-17');
  assert.equal(r.findings.find((f) => f.baseRule === 'version-bump-too-small')!.details.needed, 'major', 'semver checks use the tag versions');
  // An untagged side (or one that isn't a git input) uses the next source.
  const untagged = await compareWith(policy, { version: '1.4.0', tags: ['v1.4.0'] }, { version: '2.0.0', tags: [] });
  assert.deepEqual([untagged.compared.revision.version, untagged.compared.revision.versionSource], ['2.0.0', 'info.version']);
  const files = await compareWith(policy, { version: '1.4.0' }, { version: '2.0.0' });
  assert.equal(files.compared.base.versionSource, 'info.version');
});

test('tagVersion: the highest semver tag among the matching ones, as named', () => {
  assert.equal(tagVersion(['v1.2.0', 'v1.10.0', 'v1.9.3'], 'git-tag'), 'v1.10.0');
  assert.equal(tagVersion(['v1.2.0', 'latest'], 'git-tag'), 'v1.2.0', 'semver tags come before others');
  assert.equal(tagVersion(['orders-api-v1.2.0', 'billing-v3.0.0'], 'git-tag:orders-api-v*'), 'orders-api-v1.2.0', 'the tag name as is');
  assert.equal(tagVersion(['latest'], 'git-tag:v*'), undefined);
  assert.equal(tagVersion(undefined, 'git-tag'), undefined);
});

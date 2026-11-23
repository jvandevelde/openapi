// The release file: built with scripts/bundle.ts, run from a directory with no
// node_modules, it must behave exactly like the sources.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { BUNDLE_NAME, bundle } from '../../scripts/bundle.ts';
import { main, type Io } from '../../src/cli/main.ts';
import { VERSION } from '../../src/version.ts';

const run = promisify(execFile);
const cases = fileURLToPath(new URL('../cases/', import.meta.url));

let dir = '';
let file = '';

before(async () => {
  const built = mkdtempSync(join(tmpdir(), 'api-diff-bundle-'));
  await bundle(built);
  // Run it from somewhere else, so it can't find the tool's node_modules.
  dir = mkdtempSync(join(tmpdir(), 'api-diff-release-'));
  for (const f of [BUNDLE_NAME, `${BUNDLE_NAME}.sha256`]) copyFileSync(join(built, f), join(dir, f));
  rmSync(built, { recursive: true });
  file = join(dir, BUNDLE_NAME);
});

after(() => rmSync(dir, { recursive: true, force: true }));

async function bundled(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  try {
    const r = await run(process.execPath, [file, ...argv], { cwd: dir, maxBuffer: 64 * 1024 * 1024, env: {} });
    return { code: 0, out: r.stdout, err: r.stderr };
  } catch (e) {
    const x = e as { code: number; stdout: string; stderr: string };
    return { code: x.code, out: x.stdout, err: x.stderr };
  }
}

async function source(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const io: Io = { stdout: { write: (s: string) => (out += s), isTTY: false }, stderr: { write: (s: string) => (err += s) }, env: {} };
  const code = await main(argv, io);
  return { code, out, err };
}

test('the bundle is one file whose SHA-256 matches its .sha256 file', () => {
  const text = readFileSync(file, 'utf8');
  assert.ok(text.startsWith('#!/usr/bin/env node\n'));
  assert.doesNotMatch(text, /^import .* from ["'](?!node:)/m, 'only node: built-ins are imported');
  assert.match(text, /^\/\/ {3}js-yaml \S+ \(MIT\)$/m);
  const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
  assert.equal(readFileSync(`${file}.sha256`, 'utf8'), `${sha}  ${BUNDLE_NAME}\n`);
});

test('building twice gives the same bytes', async () => {
  const again = mkdtempSync(join(tmpdir(), 'api-diff-bundle-'));
  try {
    assert.equal((await bundle(again)).sha256, readFileSync(`${file}.sha256`, 'utf8').split(' ')[0]);
  } finally {
    rmSync(again, { recursive: true });
  }
});

test('--version, --help, rules and schema match the sources', async () => {
  assert.equal((await bundled('--version')).out, `${VERSION}\n`);
  for (const argv of [['--help'], ['rules'], ['rules', 'schema-narrowed'], ['schema']]) {
    const [b, s] = [await bundled(...argv), await source(...argv)];
    assert.deepEqual(b, s, argv.join(' '));
  }
});

test('every golden case gives the same result and exit code as the sources', async () => {
  const names = readdirSync(cases).filter((n) => existsSync(join(cases, n, 'base.yaml')) && existsSync(join(cases, n, 'revision.yaml')));
  assert.ok(names.length > 100);
  const queue = [...names];
  const worker = async (): Promise<void> => {
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      const argv = ['-C', join(cases, name), 'base.yaml', 'revision.yaml', '--format', 'json', '--as-of', '2026-11-23'];
      const [b, s] = [await bundled(...argv), await source(...argv)];
      assert.deepEqual(b, s, name);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
});

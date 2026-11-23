// The CLI end to end: exit codes, output formats and options.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { main, splitSubcommand, type Io } from '../../src/cli/main.ts';

const cases = fileURLToPath(new URL('../cases/', import.meta.url));

async function run(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const io: Io = { stdout: { write: (s: string) => (out += s), isTTY: false }, stderr: { write: (s: string) => (err += s) }, env: {} };
  const code = await main(argv, io);
  return { code, out, err };
}

const inCase = (name: string): string[] => ['-C', `${cases}${name}`, 'base.yaml', 'revision.yaml'];

test('reports without failing by default; exit 1 when a finding reaches --fail-on', async () => {
  const r = await run(...inCase('operation-removed'));
  assert.equal(r.code, 0);
  assert.match(r.out, /ERROR\s+DELETE \/pets\/\{id\}/);
  assert.match(r.out, /^       -  operation removed/m);
  assert.match(r.out, /state: breaking · not failing CI \(--fail-on never\)/);
  assert.equal((await run(...inCase('operation-removed'), '--fail-on', 'error')).code, 1);
});

test('--fail-on controls the threshold', async () => {
  assert.equal((await run(...inCase('parameter-removed'), '--fail-on', 'error')).code, 0);
  assert.equal((await run(...inCase('parameter-removed'), '--fail-on', 'warn')).code, 1);
  assert.equal((await run(...inCase('operation-removed'), '--fail-on', 'never')).code, 0);
});

test('--state prints one word', async () => {
  assert.equal((await run(...inCase('operation-removed'), '--state')).out, 'breaking\n');
  assert.equal((await run(...inCase('parameter-removed'), '--state')).out, 'compatible\n');
  assert.equal((await run(...inCase('no-changes'), '--state')).out, 'no-changes\n');
});

test('--format json matches the result schema', async () => {
  const r = await run(...inCase('security-scheme-changed'), '--format', 'json');
  const result = JSON.parse(r.out);
  const schema = JSON.parse(readFileSync(new URL('../../schema/result-v0.schema.json', import.meta.url), 'utf8'));
  for (const k of schema.required) assert.ok(k in result, `missing ${k}`);
  for (const f of result.findings) for (const k of schema.$defs.finding.required) assert.ok(k in f, `finding missing ${k}`);
  assert.equal(result.findings[0].impact.length, 2);
  assert.match(result.findings[0].id, /^[0-9a-f]{12}$/);
});

test('finding IDs are stable across runs', async () => {
  const a = JSON.parse((await run(...inCase('parameter-removed'), '-f', 'json')).out);
  const b = JSON.parse((await run(...inCase('parameter-removed'), '-f', 'json')).out);
  assert.equal(a.findings[0].id, b.findings[0].id);
});

test('--profile sdk raises sdk rules', async () => {
  assert.equal((await run(...inCase('operation-id-changed'), '--fail-on', 'error')).code, 0);
  assert.equal((await run(...inCase('operation-id-changed'), '--fail-on', 'error', '--profile', 'sdk')).code, 1);
});

test('usage and input errors exit 2', async () => {
  assert.equal((await run('--format', 'xml', 'a', 'b')).code, 2);
  assert.equal((await run('--bogus')).code, 2);
  const missing = await run('-C', cases, 'nope.yaml', 'nope2.yaml');
  assert.equal(missing.code, 2);
  assert.match(missing.err, /file not found: nope.yaml/);
});

test('rules and schema commands', async () => {
  const r = await run('rules');
  assert.match(r.out, /operation-removed\s+wire\s+error/);
  assert.match(r.out, /implemented rules/);
  assert.match((await run('rules', '--all')).out, /^parameter-renamed /m); // every rule is implemented now, so --all shows no [M…] markers
  const one = JSON.parse((await run('rules', 'query-parameter-removed', '--format', 'json')).out);
  assert.equal(one[0].id, 'parameter-removed');
  assert.match((await run('rules', 'header-parameter-removed')).out, /^parameter-removed: Parameter removed[\s\S]*Why: Clients still send it/);
  assert.equal((await run('rules', 'no-such-rule')).code, 2);
  assert.equal(JSON.parse((await run('schema')).out).title, 'api-diff result, schema version 0');
});

test('--version and --help', async () => {
  assert.match((await run('--version')).out, /^\d+\.\d+\.\d+\n$/);
  assert.match((await run('--help')).out, /Usage:/);
});

test('a subcommand is found after leading options, not in option values', () => {
  assert.deepEqual(splitSubcommand(['rules', '--all']), ['rules', ['--all']]);
  assert.deepEqual(splitSubcommand(['--no-color', 'history', 'a..b', 'f.yaml']), ['history', ['--no-color', 'a..b', 'f.yaml']]);
  assert.deepEqual(splitSubcommand(['-C', 'specs', 'schema']), ['schema', ['-C', 'specs']]);
  // `history` here is the directory given to -C, and `rules` comes after the first input.
  assert.deepEqual(splitSubcommand(['-C', 'history', 'a.yaml', 'b.yaml']), [undefined, ['-C', 'history', 'a.yaml', 'b.yaml']]);
  assert.deepEqual(splitSubcommand(['a.yaml', 'rules']), [undefined, ['a.yaml', 'rules']]);
  assert.deepEqual(splitSubcommand(['--', 'rules', 'b.yaml']), [undefined, ['--', 'rules', 'b.yaml']]);
});

test('rules and schema accept options before the subcommand, and --no-color and --help after it', async () => {
  assert.deepEqual(await run('--no-color', 'rules', 'schema-narrowed'), await run('rules', 'schema-narrowed'));
  assert.deepEqual(await run('rules', 'schema-narrowed', '--no-color'), await run('rules', 'schema-narrowed'));
  assert.equal((await run('--no-color', 'schema')).out, (await run('schema')).out);
  assert.match((await run('rules', '--help')).out, /^api-diff \S+: compare two OpenAPI documents/);
  assert.match((await run('schema', '--help')).out, /^api-diff \S+: compare two OpenAPI documents/);
});

test('stops quietly when the reader closes the pipe early', async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../bin/api-diff.ts', import.meta.url)), 'rules', '--all'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d: Buffer) => (err += d));
  child.stdout.once('data', () => child.stdout.destroy());
  const code = await new Promise<number | null>((done) => child.on('close', done));
  assert.equal(err, '');
  assert.equal(code, 0);
});

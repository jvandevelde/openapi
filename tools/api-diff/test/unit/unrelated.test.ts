// The documents-unrelated precheck: key normalisation, options, and when it
// is skipped. The golden cases (test/cases/documents-unrelated*) cover the
// main scenarios end to end.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { main, type Io } from '../../src/cli/main.ts';
import { compareInputs } from '../../src/engine.ts';
import { operationKey, unrelatedOptions } from '../../src/diff/unrelated.ts';
import { parsePolicy, PolicyError } from '../../src/policy/policy.ts';

const cases = fileURLToPath(new URL('../cases/', import.meta.url));
const UNRELATED = join(cases, 'documents-unrelated');
const defaults = unrelatedOptions({});

async function rules(dir: string, policy: unknown = {}): Promise<string[]> {
  const r = await compareInputs({ kind: 'fs', arg: 'base.yaml', path: 'base.yaml' }, { kind: 'fs', arg: 'revision.yaml', path: 'revision.yaml' }, dir, { policy: parsePolicy(policy) });
  return r.findings.map((f) => f.rule);
}

test('operation keys drop version segments anywhere, parameter names and trailing slashes', () => {
  assert.equal(operationKey('get', '/billing/v1/invoices/{id}', undefined, defaults), 'GET /billing/invoices/{}');
  assert.equal(operationKey('get', '/billing/v2/invoices/{invoiceId}/', undefined, defaults), 'GET /billing/invoices/{}');
  assert.equal(operationKey('post', '/orders/2024-01-01/orders', undefined, defaults), 'POST /orders/orders');
  assert.equal(operationKey('get', '/users/v2beta1/me', undefined, defaults), 'GET /users/me');
  assert.equal(operationKey('get', '/vehicles/v8engine', undefined, defaults), 'GET /vehicles/v8engine');
});

test('operation keys include the server base path, so /v1 can move between servers and paths', () => {
  assert.equal(operationKey('get', '/pets', 'https://api.example.com/v1/store', defaults), 'GET /store/pets');
  assert.equal(operationKey('get', '/v1/store/pets', '/', defaults), 'GET /store/pets');
  assert.equal(operationKey('get', '/pets', '/{version}', defaults), 'GET /{}/pets');
});

test('strip-prefixes removes whole leading segments only', () => {
  const o = unrelatedOptions({ 'strip-prefixes': ['/api', '/internal/'] });
  assert.equal(operationKey('get', '/api/billing', undefined, o), 'GET /billing');
  assert.equal(operationKey('get', '/internal/x', undefined, o), 'GET /x');
  assert.equal(operationKey('get', '/apis/billing', undefined, o), 'GET /apis/billing');
});

test('keys are case-sensitive except the method', () => {
  assert.notEqual(operationKey('get', '/Pets', undefined, defaults), operationKey('GET', '/pets', undefined, defaults));
  assert.equal(operationKey('get', '/pets', undefined, defaults), operationKey('GET', '/pets', undefined, defaults));
});

test('option values are validated when the policy loads', () => {
  const bad = (options: Record<string, unknown>, msg: RegExp): void =>
    assert.throws(() => parsePolicy({ rules: { 'documents-unrelated': options } }), (e: unknown) => e instanceof PolicyError && msg.test(e.message));
  bad({ 'min-overlap': 2 }, /min-overlap: must be a number from 0 to 1/);
  bad({ signals: ['paths'] }, /signals: must be a non-empty list of operations, operation-ids, schemas/);
  bad({ signals: [] }, /signals: must be a non-empty list/);
  bad({ 'min-size': 1.5 }, /min-size: must be a whole number/);
  bad({ 'ignore-path-segments': ['('] }, /'\(' is not a valid regular expression/);
  bad({ 'strip-prefixes': ['api'] }, /strip-prefixes: must be a list of paths starting with \//);
  bad({ when: 'never' }, /when: must be manual or always/);
});

test('the finding explains what was shared', async () => {
  const r = await compareInputs({ kind: 'fs', arg: 'base.yaml', path: 'base.yaml' }, { kind: 'fs', arg: 'revision.yaml', path: 'revision.yaml' }, UNRELATED);
  assert.equal(r.findings.length, 1);
  assert.equal(
    r.findings[0]!.message,
    "documents look unrelated: only 0 of 6 operations, 0 of 6 operationIds, 0 of 2 schemas shared; titles 'Pet Store' and 'Book Store'; set documents-unrelated: off in the policy to compare them anyway",
  );
  assert.equal(r.state, 'breaking');
});

test('options change the outcome', async () => {
  assert.deepEqual(await rules(UNRELATED, { rules: { 'documents-unrelated': { 'min-size': 7 } } }).then((r) => r.includes('documents-unrelated')), false);
  assert.deepEqual(await rules(UNRELATED, { rules: { 'documents-unrelated': { 'min-overlap': 0 } } }).then((r) => r.includes('documents-unrelated')), false);
  assert.deepEqual(await rules(UNRELATED, { rules: { 'documents-unrelated': 'warn' } }), ['documents-unrelated']);
});

test('the same title counts as related', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'api-diff-unrelated-'));
  try {
    cpSync(UNRELATED, dir, { recursive: true });
    writeFileSync(join(dir, 'revision.yaml'), readFileSync(join(dir, 'revision.yaml'), 'utf8').replace('Book Store', 'Pet Store'));
    assert.equal((await rules(dir)).includes('documents-unrelated'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function run(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const io: Io = { stdout: { write: (s: string) => (out += s), isTTY: false }, stderr: { write: (s: string) => (err += s) }, env: {} };
  return { code: await main(argv, io), out, err };
}

test('--rule documents-unrelated=off runs the full diff', async () => {
  const on = await run('-C', UNRELATED, '--no-policy', '--state', 'base.yaml', 'revision.yaml');
  assert.equal(on.code, 1);
  const off = await run('-C', UNRELATED, '--no-policy', '--rule', 'documents-unrelated=off', '-f', 'json', 'base.yaml', 'revision.yaml');
  assert.ok(JSON.parse(off.out).findings.length > 1);
});

test('one file at two git revisions is not checked unless when: always', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'api-diff-unrelated-git-'));
  const git = (...args: string[]): void => void execFileSync('git', args, { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } });
  try {
    git('init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'openapi.yaml'), readFileSync(join(UNRELATED, 'base.yaml')));
    git('add', '.');
    git('commit', '-q', '-m', 'one');
    writeFileSync(join(dir, 'openapi.yaml'), readFileSync(join(UNRELATED, 'revision.yaml')));
    const skipped = await run('-C', dir, '--no-policy', '-f', 'json', 'main:openapi.yaml', 'openapi.yaml');
    assert.equal(JSON.parse(skipped.out).findings.some((f: { rule: string }) => f.rule === 'documents-unrelated'), false);
    writeFileSync(join(dir, 'api-diff.yaml'), 'rules:\n  documents-unrelated:\n    when: always\n');
    const checked = await run('-C', dir, '-f', 'json', '--base', 'main', 'openapi.yaml');
    assert.deepEqual(JSON.parse(checked.out).findings.map((f: { rule: string }) => f.rule), ['documents-unrelated']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

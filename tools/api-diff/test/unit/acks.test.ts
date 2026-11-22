// Acknowledgements: validation, effect on state and exit code, expiry and
// the CLI file. The golden cases acknowledged-finding,
// acknowledgement-stale and acknowledgement-expired cover the findings.

import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { main, type Io } from '../../src/cli/main.ts';
import { compareInputs } from '../../src/engine.ts';
import { parseAcknowledgements } from '../../src/policy/acks.ts';
import { PolicyError } from '../../src/policy/errors.ts';

const CASE = fileURLToPath(new URL('../cases/operation-removed/', import.meta.url));
const ID = '6862f893c35a';
const ack = (expires: string) => [{ finding: ID, reason: 'accepted', owner: '@team', expires }];

test('the file is validated', () => {
  const bad = (data: unknown, msg: RegExp): void => assert.throws(() => parseAcknowledgements(data, 'a.yaml'), (e: unknown) => e instanceof PolicyError && msg.test(e.message));
  bad({ finding: ID }, /a\.yaml: must be a list of acknowledgements/);
  bad([{ finding: 'c7f3e1a2', reason: 'r', expires: '2027-01-01' }], /\[0\]\.finding: must be a 12-character finding ID/);
  bad([{ finding: ID, expires: '2027-01-01' }], /\[0\]\.reason: is required/);
  bad([{ finding: ID, reason: 'r' }], /\[0\]\.expires: is required and must be a date/);
  bad([{ finding: ID, reason: 'r', expires: '2027-01-01', ticket: 'X-1' }], /\[0\]\.ticket: unknown key/);
  bad([{ finding: ID, reason: 'r', expires: '2027-01-01' }, { finding: ID, reason: 'r', expires: '2027-01-01' }], /\[1\]\.finding: 6862f893c35a is acknowledged more than once/);
  assert.deepEqual(parseAcknowledgements(null, 'a.yaml').entries, []);
});

async function compare(expires: string, asOf: string) {
  return compareInputs({ kind: 'fs', arg: 'base.yaml', path: 'base.yaml' }, { kind: 'fs', arg: 'revision.yaml', path: 'revision.yaml' }, CASE, { acknowledgements: parseAcknowledgements(ack(expires), 'a.yaml'), asOf });
}

test('an acknowledged error is reported but the state is not breaking', async () => {
  const r = await compare('2027-01-31', '2026-11-21');
  const f = r.findings.find((x) => x.rule === 'operation-removed')!;
  assert.equal(f.severity, 'error');
  assert.deepEqual(f.acknowledged, { reason: 'accepted', owner: '@team', expires: '2027-01-31', file: 'a.yaml' });
  assert.equal(r.state, 'compatible');
  assert.equal(r.counts.acknowledged, 1);
});

test('the expiry day is the last day it applies', async () => {
  assert.ok((await compare('2026-11-21', '2026-11-21')).findings.find((x) => x.rule === 'operation-removed')!.acknowledged);
  const r = await compare('2026-11-20', '2026-11-21');
  assert.equal(r.findings.find((x) => x.rule === 'operation-removed')!.acknowledged, undefined);
  assert.equal(r.state, 'breaking');
});

async function run(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const io: Io = { stdout: { write: (s: string) => (out += s), isTTY: false }, stderr: { write: (s: string) => (err += s) }, env: {} };
  return { code: await main(argv, io), out, err };
}

test('the CLI reads api-diff.ack.yaml; acknowledged findings don\'t fail CI', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'api-diff-acks-'));
  try {
    cpSync(CASE, dir, { recursive: true });
    writeFileSync(join(dir, 'api-diff.ack.yaml'), `- finding: ${ID}\n  reason: Only the retired admin console called it.\n  owner: "@pets-team"\n  expires: 2027-01-31\n`);
    const r = await run('-C', dir, '--fail-on', 'error', '--as-of', '2026-11-21', 'base.yaml', 'revision.yaml');
    assert.equal(r.code, 0);
    assert.match(r.out, /acknowledged until 2027-01-31 by @pets-team: Only the retired admin console called it\./);
    assert.match(r.out, /\(1 acknowledged\) · state: compatible · fails CI at error and above/);
    assert.equal((await run('-C', dir, '--fail-on', 'error', '--no-acknowledgements', 'base.yaml', 'revision.yaml')).code, 1);
    assert.equal((await run('-C', dir, '--fail-on', 'error', '--as-of', '2027-02-01', 'base.yaml', 'revision.yaml')).code, 1);
    writeFileSync(join(dir, 'api-diff.ack.yaml'), `- finding: ${ID}\n  reason: x\n`);
    const bad = await run('-C', dir, 'base.yaml', 'revision.yaml');
    assert.equal(bad.code, 2);
    assert.match(bad.err, /api-diff\.ack\.yaml: \[0\]\.expires: is required/);
    assert.equal((await run('-C', dir, '--acknowledgements', 'missing.yaml', 'base.yaml', 'revision.yaml')).code, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

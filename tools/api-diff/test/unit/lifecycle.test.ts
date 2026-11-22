// Lifecycle: option and policy validation, dates and --as-of. The golden
// cases (operation-removed-*, deprecated-*, sunset-moved-earlier,
// stability-*, lifecycle-custom-extensions) cover the rules end to end.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { main, type Io } from '../../src/cli/main.ts';
import { daysBetween, isoDate } from '../../src/diff/lifecycle.ts';
import { compareOpened } from '../../src/engine.ts';
import { parsePolicy, PolicyError } from '../../src/policy/policy.ts';
import { MemorySource } from '../../src/sources/memory.ts';

const bad = (policy: unknown, msg: RegExp): void => assert.throws(() => parsePolicy(policy, 'p.yaml'), (e: unknown) => e instanceof PolicyError && msg.test(e.message));

test('lifecycle and rule options are validated', () => {
  bad({ lifecycle: { sunset: 'sunset' } }, /lifecycle\.sunset: must be an x- extension name/);
  bad({ lifecycle: { stabilty: 'x-s' } }, /lifecycle\.stabilty: unknown key \(did you mean stability\?\)/);
  bad({ lifecycle: { 'default-stability': 'ga' } }, /'ga' is not one of the stability-decreased levels/);
  bad({ rules: { 'operation-removed': { unless: { 'deprecated-for-days': -1 } } } }, /deprecated-for-days: must be a whole number of days/);
  bad({ rules: { 'operation-removed': { unless: { 'undated-deprecation': 'yes' } } } }, /undated-deprecation: must be allow or block/);
  bad({ rules: { 'operation-removed': { unless: { 'past-sunsets': true } } } }, /unless takes deprecated-for-days, past-sunset and undated-deprecation/);
  bad({ rules: { 'stability-decreased': { levels: ['beta', 'beta'] } } }, /levels: must be a list of at least two different level names/);
  parsePolicy({ lifecycle: { 'default-stability': 'ga' }, rules: { 'stability-decreased': { levels: ['preview', 'ga'] } } });
});

test('dates: strings and YAML dates, real calendar days only', () => {
  assert.equal(isoDate('2026-02-28'), '2026-02-28');
  assert.equal(isoDate('2026-02-30'), undefined);
  assert.equal(isoDate('Feb 1 2026'), undefined);
  assert.equal(isoDate(new Date('2026-03-01T00:00:00Z')), '2026-03-01');
  assert.equal(daysBetween('2026-06-01', '2026-11-21'), 173);
});

const doc = (op: string): string => `
openapi: 3.1.0
info: { title: Pets, version: 1.0.0 }
paths:
  /pets: { get: { responses: { '200': { description: ok } } } }
${op}
`;

test('an invalid date is spec-invalid at the extension', async () => {
  const r = await compareOpened(
    { source: new MemorySource({ 'a.yaml': doc("  /old: { delete: { deprecated: true, x-deprecated-since: 'last spring', responses: { '204': { description: gone } } } }") }), root: 'a.yaml' },
    { source: new MemorySource({ 'b.yaml': doc('') }), root: 'b.yaml' },
    { asOf: '2026-11-21' },
  );
  const f = r.findings.find((x) => x.rule === 'spec-invalid')!;
  assert.match(f.message, /x-deprecated-since must be a date \(YYYY-MM-DD\), got "last spring"/);
  assert.equal(f.base?.pointer, '/paths/~1old/delete/x-deprecated-since');
});

async function run(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const io: Io = { stdout: { write: (s: string) => (out += s), isTTY: false }, stderr: { write: (s: string) => (err += s) }, env: {} };
  return { code: await main(argv, io), out, err };
}

test('--as-of sets the reference date', async () => {
  const dir = fileURLToPath(new URL('../cases/operation-removed-deprecated-too-short/', import.meta.url));
  assert.equal((await run('-C', dir, '--no-policy', '--as-of', '2026-11-21', 'base.yaml', 'revision.yaml')).code, 1);
  assert.equal((await run('-C', dir, '--no-policy', '--as-of', '2027-01-01', 'base.yaml', 'revision.yaml')).code, 0);
  const r = await run('-C', dir, '--as-of', '21/11/2026', 'base.yaml', 'revision.yaml');
  assert.equal(r.code, 2);
  assert.match(r.err, /--as-of must be a date \(YYYY-MM-DD\)/);
});

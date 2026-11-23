// The audit report: everything, whatever the reports' filters, with
// acknowledgements, severity sources, exclusion sets and owners.

import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { main, type Io } from '../../src/cli/main.ts';

const CASE = fileURLToPath(new URL('../cases/acknowledged-finding/', import.meta.url));

async function run(cwd: string, ...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const io: Io = { stdout: { write: (s: string) => (out += s), isTTY: false }, stderr: { write: (s: string) => (err += s) }, env: {} };
  return { code: await main(['-C', cwd, ...argv], io), out, err };
}

function setup(): string {
  const dir = mkdtempSync(join(tmpdir(), 'api-diff-audit-'));
  cpSync(CASE, dir, { recursive: true });
  writeFileSync(join(dir, 'api-diff.yaml'), [
    'exclusions:',
    '  pets: { paths: ["/pets/**"] }',
    'overrides:',
    '  - match: { rule: version-unchanged }',
    '    severity: info',
    'owners:',
    '  assign:',
    '    - { match: { path: "/pets/**" }, owners: "@pets-team" }',
    'reports:',
    '  review: { exclude: [pets] }',
    '',
  ].join('\n'));
  writeFileSync(join(dir, 'api-diff.ack.yaml'), [
    '- { finding: 6862f893c35a, reason: Only the retired admin console called it., owner: "@pets-team", expires: 2027-01-31 }',
    '- { finding: 0123456789ab, reason: old, expires: 2027-01-31 }',
    '',
  ].join('\n'));
  return dir;
}

test('audit shows what other reports leave out, with acknowledgements, sources, exclusions and owners', async () => {
  const dir = setup();
  try {
    const review = await run(dir, 'base.yaml', 'revision.yaml');
    assert.doesNotMatch(review.out, /operation removed/, 'the review report leaves out the pets set');
    const txt = (await run(dir, '--report', 'audit', 'base.yaml', 'revision.yaml')).out;
    assert.match(txt, /Acknowledged \(1\)\n {2}ERROR {2}DELETE \/pets\/\{id\} {2}operation-removed 6862f893c35a\n {9}until 2027-01-31 by @pets-team: Only the retired admin console called it\./);
    assert.match(txt, /Acknowledgement problems \(1\)\n.*acknowledgement-stale/);
    assert.match(txt, /Where severities came from\n\s+2 {2}default\n\s+1 {2}policy api-diff\.yaml: overrides #1 \(rule version-unchanged\)/);
    assert.match(txt, /Exclusion sets\n {2}pets: 1 finding, left out of review/);
    assert.match(txt, /By owner\n {2}@pets-team {2}1 finding \(1 error, 0 warn, 0 info\)/);
    assert.match(txt, /Findings by rule \(3 rules\)/);
    const json = JSON.parse((await run(dir, '--report', 'audit:json', 'base.yaml', 'revision.yaml')).out);
    assert.equal(json.report, 'audit');
    assert.deepEqual(json.acknowledgements.active.map((a: { finding: string }) => a.finding), ['6862f893c35a']);
    assert.equal(json.acknowledgements.stale.length, 1);
    assert.deepEqual(json.exclusions, [{ set: 'pets', findings: 1, hiddenBy: ['review'] }]);
    assert.equal(json.findings.length, 3);
    const html = (await run(dir, '--report', `audit:html:${join(dir, 'audit.html')}`, 'base.yaml', 'revision.yaml'));
    assert.equal(html.code, 0);
    const page = readFileSync(join(dir, 'audit.html'), 'utf8');
    assert.match(page, /<h1>API governance audit<\/h1>/);
    assert.match(page, /severity &#x2190; policy api-diff\.yaml: overrides #1 \(rule version-unchanged\)/);
    assert.doesNotMatch(page, /<script/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('audit takes no exclude or include, but can be regrouped', async () => {
  const dir = setup();
  try {
    writeFileSync(join(dir, 'api-diff.yaml'), 'exclusions:\n  pets: { paths: ["/pets/**"] }\nreports:\n  audit: { exclude: [pets] }\n');
    const r = await run(dir, '--report', 'audit', 'base.yaml', 'revision.yaml');
    assert.equal(r.code, 2);
    assert.match(r.err, /reports\.audit: the audit report always shows everything, so it takes no exclude or include/);
    writeFileSync(join(dir, 'api-diff.yaml'), 'reports:\n  audit: { group-by: severity }\n');
    assert.match((await run(dir, '--report', 'audit', 'base.yaml', 'revision.yaml')).out, /Findings by severity \(3 severity levels\)\nERROR  error/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

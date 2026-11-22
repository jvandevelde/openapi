// Policy file: strict validation, severity precedence and the CLI options.

import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { main, type Io } from '../../src/cli/main.ts';
import { compareInputs } from '../../src/engine.ts';
import { parseAcknowledgements } from '../../src/policy/acks.ts';
import { parsePolicy, PolicyError } from '../../src/policy/policy.ts';

const cases = fileURLToPath(new URL('../cases/', import.meta.url));
const POLICY_MD = fileURLToPath(new URL('../../POLICY.md', import.meta.url));

const fails = (data: unknown, message: RegExp): void => assert.throws(() => parsePolicy(data, 'p.yaml'), (e: unknown) => e instanceof PolicyError && message.test(e.message));

async function compareCase(name: string, policy: unknown): Promise<{ rule: string; severity: string; severitySource: string }[]> {
  const dir = join(cases, name);
  const r = await compareInputs({ kind: 'fs', arg: 'base.yaml', path: 'base.yaml' }, { kind: 'fs', arg: 'revision.yaml', path: 'revision.yaml' }, dir, { policy: parsePolicy(policy, 'p.yaml') });
  return r.findings.filter((f) => !f.baseRule.startsWith('version-')).map((f) => ({ rule: f.rule, severity: f.severity, severitySource: f.severitySource }));
}

test('an empty policy is valid', () => {
  const p = parsePolicy({});
  assert.equal(p.rules.size, 0);
});

test('unknown keys and rule IDs are errors with a suggestion', () => {
  fails({ rulez: {} }, /p\.yaml: rulez: unknown key \(did you mean rules\?\)/);
  fails({ rules: { 'enum-value-aded': 'warn' } }, /rules\.enum-value-aded: unknown rule \(did you mean enum-value-added\?\)/);
  fails({ defaults: { 'fail-onn': 'warn' } }, /did you mean fail-on\?/);
  fails({ rules: { 'enum-value-added': { severity: 'warn', 'honor-open-hint': false } } }, /unknown option \(did you mean honour-open-hint\?\)/);
  fails({ rules: { 'operation-added': { strict: true } } }, /operation-added takes only severity, fix and explanation/);
});

test('values are checked', () => {
  fails({ version: 2 }, /version: must be 1/);
  fails({ profile: 'sdkk' }, /profile: must be one of wire, sdk \(did you mean sdk\?\)/);
  fails({ rules: { 'operation-added': 'warning' } }, /must be one of error, warn, info, off \(did you mean warn\?\)/);
  fails({ rules: [] }, /rules: must be a mapping/);
  fails({ overrides: {} }, /overrides: must be a list/);
});

test('variant rule IDs and rule options are accepted', () => {
  const p = parsePolicy({
    rules: {
      'query-parameter-removed': 'error',
      'enum-value-added-in-response': { severity: 'error', 'honour-open-hint': false },
      'operation-removed': { severity: 'error', unless: { 'deprecated-for-days': 30 } },
    },
  });
  assert.equal(p.rules.get('query-parameter-removed')?.severity, 'error');
  assert.deepEqual(p.rules.get('operation-removed')?.options, { unless: { 'deprecated-for-days': 30 } });
});

test('every YAML example in POLICY.md is a valid policy or acknowledgements file', () => {
  const md = readFileSync(POLICY_MD, 'utf8');
  const blocks = [...md.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => load(m[1]!));
  const acks = blocks.filter((d) => Array.isArray(d)); // section 11
  const policies = blocks.filter((d) => d && !Array.isArray(d));
  assert.equal(acks.length, 1);
  assert.equal(policies.length, 8);
  for (const d of policies) parsePolicy(d, 'POLICY.md');
  for (const d of acks) parseAcknowledgements(d, 'POLICY.md');
  // The behaviour each example shows is tested in policy, overrides, lifecycle,
  // exclusions, versions, hints and acks tests; reports (section 10) are M7.
});

test('a policy severity beats the default and says where it came from', async () => {
  const [f] = await compareCase('parameter-removed', { rules: { 'parameter-removed': 'error' } });
  assert.equal(f?.severity, 'error');
  assert.equal(f?.severitySource, 'policy p.yaml: rules.parameter-removed');
});

test('the most specific rule ID wins', async () => {
  const [f] = await compareCase('parameter-removed', { rules: { 'parameter-removed': 'error', 'query-parameter-removed': 'info' } });
  assert.equal(f?.rule, 'query-parameter-removed');
  assert.equal(f?.severity, 'info');
});

test('off drops the finding', async () => {
  assert.deepEqual(await compareCase('operation-removed', { rules: { 'operation-removed': 'off' } }), []);
});

test('a policy severity beats the profile', async () => {
  const [f] = await compareCase('operation-id-changed', { profile: 'sdk', rules: { 'operation-id-changed': 'warn' } });
  assert.equal(f?.severity, 'warn');
});

test('the profile comes from the policy', async () => {
  const [f] = await compareCase('operation-id-changed', { profile: 'sdk' });
  assert.equal(f?.severity, 'error');
});

test('conditional severities come from their option', async () => {
  const [d] = await compareCase('property-removed-closed-object', {});
  assert.equal(d?.severity, 'error');
  const [f] = await compareCase('property-removed-closed-object', { rules: { 'property-removed': { 'closed-object-severity': 'warn' } } });
  assert.equal(f?.severity, 'warn');
  assert.equal(f?.severitySource, 'policy p.yaml: rules.property-removed.closed-object-severity');
});

test('min-severity drops findings below it', async () => {
  assert.deepEqual(await compareCase('operation-added', { defaults: { 'min-severity': 'warn' } }), []);
});

// CLI

async function run(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const io: Io = { stdout: { write: (s: string) => (out += s), isTTY: false }, stderr: { write: (s: string) => (err += s) }, env: {} };
  return { code: await main(argv, io), out, err };
}

function withCase(name: string, policy: string | undefined, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'api-diff-policy-'));
  cpSync(join(cases, name), dir, { recursive: true });
  if (policy !== undefined) writeFileSync(join(dir, 'api-diff.yaml'), policy);
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test('the CLI reads api-diff.yaml from the working directory', () =>
  withCase('operation-removed', 'rules:\n  operation-removed: warn\n', async (dir) => {
    assert.equal((await run('-C', dir, '--fail-on', 'error', 'base.yaml', 'revision.yaml')).code, 0);
    assert.equal((await run('-C', dir, '--no-policy', '--fail-on', 'error', 'base.yaml', 'revision.yaml')).code, 1);
  }));

test('defaults.fail-on is used unless --fail-on is given', () =>
  withCase('parameter-removed', 'defaults:\n  fail-on: warn\n', async (dir) => {
    assert.equal((await run('-C', dir, 'base.yaml', 'revision.yaml')).code, 1);
    assert.equal((await run('-C', dir, '--fail-on', 'error', 'base.yaml', 'revision.yaml')).code, 0);
  }));

test('--rule beats the policy file', () =>
  withCase('operation-removed', 'rules:\n  operation-removed: warn\n', async (dir) => {
    const r = await run('-C', dir, '--fail-on', 'error', '--rule', 'operation-removed=error', '-f', 'json', 'base.yaml', 'revision.yaml');
    assert.equal(r.code, 1);
    assert.equal(JSON.parse(r.out).findings[0].severitySource, '--rule: rules.operation-removed');
  }));

test('policy errors exit 2 with the message', () =>
  withCase('operation-removed', 'rules:\n  operation-remove: warn\n', async (dir) => {
    const r = await run('-C', dir, 'base.yaml', 'revision.yaml');
    assert.equal(r.code, 2);
    assert.match(r.err, /api-diff\.yaml: rules\.operation-remove: unknown rule \(did you mean operation-removed\?\)/);
    assert.equal((await run('-C', dir, '--policy', 'missing.yaml', 'base.yaml', 'revision.yaml')).code, 2);
    assert.match((await run('-C', dir, '--no-policy', '--rule', 'operation-removed', 'base.yaml', 'revision.yaml')).err, /--rule must be <rule-id>=<severity>/);
  }));

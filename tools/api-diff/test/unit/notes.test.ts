// Migration notes for clients: every finding a client may have to act on
// (warn or error, except version checks and notices) gets a note, in every
// golden case, and notes read sensibly.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { compareInputs } from '../../src/engine.ts';
import { parsePolicy } from '../../src/policy/policy.ts';
import { isChange } from '../../src/render/common.ts';
import { clientNote, fieldOf } from '../../src/rules/notes.ts';

const CASES = fileURLToPath(new URL('../cases/', import.meta.url));

test('every warn or error change in the golden cases has a client note', async () => {
  const missing: string[] = [];
  const samples = new Map<string, string>();
  for (const name of readdirSync(CASES, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const exp = load(readFileSync(`${CASES}${name}/expected.yaml`, 'utf8')) as { options?: { policy?: unknown; profile?: 'wire' | 'sdk' } };
    const base = readdirSync(`${CASES}${name}`).find((f) => /^base(\.ya?ml|\.json)?$/.test(f));
    const rev = readdirSync(`${CASES}${name}`).find((f) => /^revision(\.ya?ml|\.json)?$/.test(f));
    if (!base || !rev) continue;
    const arg = (f: string): string => (f === 'base' || f === 'revision' ? `${f}/openapi.yaml` : f);
    const r = await compareInputs({ kind: 'fs', arg: arg(base), path: arg(base) }, { kind: 'fs', arg: arg(rev), path: arg(rev) }, `${CASES}${name}`, { policy: parsePolicy(exp.options?.policy ?? {}), profile: 'sdk', asOf: '2026-11-21' });
    for (const f of r.findings.filter(isChange)) {
      const note = clientNote(f);
      if (note) samples.set(f.rule, note);
      if (f.severity !== 'info' && !note) missing.push(`${name}: ${f.rule}`);
      if (note) assert.doesNotMatch(note, /undefined|\[object|``|\(was \)|now  /, `${name}: ${f.rule}: ${note}`);
    }
  }
  assert.deepEqual(missing, []);
  assert.ok(samples.size > 60, `${samples.size} rules with notes in the cases`);
});

test('fields are named from the schema path', () => {
  assert.equal(fieldOf('/properties/a/properties/b/items/maxLength'), 'a.b[]');
  assert.equal(fieldOf('/properties/status/enum'), 'status');
  assert.equal(fieldOf('/maxLength'), '');
});

test('notes depend on direction', () => {
  const f = (rule: string, details: Record<string, unknown>) => ({ id: 'x', rule, baseRule: rule.replace(/-in-(request|response)$/, ''), kind: 'wire' as const, severity: 'error' as const, severitySource: 'default', subject: '#/components/schemas/Pet', message: '', details });
  assert.equal(clientNote(f('enum-value-added-in-response', { values: ['adopted'], path: '/properties/status/enum' })), 'Handle the new `status` value `adopted`.');
  assert.equal(clientNote(f('enum-value-added-in-request', { values: ['adopted'], path: '/properties/status/enum' })), undefined);
  assert.equal(clientNote(f('max-length-decreased-in-request', { from: 100, to: 50, path: '/properties/name/maxLength' })), 'Send `name` within the new limit: `maxLength` is now 50 (was 100).');
  assert.equal(clientNote(f('property-removed-in-response', { name: 'age', path: '/properties/age' })), "Don't rely on `age` in responses; it's no longer returned.");
  assert.equal(clientNote(f('union-branch-added-in-response', { branch: '#/components/schemas/Bird', discriminatorValues: ['bird', 'parrot'], path: '/properties/pet/oneOf' })), 'Handle the new `Bird` variant of `pet` (discriminator `bird` or `parrot`).');
  assert.equal(clientNote(f('union-branch-removed-in-request', { branch: '#/components/schemas/Bird', path: '/properties/pet/oneOf' })), 'Stop sending the `Bird` variant of `pet`.');
});

test('an inline union branch is named by a summary, and its revision pointer is the branch itself', async () => {
  const { compareOpened } = await import('../../src/engine.ts');
  const { MemorySource } = await import('../../src/sources/memory.ts');
  const spec = (extra: string): string => `openapi: 3.1.0
info: { title: t, version: '1' }
paths:
  /p:
    get:
      responses:
        '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/Pay' } } } }
components:
  schemas:
    Pay:
      oneOf:
        - { type: object, properties: { card: { type: string } } }
${extra}`;
  const r = await compareOpened(
    { source: new MemorySource({ 'a.yaml': spec('') }), root: 'a.yaml' },
    { source: new MemorySource({ 'b.yaml': spec('        - { type: object, properties: { paypal: { type: string }, email: { type: string } } }\n') }), root: 'b.yaml' },
  );
  const f = r.findings.find((x) => x.rule === 'union-branch-added-in-response')!;
  assert.equal(f.revision!.pointer, '/components/schemas/Pay/oneOf/1');
  assert.equal(f.base!.pointer, '/components/schemas/Pay/oneOf');
  assert.match(f.message, /branch added: inline object with paypal, email at \/oneOf\/1/);
  assert.equal(clientNote(f), 'Handle the new variant (object with paypal, email) of `Pay`.');
});

// Golden test cases: test/cases/<name>/{base,revision}.{yaml,json} (or
// base/openapi.yaml and revision/openapi.yaml for multi-file cases), and
// expected.yaml with the findings we want. See test/cases/README.md.
//
// UPDATE_CASES=1 rewrites each expected.yaml's findings with the actual
// results, for review in the diff.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dump, load } from 'js-yaml';
import { compareInputs } from '../src/engine.ts';
import { parsePolicy } from '../src/policy/policy.ts';
import { baseRuleId, CURRENT_MILESTONE, getRule, isImplemented, RULES } from '../src/rules/registry.ts';
import type { Profile, Severity } from '../src/types.ts';

const CASES = fileURLToPath(new URL('./cases/', import.meta.url));

interface Expected {
  description: string;
  milestone: string;
  /** `policy` is read from M6; until then only cases for M6 or later use it. */
  options?: { profile?: Profile; policy?: Record<string, unknown>; 'as-of'?: string };
  findings: { rule: string; severity: Severity; subject: string }[];
}

function input(dir: string, side: 'base' | 'revision'): string {
  for (const f of [`${side}.yaml`, `${side}.json`, `${side}/openapi.yaml`]) if (existsSync(join(dir, f))) return f;
  throw new Error(`${dir}: no ${side} document`);
}

const key = (f: { rule: string; severity: string; subject: string }): string => `${f.severity} ${f.rule} ${f.subject}`;

const names = readdirSync(CASES, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

const covered = new Set<string>();

for (const name of names) {
  const dir = join(CASES, name);
  const expected = load(readFileSync(join(dir, 'expected.yaml'), 'utf8')) as Expected;
  const milestone = Number(expected.milestone.replace(/^M/, ''));
  for (const f of expected.findings) {
    const base = baseRuleId(f.rule);
    assert.ok(base, `${name}: unknown rule '${f.rule}' in expected.yaml`);
    covered.add(base);
  }
  const pending = expected.findings.map((f) => baseRuleId(f.rule)!).filter((id) => !isImplemented(getRule(id)));
  const todo = milestone > CURRENT_MILESTONE ? `needs ${expected.milestone}` : pending.length ? `needs ${[...new Set(pending)].join(', ')}` : undefined;

  test(name, { todo }, async () => {
    const result = await compareInputs({ kind: 'fs', arg: input(dir, 'base'), path: input(dir, 'base') }, { kind: 'fs', arg: input(dir, 'revision'), path: input(dir, 'revision') }, dir, { profile: expected.options?.profile ?? 'wire', policy: parsePolicy(expected.options?.policy ?? {}, `${name}/expected.yaml`), asOf: expected.options?.['as-of'] ?? '2026-11-21' });
    const actual = result.findings.map((f) => ({ rule: f.rule, severity: f.severity, subject: f.subject }));
    if (process.env.UPDATE_CASES && !todo) {
      const next = { ...expected, findings: actual };
      writeFileSync(join(dir, 'expected.yaml'), dump(next, { lineWidth: 120 }));
      return;
    }
    assert.deepEqual(actual.map(key).sort(), expected.findings.map(key).sort(), `${expected.description}\n${result.findings.map((f) => `  ${key(f)}: ${f.message}`).join('\n')}`);
  });
}

test('every implemented rule has at least one test case', () => {
  const missing = RULES.filter((r) => isImplemented(r) && !covered.has(r.id)).map((r) => r.id);
  assert.deepEqual(missing, [], `rules without a test case: ${missing.join(', ')}`);
});

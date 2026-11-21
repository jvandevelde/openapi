// Keeps the rule registry, RULES.md and package metadata in sync.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { defaultSeverity } from '../../src/classify/classify.ts';
import { allRuleIds, baseRuleId, getRule, RULES, specificRuleId } from '../../src/rules/registry.ts';
import { VERSION } from '../../src/version.ts';

const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');

/** Rule IDs in the first column of RULES.md's tables, plus the docs list in section 10. */
function documentedIds(): Set<string> {
  const md = read('../../RULES.md');
  const ids = new Set<string>();
  for (const line of md.split('\n')) {
    const first = /^\| ((?:\[?`)[^|]+)\|/.exec(line)?.[1];
    if (first) for (const m of first.matchAll(/`([a-z][a-z0-9-]+)`/g)) ids.add(m[1]!);
  }
  const docs = md.slice(md.indexOf('## 10. Docs'), md.indexOf('## 11.'));
  for (const m of docs.matchAll(/`([a-z][a-z0-9-]+-(?:changed|added|removed))`/g)) ids.add(m[1]!);
  return ids;
}

test('RULES.md documents exactly the rules in the registry', () => {
  const documented = documentedIds();
  const registered = new Set(RULES.map((r) => r.id));
  assert.deepEqual([...registered].filter((id) => !documented.has(id)).sort(), [], 'in the registry but not in RULES.md');
  assert.deepEqual([...documented].filter((id) => !registered.has(id)).sort(), [], 'in RULES.md but not in the registry');
});

test('rule IDs, including variants, are unique and map back to their base rule', () => {
  const ids = allRuleIds();
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(baseRuleId(id), id);
  assert.equal(baseRuleId('query-parameter-removed'), 'parameter-removed');
  assert.equal(baseRuleId('enum-value-added-in-response'), 'enum-value-added');
  assert.equal(baseRuleId('query-operation-removed'), undefined);
});

test('specific rule IDs: locations and directions', () => {
  const p = getRule('parameter-removed');
  assert.equal(specificRuleId(p, { location: 'query' }), 'query-parameter-removed');
  assert.equal(specificRuleId(p, { location: 'path' }), 'parameter-removed');
  assert.equal(specificRuleId(getRule('enum-value-added'), { direction: 'out' }), 'enum-value-added-in-response');
});

test('severity: defaults, sdk profile and conditional severities', () => {
  const c = (rule: string, details: Record<string, unknown> = {}, direction?: 'in' | 'out') => ({ rule, subject: 's', details, ...(direction ? { direction } : {}) });
  assert.equal(defaultSeverity(c('operation-id-changed'), 'wire').severity, 'info');
  assert.equal(defaultSeverity(c('operation-id-changed'), 'sdk').severity, 'error');
  assert.equal(defaultSeverity(c('parameter-removed'), 'sdk').severity, 'error');
  assert.equal(defaultSeverity(c('response-header-removed', { required: true }), 'wire').severity, 'error');
  assert.equal(defaultSeverity(c('response-header-removed', { required: false }), 'wire').severity, 'warn');
  assert.equal(defaultSeverity(c('enum-value-added', {}, 'out'), 'wire').severity, 'warn');
  assert.equal(defaultSeverity(c('enum-value-added', {}, 'in'), 'wire').severity, 'info');
});

test('sdk-kind rules are info under the wire profile', () => {
  for (const r of RULES.filter((x) => x.kind === 'sdk')) assert.equal(r.severity, 'info', r.id);
});

test('version.ts matches package.json', () => {
  assert.equal(VERSION, JSON.parse(read('../../package.json')).version);
});

// Every rule has documentation, and docs/rules/ matches what the generator produces.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DOCS_DIR, lineDiff, renderRuleDocs } from '../../scripts/rule-docs.ts';
import { RULE_DOCS } from '../../src/rules/docs.ts';
import { RULES } from '../../src/rules/registry.ts';

test('every rule has a description, a reason and a fix', () => {
  for (const r of RULES) {
    const d = RULE_DOCS[r.id];
    assert.ok(d, `src/rules/docs.ts has no entry for ${r.id}`);
    assert.ok(d.description && d.why && d.fix, `${r.id}: description, why and fix are required`);
  }
  assert.deepEqual(Object.keys(RULE_DOCS).filter((id) => !RULES.some((r) => r.id === id)), [], 'docs for rules that do not exist');
});

test('docs/rules/ is up to date (run `npm run docs`)', () => {
  const files = renderRuleDocs();
  for (const [f, text] of files) {
    assert.ok(existsSync(join(DOCS_DIR, f)), `docs/rules/${f} is missing; run npm run docs`);
    assert.equal(readFileSync(join(DOCS_DIR, f), 'utf8'), text, `docs/rules/${f} is out of date; run npm run docs`);
  }
  assert.deepEqual(readdirSync(DOCS_DIR).filter((f) => !files.has(f)), [], 'files in docs/rules/ that are no longer generated');
});

test('lineDiff', () => {
  assert.equal(lineDiff('a\nb\nc\n', 'a\nB\nc\n', 1), '  a\n- b\n+ B\n  c');
  assert.equal(lineDiff('1\n2\n3\n4\n5\n6\n7\n', '1\n2\n3\n4\n5\n6\nX\n', 1), '  …\n  6\n- 7\n+ X');
});

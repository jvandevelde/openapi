// Report templates and the policy's message and note wording: names are
// checked against each report's data shape before rendering (also inside
// sections that are empty in a run), HTML is escaped and txt isn't, custom
// reports extend built-in ones. The drift test checks that the declared
// shapes cover every key the reports really produce, over all test cases.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { main, type Io } from '../../src/cli/main.ts';
import { compareInputs } from '../../src/engine.ts';
import { parsePolicy, PolicyError } from '../../src/policy/policy.ts';
import { reportData } from '../../src/render/reports.ts';
import { checkTemplate, renderTemplate, SHAPES, TemplateError, type Shape } from '../../src/render/template.ts';

const CASES = fileURLToPath(new URL('../cases/', import.meta.url));

test('names are checked where Mustache looks them up, with a suggestion', () => {
  const shape = SHAPES.changelog!;
  checkTemplate('{{title}} {{from}}→{{to}}{{#tags}}{{tag}}{{#operations}}{{operation}} {{from}}{{#entries}}{{text}}{{^note}}-{{/note}}{{/entries}}{{/operations}}{{/tags}}{{components.length}}', shape, 't');
  const bad = (text: string, msg: RegExp): void => assert.throws(() => checkTemplate(text, shape, 't.html'), (e: unknown) => e instanceof TemplateError && msg.test(e.message));
  bad('ok\n{{#tags}}{{#operations}}{{#entries}}{{txt}}{{/entries}}{{/operations}}{{/tags}}', /t\.html line 2: 'txt' is not in the data here \(did you mean text\?\); available: .*kind, text, note/);
  bad('{{> header}}', /partials \(\{\{> header\}\}\) aren't supported/);
  bad('{{#tags}}{{tag}}', /t\.html: Unclosed section "tags"/);
  bad('{{tags.name}}', /'tags\.name' is not in the data here/);
  checkTemplate('{{#counts.byRule}}{{operation-removed}}{{/counts.byRule}}{{#findings}}{{details.anything}}{{#impact}}{{.}}{{/impact}}{{/findings}}', SHAPES.review!, 'r');
});

test('HTML templates are escaped; txt templates are not', () => {
  assert.equal(renderTemplate('{{a}}|{{{a}}}', { a: '<b>&' }, 'html'), '&lt;b&gt;&amp;|<b>&');
  assert.equal(renderTemplate('{{a}}', { a: '<b>&' }, 'txt'), '<b>&');
});

/** Paths in `data` that `shape` doesn't declare. */
function undeclared(data: unknown, shape: Shape, at = ''): string[] {
  if (data === null || typeof data !== 'object') return [];
  if (shape === 2) return [];
  if (Array.isArray(data)) return Array.isArray(shape) ? data.flatMap((x) => undeclared(x, shape[0]!, `${at}[]`)) : [`${at} (a list)`];
  if (shape === 1 || Array.isArray(shape)) return [`${at} (an object)`];
  return Object.entries(data).flatMap(([k, v]) => {
    const s = k in shape ? shape[k] : shape['*'];
    return s === undefined ? [`${at}.${k}`] : undeclared(v, s, `${at}.${k}`);
  });
}

test('the declared shapes cover every key the reports produce, over all test cases', async () => {
  const missing = new Set<string>();
  for (const name of readdirSync(CASES)) {
    const dir = join(CASES, name);
    const file = (b: string) => ['yaml', 'json'].map((x) => `${b}.${x}`).find((f) => existsSync(join(dir, f))) ?? `${b}/openapi.yaml`;
    if (!existsSync(join(dir, 'expected.yaml'))) continue;
    const r = await compareInputs({ kind: 'fs', arg: file('base'), path: file('base') }, { kind: 'fs', arg: file('revision'), path: file('revision') }, dir, { asOf: '2026-11-21', snippets: true, policy: parsePolicy({ rules: { 'operation-removed': { note: 'n' } } }) });
    r.uses = { file: 'u', operations: [], unmatched: [] };
    for (const report of Object.keys(SHAPES)) for (const p of undeclared(reportData(report as 'review', r, { color: false, docs: true }), SHAPES[report]!)) missing.add(`${report}${p}`);
  }
  assert.deepEqual([...missing], [], 'add these to SHAPES in src/render/template.ts');
});

test('rules.<id>.message and note: checked templates over the finding', async () => {
  assert.throws(() => parsePolicy({ rules: { 'operation-removed': { note: 'Stop calling {{subjct}}.' } } }, 'p.yaml'), (e: unknown) => e instanceof PolicyError && /p\.yaml: rules\.operation-removed\.note line 1: 'subjct' is not in the data here \(did you mean subject\?\)/.test(e.message));
  assert.throws(() => parsePolicy({ rules: { 'operation-removed': { message: '' } } }), /message: must be text/);
  const dir = join(CASES, 'operation-removed');
  const policy = parsePolicy({ rules: { 'operation-removed': { message: '{{subject}} was retired', note: 'Move to v2; see https://example.com/migrate ({{id}}).' } } });
  const r = await compareInputs({ kind: 'fs', arg: 'base.yaml', path: 'base.yaml' }, { kind: 'fs', arg: 'revision.yaml', path: 'revision.yaml' }, dir, { policy });
  const f = r.findings.find((x) => x.rule === 'operation-removed')!;
  assert.equal(f.message, `${f.subject} was retired`);
  assert.equal(f.note, `Move to v2; see https://example.com/migrate (${f.id}).`);
});

async function run(cwd: string, ...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const io: Io = { stdout: { write: (s: string) => (out += s), isTTY: false }, stderr: { write: (s: string) => (err += s) }, env: {} };
  return { code: await main(['-C', cwd, ...argv], io), out, err };
}

test('a custom report extends a built-in one and renders a template', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'api-diff-templates-'));
  try {
    const spec = (extra: string) => `openapi: 3.1.0\ninfo: { title: 'Pets <&>', version: 1.0.0 }\npaths:\n  /pets:\n    get: { x-audience: partner, responses: { '200': { description: ok } } }\n${extra}`;
    writeFileSync(join(dir, 'base.yaml'), spec("  /internal:\n    get: { responses: { '200': { description: ok } } }\n  /pets/{id}:\n    delete: { x-audience: partner, parameters: [{ name: id, in: path, required: true, schema: { type: string } }], responses: { '204': { description: gone } } }\n"));
    writeFileSync(join(dir, 'revision.yaml'), spec(''));
    mkdirSync(join(dir, 'policy'));
    writeFileSync(join(dir, 'policy', 'api-diff.yaml'), [
      'reports:',
      '  changelog: { include: { kinds: [wire, sdk] } }',
      '  partner-changelog:',
      '    extends: changelog',
      '    include: { extensions: { x-audience: partner } }',
      '    format: html',
      '    template: ./partner.html',
      '  partner-notes: { extends: partner-changelog, format: txt, template: ./partner.txt }',
      '',
    ].join('\n'));
    writeFileSync(join(dir, 'policy', 'partner.html'), '<h1>{{title}}</h1>{{#tags}}{{#operations}}<li>{{operation}}{{#entries}}: {{text}}{{/entries}}</li>{{/operations}}{{/tags}}\n');
    writeFileSync(join(dir, 'policy', 'partner.txt'), '{{title}}: {{breaking}} breaking\n');
    const html = await run(dir, '--policy', 'policy/api-diff.yaml', '--report', 'partner-changelog', 'base.yaml', 'revision.yaml');
    assert.equal(html.code, 0, html.err);
    assert.equal(html.out, '<h1>Pets &lt;&amp;&gt;</h1><li>DELETE /pets/{id}: operation removed</li>\n', 'the template path is relative to the policy file; /internal is left out');
    assert.equal((await run(dir, '--policy', 'policy/api-diff.yaml', '--report', 'partner-notes', 'base.yaml', 'revision.yaml')).out, 'Pets <&>: 1 breaking\n');
    const json = JSON.parse((await run(dir, '--policy', 'policy/api-diff.yaml', '--report', 'partner-changelog:json', 'base.yaml', 'revision.yaml')).out);
    assert.equal(json.report, 'changelog', 'json is the data the template sees');
    const txt = await run(dir, '--policy', 'policy/api-diff.yaml', '--report', 'partner-changelog:txt', 'base.yaml', 'revision.yaml');
    assert.match(txt.err, /report partner-changelog has a html template, so its formats are html and json/);
    const unknown = await run(dir, '--policy', 'policy/api-diff.yaml', '--report', 'partner', 'base.yaml', 'revision.yaml');
    assert.match(unknown.err, /unknown report 'partner'; reports: .*partner-changelog, partner-notes/);
    writeFileSync(join(dir, 'policy', 'partner.html'), '{{#tags}}{{#operations}}{{#entries}}{{nots}}{{/entries}}{{/operations}}{{/tags}}');
    const typo = await run(dir, '--policy', 'policy/api-diff.yaml', '--report', 'partner-changelog', 'base.yaml', 'revision.yaml');
    assert.equal(typo.code, 2);
    assert.match(typo.err, /template \.\/partner\.html line 1: 'nots' is not in the data here \(did you mean note\?\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

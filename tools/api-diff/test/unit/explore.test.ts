// The explore report: self-contained, safe embedding of spec-controlled
// text, snippets and the recursive marker.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareOpened } from '../../src/engine.ts';
import { renderExplore, scriptJson } from '../../src/render/explore.ts';
import { MemorySource } from '../../src/sources/memory.ts';

const doc = (max: number, title = 'Pets'): string => `openapi: 3.1.0
info: { title: '${title}', version: 1.0.0 }
paths:
  /pets:
    get:
      parameters:
        - name: limit
          in: query
          schema: { type: integer, maximum: ${max} }
      responses:
        '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/Node' } } } }
components:
  schemas:
    Node: { type: object, properties: { name: { type: string, maxLength: ${max} }, child: { $ref: '#/components/schemas/Node' } } }
`;

async function result(title?: string) {
  return compareOpened({ source: new MemorySource({ 'a.yaml': doc(100) }), root: 'a.yaml' }, { source: new MemorySource({ 'b.yaml': doc(50, title) }), root: 'b.yaml' }, { snippets: true });
}

test('snippets cover each finding, with the line it points at', async () => {
  const r = await result();
  const f = r.findings.find((x) => x.rule === 'maximum-decreased-in-request')!;
  const s = r.snippets![f.id]!;
  assert.equal(s.base!.line, f.base!.line);
  assert.equal(s.revision!.file, 'b.yaml');
  assert.match(s.revision!.lines[s.revision!.line - s.revision!.start]!, /maximum: 50/);
  assert.equal(r.findings.find((x) => x.subject === '#/components/schemas/Node')!.details.recursive, true);
});

test('no snippets unless asked for', async () => {
  const r = await compareOpened({ source: new MemorySource({ 'a.yaml': doc(100) }), root: 'a.yaml' }, { source: new MemorySource({ 'b.yaml': doc(50) }), root: 'b.yaml' });
  assert.equal(r.snippets, undefined);
});

test('self-contained, and spec text can never close the script or inject HTML', async () => {
  const r = await result('</script><img src=x onerror=alert(1)>');
  const html = renderExplore(r);
  assert.doesNotMatch(html, /<script src|<link|https?:\/\//);
  assert.equal(html.match(/<\/script>/g)!.length, 2); // only the page's own two
  assert.doesNotMatch(html, /<img src=x/);
  assert.equal(scriptJson('</script>\u2028'), '"\\u003c/script>\\u2028"');
  const data = JSON.parse(html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/)![1]!);
  assert.ok(data.findings.some((f: { note?: string }) => f.note?.includes('query parameter `limit`')));
});

// Links into the spec explorer (decision record: the explore report is a diff view)

import { explorerLink } from '../../src/render/config.ts';
import { parsePolicy, PolicyError } from '../../src/policy/policy.ts';

test('explorer links: placeholders filled in and URL-encoded; the template is validated', async () => {
  assert.equal(explorerLink('https://x.test/#{side}:{file}:{pointer}', 'revision', { file: 'specs/a b.yaml', pointer: '/paths/~1pets/get' }), 'https://x.test/#revision:specs%2Fa%20b.yaml:%2Fpaths%2F~1pets%2Fget');
  assert.equal(explorerLink(undefined, 'base', { file: 'a', pointer: '/x' }), undefined);
  for (const bad of ['javascript:alert(1)//{pointer}', 'https://x.test/#no-placeholder']) {
    assert.throws(() => parsePolicy({ reports: { explore: { 'explorer-url': bad } } }), (e: unknown) => e instanceof PolicyError && /must be an http\(s\) URL template containing \{pointer\}/.test(e.message));
  }
  const html = renderExplore(await result(), 'https://explorer.test/view#{pointer}');
  const data = JSON.parse(html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/)![1]!);
  const f = data.findings.find((x: { rule: string }) => x.rule === 'maximum-decreased-in-request');
  assert.equal(f.links.revision, 'https://explorer.test/view#%2Fpaths%2F~1pets%2Fget%2Fparameters%2F0%2Fschema%2Fmaximum');
  assert.ok(f.links.base);
  assert.equal(JSON.parse(renderExplore(await result()).match(/id="data">([\s\S]*?)<\/script>/)![1]!).findings[0].links, undefined);
});

// Sections and grouping (decision record: group explore rows and fold documentation changes)

test('each row has its section: input problems, version, changes, docs or notes', async () => {
  const a = `openapi: 3.1.0
info: { title: Pets, version: 1.0.0 }
paths:
  /pets:
    get:
      summary: List pets
      responses: { '200': { description: ok } }
    delete:
      responses: { '204': { description: gone } }
  /cats:
    get:
      x-api-diff: { ignore: true }
      responses: { '200': { description: ok } }
`;
  const b = a.replace('List pets', 'List all pets').replace(/    delete:\n      responses: \{ '204': \{ description: gone \} \}\n/, '');
  const r = await compareOpened({ source: new MemorySource({ 'a.yaml': a }), root: 'a.yaml' }, { source: new MemorySource({ 'b.yaml': b }), root: 'b.yaml' });
  const data = JSON.parse(renderExplore(r).match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/)![1]!);
  const section = (rule: string): string => data.rows.find((row: { parts: number[] }) => data.findings[row.parts[0]!].rule === rule).section;
  assert.equal(section('operation-removed'), 'changes');
  assert.equal(section('summary-changed'), 'docs');
  assert.equal(section('version-unchanged'), 'version');
  assert.equal(section('not-compared'), 'notes');
  const bad = await compareOpened({ source: new MemorySource({ 'a.yaml': a }), root: 'a.yaml' }, { source: new MemorySource({ 'b.yaml': 'openapi: 3.1.0\n  bad: [\n' }), root: 'b.yaml' });
  const badData = JSON.parse(renderExplore(bad).match(/id="data">([\s\S]*?)<\/script>/)![1]!);
  assert.ok(badData.rows.some((row: { section: string }) => row.section === 'problems'));
});

test('the page has the group-by control, and keeps working without browser storage', async () => {
  const html = renderExplore(await result());
  assert.match(html, /<select id="group"><option value="place">schema or operation<\/option><option value="none">none<\/option><\/select>/);
  // localStorage can throw (private windows, blocked storage): every use is guarded.
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  for (const use of script.match(/[^\n]*localStorage[^\n]*/g)!) assert.match(use, /try \{/);
});

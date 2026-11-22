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

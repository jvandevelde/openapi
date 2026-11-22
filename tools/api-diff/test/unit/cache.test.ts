// Parse cache: a cached base gives exactly the same result as a fresh parse,
// line numbers included, and anything unreadable is ignored.

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { compareOpened } from '../../src/engine.ts';
import { ParseCache } from '../../src/load/cache.ts';
import { parse } from '../../src/load/parse.ts';
import { MemorySource } from '../../src/sources/memory.ts';

const base = `
openapi: 3.1.0
info: { title: Pets, version: 1.0.0 }
x-shared: &shared
  type: object
  properties: { name: { type: string, maxLength: 20 } }
paths:
  /pets:
    get:
      parameters:
        - { name: limit, in: query, schema: { type: integer } }
      responses:
        '200': { description: ok, content: { application/json: { schema: *shared } } }
`;
const revision = base.replace('maxLength: 20', 'maxLength: 10').replace("- { name: limit, in: query, schema: { type: integer } }", "- { name: limit, in: query, required: true, schema: { type: integer } }");

async function compare(cache?: ParseCache) {
  return compareOpened({ source: new MemorySource({ 'a.yaml': base }), root: 'a.yaml' }, { source: new MemorySource({ 'b.yaml': revision }), root: 'b.yaml' }, cache ? { cache, asOf: '2026-11-22' } : { asOf: '2026-11-22' });
}

test('a cached base gives the same result as a fresh parse', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'api-diff-cache-'));
  try {
    const fresh = await compare();
    const cold = new ParseCache(dir);
    assert.deepEqual(await compare(cold), fresh);
    assert.deepEqual([cold.hits, cold.misses], [0, 1]);
    assert.equal(readdirSync(dir).filter((f) => f.endsWith('.bin')).length, 1);
    const warm = new ParseCache(dir);
    assert.deepEqual(await compare(warm), fresh);
    assert.deepEqual([warm.hits, warm.misses], [1, 0]);
    assert.ok(fresh.findings.some((f) => f.base?.line !== undefined && f.base.line > 1), 'findings carry line numbers');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('positions survive the round trip, through YAML aliases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'api-diff-cache-'));
  try {
    const cache = new ParseCache(dir);
    const p = parse(base, 'a.yaml');
    cache.put(base, p);
    const back = cache.get(base, 'yaml')!;
    for (const segs of [['paths', '/pets', 'get', 'parameters', '0', 'name'], ['x-shared', 'properties', 'name', 'maxLength'], ['paths', '/pets', 'get', 'responses', '200']]) {
      assert.deepEqual(back.positions.lineCol(segs), p.positions.lineCol(segs), segs.join('/'));
    }
    assert.equal(cache.get(base.replace('Pets', 'Cats'), 'yaml'), undefined); // different text, different key
    assert.equal(cache.get(base, 'json'), undefined); // different format, different key
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unreadable entries are ignored and replaced', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'api-diff-cache-'));
  try {
    await compare(new ParseCache(dir));
    const [file] = readdirSync(dir);
    writeFileSync(join(dir, file!), 'not a cache entry');
    const c = new ParseCache(dir);
    assert.deepEqual(await compare(c), await compare());
    assert.equal(c.misses, 1);
    assert.equal(new ParseCache(dir).get(base, 'yaml') !== undefined, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

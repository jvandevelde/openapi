// Generates two large specs (about 8 MB as YAML by default) that differ in a
// few places, and times parsing and the full comparison.
//
//   node test/bench/bench.ts [megabytes]

import { dump } from 'js-yaml';
import { compareOpened } from '../../src/engine.ts';
import { parse } from '../../src/load/parse.ts';
import { MemorySource } from '../../src/sources/memory.ts';
import { ParseCache } from '../../src/load/cache.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const targetMb = Number(process.argv[2] ?? 8);

function generate(changed: boolean): Record<string, unknown> {
  const schemas: Record<string, unknown> = {};
  const paths: Record<string, unknown> = {};
  const spec = { openapi: '3.1.0', info: { title: 'Bench', version: changed ? '2' : '1' }, paths, components: { schemas } };
  let size = 0;
  for (let i = 0; size < targetMb * 1e6; i++) {
    schemas[`Model${i}`] = {
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: { type: 'string', format: 'uuid', description: 'Identifier of the resource' },
        name: { type: 'string', maxLength: 200, description: 'Human readable name' },
        status: { type: 'string', enum: ['active', 'archived', 'pending'] },
        tags: { type: 'array', items: { type: 'string' } },
        parent: { $ref: `#/components/schemas/Model${Math.max(0, i - 1)}` },
      },
    };
    const json = (ref: string) => ({ 'application/json': { schema: { $ref: ref } } });
    paths[`/resource${i}/{id}`] = {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: {
        operationId: `get${i}`,
        tags: [`t${i % 20}`],
        parameters: [{ name: 'expand', in: 'query', required: changed && i % 500 === 0, schema: { type: 'boolean' } }],
        responses: { '200': { description: 'OK', content: json(`#/components/schemas/Model${i}`) }, '404': { description: 'Not found' } },
      },
      put: {
        operationId: `put${i}`,
        requestBody: { required: true, content: json(`#/components/schemas/Model${i}`) },
        responses: { '204': { description: 'Updated' } },
      },
    };
    if (i % 200 === 0) size = JSON.stringify(spec).length * 1.4; // this YAML is about 40% larger than minified JSON
  }
  return spec;
}

const time = async <T>(label: string, fn: () => T | Promise<T>): Promise<T> => {
  const start = performance.now();
  const r = await fn();
  console.log(`${label.padEnd(36)} ${(performance.now() - start).toFixed(0).padStart(6)} ms`);
  return r;
};

const baseSpec = generate(false);
const base = dump(baseSpec);
const rev = dump(generate(true));
const baseJson = JSON.stringify(baseSpec, null, 2);
console.log(`base ${(base.length / 1e6).toFixed(1)} MB, revision ${(rev.length / 1e6).toFixed(1)} MB (YAML)`);
await time('parse one YAML spec (with positions)', () => parse(base, 'base.yaml'));
await time('parse one JSON spec (with positions)', () => parse(baseJson, 'base.json'));
const result = await time('compare (load both, diff, classify)', () =>
  compareOpened({ source: new MemorySource({ 'base.yaml': base }), root: 'base.yaml' }, { source: new MemorySource({ 'rev.yaml': rev }), root: 'rev.yaml' }),
);
console.log(`${result.counts.total} findings, ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB RSS`);

// The opt-in parse cache for the base (--cache-dir): a cold run writes it, a warm run reads it.
const cacheDir = mkdtempSync(join(tmpdir(), 'api-diff-bench-cache-'));
try {
  for (const label of ['compare, base cache cold (writes it)', 'compare, base cache warm']) {
    await time(label, () => compareOpened({ source: new MemorySource({ 'base.yaml': base }), root: 'base.yaml' }, { source: new MemorySource({ 'rev.yaml': rev }), root: 'rev.yaml' }, { cache: new ParseCache(cacheDir) }));
  }
} finally {
  rmSync(cacheDir, { recursive: true, force: true });
}

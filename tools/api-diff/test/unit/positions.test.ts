// Checks positions against independent parsers: the `yaml` package for YAML
// and jsonc-parser's tree for JSON, on random documents.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { dump } from 'js-yaml';
import { findNodeAtLocation, parseTree } from 'jsonc-parser';
import { isMap, isScalar, isSeq, parseDocument, type Node as YNode } from 'yaml';
import { parse } from '../../src/load/parse.ts';

/** Every path to every node in `v`, as segment lists. */
function paths(v: unknown, prefix: string[] = [], out: string[][] = []): string[][] {
  if (Array.isArray(v)) v.forEach((x, i) => (out.push([...prefix, String(i)]), paths(x, [...prefix, String(i)], out)));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (out.push([...prefix, k]), paths(x, [...prefix, k], out));
  return out;
}

/** Offset of the key (mappings) or item (sequences) at `segs`, from the yaml package's AST. */
function yamlOffset(root: YNode | null, segs: string[]): number | undefined {
  let node: unknown = root;
  let off: number | undefined;
  for (const s of segs) {
    if (isMap(node)) {
      const pair = node.items.find((p) => isScalar(p.key) && String(p.key.value) === s);
      if (!pair || !isScalar(pair.key)) return undefined;
      off = pair.key.range?.[0];
      node = pair.value;
    } else if (isSeq(node)) {
      const item = node.items[Number(s)] as YNode | undefined;
      off = item?.range?.[0];
      node = item;
    } else return undefined;
  }
  return off;
}

const key = fc.string({ minLength: 1, maxLength: 8 }).filter((k) => k !== '__proto__' && k !== '<<');
const value = fc.letrec((tie) => ({
  node: fc.oneof({ depthSize: 'small', withCrossShrink: true }, tie('leaf'), tie('obj'), tie('arr')),
  leaf: fc.oneof(fc.string({ maxLength: 10 }), fc.integer(), fc.boolean(), fc.constant(null)),
  obj: fc.dictionary(key, tie('node'), { maxKeys: 4 }),
  arr: fc.array(tie('node'), { maxLength: 4 }),
})).node;
const doc = fc.dictionary(key, value, { minKeys: 1, maxKeys: 5 });

test('YAML positions match the yaml package', () => {
  fc.assert(
    fc.property(doc, fc.boolean(), (d, flow) => {
      const text = dump(d, { flowLevel: flow ? 2 : -1 });
      const ours = parse(text, 'x.yaml');
      const theirs = parseDocument(text);
      for (const segs of paths(d)) {
        const expected = yamlOffset(theirs.contents, segs);
        if (expected === undefined) continue;
        assert.equal(ours.positions.offsetOf(segs), expected, `${JSON.stringify(segs)} in\n${text}`);
      }
    }),
    { numRuns: 200 },
  );
});

test('JSON positions match jsonc-parser', () => {
  fc.assert(
    fc.property(doc, (d) => {
      const text = JSON.stringify(d, null, 2);
      const ours = parse(text, 'x.json');
      const tree = parseTree(text)!;
      for (const segs of paths(d)) {
        const node = findNodeAtLocation(tree, segs.map((s, i) => (Array.isArray(pathValue(d, segs.slice(0, i))) ? Number(s) : s)));
        assert.ok(node);
        const expected = node.parent?.type === 'property' ? node.parent.offset : node.offset;
        assert.equal(ours.positions.offsetOf(segs), expected, `${JSON.stringify(segs)}`);
      }
    }),
    { numRuns: 200 },
  );
});

function pathValue(v: unknown, segs: string[]): unknown {
  let n = v;
  for (const s of segs) n = (n as Record<string, unknown>)[s];
  return n;
}

test('lookups below a scalar or a missing key fall back to the nearest ancestor', () => {
  const p = parse('a:\n  b: 1\n  c: [x, y]\n', 'x.yaml');
  assert.deepEqual(p.positions.lineCol(['a', 'b']), { line: 2, column: 3 });
  assert.deepEqual(p.positions.lineCol(['a', 'b', 'deeper']), { line: 2, column: 3 });
  assert.deepEqual(p.positions.lineCol(['a', 'missing']), { line: 1, column: 1 });
  assert.deepEqual(p.positions.lineCol(['a', 'c', '1']), { line: 3, column: 10 });
});

test('anchors, aliases and merge keys load without breaking positions', () => {
  const text = 'base: &b\n  x: 1\nuse:\n  <<: *b\n  y: 2\nref: *b\n';
  const p = parse(text, 'x.yaml');
  assert.deepEqual(p.value, { base: { x: 1 }, use: { x: 1, y: 2 }, ref: { x: 1 } });
  assert.equal(p.positions.lineCol(['use', 'y']).line, 5);
  assert.equal(p.positions.lineCol(['ref']).line, 6);
});

test('parse errors carry line and column', () => {
  assert.throws(() => parse('a: [1, 2\n', 'x.yaml'), (e: Error & { line?: number }) => /invalid YAML/.test(e.message) && e.line !== undefined);
  assert.throws(() => parse('{"a": }', 'x.json'), (e: Error & { line?: number; column?: number }) => /invalid JSON/.test(e.message) && e.line === 1 && e.column === 7);
  assert.throws(() => parse('a: 1\n---\nb: 2\n', 'x.yaml'), /more than one YAML document/);
});

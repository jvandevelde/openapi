import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { tarjan } from '../../src/index/tarjan.ts';

const sets = (sccs: number[][]): string[] => sccs.map((s) => [...s].sort((a, b) => a - b).join(',')).sort();

test('finds SCCs, self-loops and acyclic nodes', () => {
  // 0 → 1 → 2 → 0 (cycle), 2 → 3, 3 → 3 (self-loop), 4 (alone)
  const r = tarjan([[1], [2], [0, 3], [3], []]);
  assert.deepEqual(sets(r.sccs), ['0,1,2', '3', '4']);
  assert.deepEqual([...r.recursive], [1, 1, 1, 1, 0]);
});

test('SCCs come sinks first (reverse topological order)', () => {
  const r = tarjan([[1], [2], []]);
  assert.deepEqual(r.sccs, [[2], [1], [0]]);
});

test('a 200,000-node chain does not overflow the stack', () => {
  const n = 200_000;
  const edges = Array.from({ length: n }, (_, i) => (i + 1 < n ? [i + 1] : [0]));
  const r = tarjan(edges);
  assert.equal(r.sccs.length, 1);
  assert.equal(r.sccs[0]!.length, n);
});

/** Reference: v and w are in the same SCC iff each reaches the other. */
function reach(edges: number[][], from: number): Set<number> {
  const seen = new Set([from]);
  const todo = [from];
  while (todo.length) for (const w of edges[todo.pop()!]!) if (!seen.has(w)) seen.add(w), todo.push(w);
  return seen;
}

test('matches mutual reachability on random graphs, in reverse topological order', () => {
  const graph = fc.integer({ min: 1, max: 12 }).chain((n) => fc.array(fc.uniqueArray(fc.integer({ min: 0, max: n - 1 }), { maxLength: 4 }), { minLength: n, maxLength: n }));
  fc.assert(
    fc.property(graph, (edges) => {
      const r = tarjan(edges);
      const reaches = edges.map((_, v) => reach(edges, v));
      for (let v = 0; v < edges.length; v++) {
        for (let w = 0; w < edges.length; w++) {
          const same = reaches[v]!.has(w) && reaches[w]!.has(v);
          assert.equal(r.sccOf[v] === r.sccOf[w], same);
        }
        // Every edge goes to the same SCC or an earlier one.
        for (const w of edges[v]!) assert.ok(r.sccOf[w]! <= r.sccOf[v]!);
      }
    }),
    { numRuns: 300 },
  );
});

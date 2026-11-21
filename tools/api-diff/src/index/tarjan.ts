// Tarjan's strongly connected components, iterative (an explicit stack, so
// deep graphs can't overflow the call stack).
//
// Returns SCCs in reverse topological order: every SCC comes after all SCCs
// it has edges to (sinks first), which is the order bottom-up computations
// such as Merkle hashes need.

export interface SccResult {
  /** Components, sinks first. Each lists node indexes. */
  sccs: number[][];
  /** SCC index for each node. */
  sccOf: Int32Array;
  /** True if the node is on a cycle: an SCC of 2+ nodes, or a node with an edge to itself. */
  recursive: Uint8Array;
}

/** `edges[v]` lists the nodes `v` has edges to. */
export function tarjan(edges: readonly (readonly number[])[]): SccResult {
  const n = edges.length;
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const sccOf = new Int32Array(n).fill(-1);
  const recursive = new Uint8Array(n);
  const stack: number[] = [];
  const sccs: number[][] = [];
  let next = 0;

  // Call frames: node and position in its edge list.
  const frameNode: number[] = [];
  const frameEdge: number[] = [];

  for (let root = 0; root < n; root++) {
    if (index[root] !== -1) continue;
    frameNode.push(root);
    frameEdge.push(0);
    index[root] = low[root] = next++;
    stack.push(root);
    onStack[root] = 1;

    while (frameNode.length) {
      const top = frameNode.length - 1;
      const v = frameNode[top]!;
      const out = edges[v]!;
      const e = frameEdge[top]!;
      if (e < out.length) {
        frameEdge[top] = e + 1;
        const w = out[e]!;
        if (w === v) recursive[v] = 1;
        if (index[w] === -1) {
          index[w] = low[w] = next++;
          stack.push(w);
          onStack[w] = 1;
          frameNode.push(w);
          frameEdge.push(0);
        } else if (onStack[w]) {
          low[v] = Math.min(low[v]!, index[w]!);
        }
        continue;
      }
      // All edges of v done.
      frameNode.pop();
      frameEdge.pop();
      if (frameNode.length) {
        const parent = frameNode[frameNode.length - 1]!;
        low[parent] = Math.min(low[parent]!, low[v]!);
      }
      if (low[v] === index[v]) {
        const scc: number[] = [];
        let w: number;
        do {
          w = stack.pop()!;
          onStack[w] = 0;
          sccOf[w] = sccs.length;
          scc.push(w);
        } while (w !== v);
        if (scc.length > 1) for (const x of scc) recursive[x] = 1;
        sccs.push(scc);
      }
    }
  }
  return { sccs, sccOf, recursive };
}

// The schema index of one document: every schema root (component schemas,
// schemas used directly by operations, and every `$ref` target), the `$ref`
// edges between them, strongly connected components, and content hashes.
// Built once per document after loading; nothing is inlined, so recursive
// schemas are safe (see decision record 2026-11-21T0249-schema-index-with-tarjan).

import { dirname, relative, sep } from 'node:path';
import { DocumentSet, encodePointer, type Ref } from '../load/documents.ts';
import type { OasVersion } from '../normalize/normalize.ts';
import { canonicalString, hash, localTree, localTrees, type LocalTrees, type Mode } from './canonical.ts';
import { tarjan } from './tarjan.ts';

export interface Edge {
  to: number;
  /** Where the `$ref` is inside the node. */
  path: string[];
  /** The path passes through a property, `items` or `additionalProperties` step. */
  productive: boolean;
}

export interface SchemaNode {
  i: number;
  /** `<file>#<pointer>` in the source's namespace. */
  id: string;
  ref: Ref;
  /** Name that is the same on both sides: `#/components/schemas/Pet`, or `common.yaml#/Error` for other files. */
  logical: string;
  /** Component schema or `$ref` target (compared by logical name), or only used inline by an operation. */
  named: boolean;
  edges: Edge[];
  local: Record<Mode, string>;
  /** Merkle hashes: the node and everything it references. */
  deep: Record<Mode, string>;
  scc: number;
  recursive: boolean;
  /**
   * For members of a recursive group only: shape hashes in which references inside the group
   * are replaced by each member's position in a canonical order, so they don't depend on the
   * members' names. Used to match renames of recursive schemas; absent when the group's
   * members can't be ordered without their names (members identical apart from names).
   */
  renameKey?: { local: string; deep: string };
}

export interface IndexNotice {
  rule: 'ref-unresolved' | 'cycle-not-productive';
  details: Record<string, unknown>;
  at: Ref;
  logical?: string;
}

export class SchemaIndex {
  readonly nodes: SchemaNode[] = [];
  readonly byId = new Map<string, SchemaNode>();
  readonly byLogical = new Map<string, SchemaNode>();
  readonly reverse: number[][] = [];
  readonly notices: IndexNotice[] = [];
  readonly docs: DocumentSet;
  readonly version: OasVersion;

  private constructor(docs: DocumentSet, version: OasVersion) {
    this.docs = docs;
    this.version = version;
  }

  /**
   * @param usages schema locations used directly by operations (parameter, body, response and header schemas)
   */
  static build(docs: DocumentSet, version: OasVersion, usages: Ref[]): SchemaIndex {
    const idx = new SchemaIndex(docs, version);
    idx.#build(usages);
    return idx;
  }

  #logical(r: Ref): string {
    const ptr = encodePointer(r.segs);
    if (r.file === this.docs.root) return `#${ptr}`;
    return `${relative(dirname(this.docs.root.path), r.file.path).split(sep).join('/')}#${ptr}`;
  }

  #node(r: Ref, named: boolean): SchemaNode {
    const id = `${r.file.path}#${encodePointer(r.segs)}`;
    const existing = this.byId.get(id);
    if (existing) {
      if (named && !existing.named) {
        existing.named = true;
        this.byLogical.set(existing.logical, existing);
      }
      return existing;
    }
    const n: SchemaNode = { i: this.nodes.length, id, ref: r, logical: this.#logical(r), named, edges: [], local: { shape: '', full: '' }, deep: { shape: '', full: '' }, scc: -1, recursive: false };
    this.nodes.push(n);
    this.byId.set(id, n);
    if (named) this.byLogical.set(n.logical, n);
    this.#pending.push(n);
    return n;
  }

  #pending: SchemaNode[] = [];

  /** The normalised local tree of a node (refs replaced by logical names). */
  tree(n: SchemaNode, mode: Mode): unknown {
    return localTree(this.docs.value(n.ref), this.version, mode, (ref) => this.#resolveName(n, ref)).tree;
  }

  #resolveName(n: SchemaNode, ref: string): string | undefined {
    const r = this.docs.resolveRef(n.ref.file, ref);
    return 'error' in r ? undefined : this.#logical(r);
  }

  #build(usages: Ref[]): void {
    const root = this.docs.root;
    const schemas = (root.parsed.value as { components?: { schemas?: Record<string, unknown> } })?.components?.schemas;
    if (schemas && typeof schemas === 'object') for (const name of Object.keys(schemas)) this.#node({ file: root, segs: ['components', 'schemas', name] }, true);
    for (const u of usages) this.#usageIds.add(this.#node(u, false).id);

    const reported = new Set<string>();
    // Trees with $ref slots, kept until every node exists and names can be filled in.
    const pendingTrees = new Map<number, LocalTrees>();
    // For each node, the node each of its trees' $refs resolves to (undefined: unresolved).
    const refTargets = new Map<number, (number | undefined)[]>();
    while (this.#pending.length) {
      const n = this.#pending.pop()!;
      const trees = localTrees(this.docs.value(n.ref), this.version);
      pendingTrees.set(n.i, trees);
      const targets: (number | undefined)[] = [];
      refTargets.set(n.i, targets);
      for (const f of trees.refs) {
        targets.push(undefined);
        const target = this.docs.resolveRef(n.ref.file, f.ref);
        if ('error' in target) {
          const at: Ref = { file: n.ref.file, segs: [...n.ref.segs, ...f.path] };
          const key = `${n.ref.file.path}#${encodePointer(at.segs)}`;
          if (!reported.has(key)) {
            reported.add(key);
            this.notices.push({ rule: 'ref-unresolved', details: { ref: f.ref, reason: target.error }, at: { file: at.file, segs: [...at.segs, '$ref'] } });
          }
          continue;
        }
        const t = this.#node(target, true);
        targets[targets.length - 1] = t.i;
        for (const o of f.slots) o.$ref = t.logical;
        n.edges.push({ to: t.i, path: f.path, productive: f.productive });
      }
    }

    for (const n of this.nodes) {
      const t = pendingTrees.get(n.i)!;
      n.local.shape = hash(canonicalString(t.shape));
      n.local.full = hash(canonicalString(t.full));
      this.reverse.push([]);
    }
    for (const n of this.nodes) for (const e of n.edges) this.reverse[e.to]!.push(n.i);

    const { sccs, sccOf, recursive } = tarjan(this.nodes.map((n) => n.edges.map((e) => e.to)));
    for (const n of this.nodes) {
      n.scc = sccOf[n.i]!;
      n.recursive = recursive[n.i] === 1;
    }
    this.#merkle(sccs);
    this.#checkProductive(sccs);
    this.#renameKeys(sccs, pendingTrees, refTargets);
  }

  /**
   * Name-neutral shape hashes for members of recursive groups (see `SchemaNode.renameKey`).
   * Members are ordered by a hash with every in-group reference blanked out; each in-group
   * reference then becomes `@<position>`, and the group is hashed as one unit as in `#merkle`.
   */
  #renameKeys(sccs: number[][], trees: Map<number, LocalTrees>, refTargets: Map<number, (number | undefined)[]>): void {
    for (const scc of sccs) {
      const members = scc.map((i) => this.nodes[i]!);
      if (!members[0]!.recursive) continue;
      const inScc = new Set(scc);
      /** The member's shape hashes with each in-group reference written as `mark(target)`. */
      const hashes = (m: SchemaNode, mark: (target: number) => string): { local: string; own: string } => {
        const t = trees.get(m.i)!;
        const targets = refTargets.get(m.i)!;
        t.refs.forEach((r, k) => {
          const to = targets[k];
          if (to !== undefined && inScc.has(to)) for (const o of r.slots) o.$ref = mark(to);
        });
        const local = hash(canonicalString(t.shape));
        t.refs.forEach((r, k) => {
          const to = targets[k];
          if (to !== undefined) for (const o of r.slots) o.$ref = this.nodes[to]!.logical;
        });
        const outside = m.edges.map((e) => `${encodePointer(e.path)}=${inScc.has(e.to) ? mark(e.to) : this.nodes[e.to]!.deep.shape}`).sort();
        return { local, own: hash(`${local}|${outside.join(',')}`) };
      };
      const blank = new Map(members.map((m) => [m.i, hashes(m, () => '@').own]));
      const order = [...members].sort((a, b) => (blank.get(a.i)! < blank.get(b.i)! ? -1 : blank.get(a.i)! > blank.get(b.i)! ? 1 : 0));
      // Members identical apart from names can't be told apart without them: no key, so no guessed rename.
      if (new Set(blank.values()).size < members.length) continue;
      const pos = new Map(order.map((m, k) => [m.i, k]));
      const mark = (to: number): string => `@${pos.get(to)}`;
      const own = new Map(members.map((m) => [m.i, hashes(m, mark)]));
      const unit = hash(order.map((m) => `${pos.get(m.i)}=${own.get(m.i)!.own}`).join(';'));
      for (const m of members) m.renameKey = { local: own.get(m.i)!.local, deep: hash(`${own.get(m.i)!.own}|${unit}`) };
    }
  }

  /** Deep hashes bottom-up: sinks first, each recursive SCC hashed as one unit. */
  #merkle(sccs: number[][]): void {
    for (const scc of sccs) {
      const members = scc.map((i) => this.nodes[i]!);
      const inScc = new Set(scc);
      for (const mode of ['shape', 'full'] as const) {
        const own = new Map<number, string>();
        for (const m of members) {
          // Keyed by where the $ref is and sorted, so key order doesn't change the hash.
          const outside = m.edges.map((e) => `${encodePointer(e.path)}=${inScc.has(e.to) ? `@${this.nodes[e.to]!.logical}` : this.nodes[e.to]!.deep[mode]}`).sort();
          own.set(m.i, hash(`${m.local[mode]}|${outside.join(',')}`));
        }
        if (members.length === 1 && !members[0]!.recursive) {
          members[0]!.deep[mode] = own.get(members[0]!.i)!;
          continue;
        }
        const unit = hash(members.map((m) => `${m.logical}=${own.get(m.i)}`).sort().join(';'));
        for (const m of members) m.deep[mode] = hash(`${own.get(m.i)}|${unit}`);
      }
    }
  }

  /** A cycle made only of composition edges (allOf/oneOf/anyOf/$ref) describes no valid value. */
  #checkProductive(sccs: number[][]): void {
    for (const scc of sccs) {
      const members = scc.map((i) => this.nodes[i]!);
      if (!members[0]!.recursive) continue;
      const local = new Map(scc.map((v, k) => [v, k]));
      const edges = scc.map((v) => this.nodes[v]!.edges.filter((e) => !e.productive && local.has(e.to)).map((e) => local.get(e.to)!));
      const sub = tarjan(edges);
      for (const c of sub.sccs) {
        if (!sub.recursive[c[0]!]) continue;
        const nodes = c.map((k) => this.nodes[scc[k]!]!).sort((a, b) => a.logical.localeCompare(b.logical));
        this.notices.push({ rule: 'cycle-not-productive', details: { cycle: nodes.map((n) => n.logical) }, at: nodes[0]!.ref, logical: nodes[0]!.logical });
      }
    }
  }

  /** Usage-root nodes (operation schemas) that reach `n`, following edges backwards. */
  usageRootsReaching(n: SchemaNode): SchemaNode[] {
    const seen = new Uint8Array(this.nodes.length);
    const out: SchemaNode[] = [];
    const todo = [n.i];
    seen[n.i] = 1;
    while (todo.length) {
      const v = todo.pop()!;
      const node = this.nodes[v]!;
      if (this.#usageIds.has(node.id)) out.push(node);
      for (const w of this.reverse[v]!) if (!seen[w]) (seen[w] = 1), todo.push(w);
    }
    return out;
  }

  readonly #usageIds = new Set<string>();

  get(r: Ref): SchemaNode | undefined {
    return this.byId.get(`${r.file.path}#${encodePointer(r.segs)}`);
  }
}

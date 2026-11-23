// Maps JSON Pointers to source offsets without building pointer strings for
// every node. While a parser streams events, `PositionBuilder` walks the
// already-built value tree in step and records, for each object or array, the
// offset of each key or item. A lookup walks the value tree by pointer.

export type Offsets = Map<string, number> | number[];

export class PositionIndex {
  readonly #offsets = new WeakMap<object, Offsets>();
  /** Containers with offsets, in the order they were recorded, for the parse cache. */
  readonly #containers: object[] = [];
  readonly #lineStarts: number[];
  readonly root: unknown;

  constructor(root: unknown, source: string) {
    this.root = root;
    this.#lineStarts = [0];
    for (let i = source.indexOf('\n'); i !== -1; i = source.indexOf('\n', i + 1)) this.#lineStarts.push(i + 1);
  }

  /** @internal used by PositionBuilder */
  set(container: object, offsets: Offsets): void {
    if (!this.#offsets.has(container)) this.#containers.push(container);
    this.#offsets.set(container, offsets);
  }

  /** Every container and its offsets. Serialized with the value (v8.serialize keeps object identity), it restores the index. */
  entries(): [object, Offsets][] {
    return this.#containers.map((c) => [c, this.#offsets.get(c)!]);
  }

  /** Rebuilds an index from `entries()` whose containers are objects inside `root`. */
  static restore(root: unknown, source: string, entries: [object, Offsets][]): PositionIndex {
    const index = new PositionIndex(root, source);
    for (const [c, o] of entries) index.set(c, o);
    return index;
  }

  /** Offset of the node at `segments`, or of its nearest ancestor that has one. */
  offsetOf(segments: readonly string[]): number {
    let node: unknown = this.root;
    let best = 0;
    for (const seg of segments) {
      if (node === null || typeof node !== 'object') break;
      const offs = this.#offsets.get(node);
      let off: number | undefined;
      if (Array.isArray(offs)) off = offs[Number(seg)];
      else off = offs?.get(seg);
      if (off === undefined) break;
      best = off;
      node = (node as Record<string, unknown>)[seg];
    }
    return best;
  }

  /**
   * Offset of whatever follows the node at `segments` in the source: the next
   * sibling of the node or of its nearest ancestor that has one (keys and
   * items are recorded in document order). Undefined if the node runs to the
   * end of the document, or if it can't be found.
   */
  endOffsetOf(segments: readonly string[]): number | undefined {
    let node: unknown = this.root;
    let next: number | undefined;
    for (const seg of segments) {
      if (node === null || typeof node !== 'object') return undefined;
      const offs = this.#offsets.get(node);
      if (!offs) return undefined;
      if (Array.isArray(offs)) {
        const i = Number(seg);
        if (offs[i] === undefined) return undefined;
        if (offs[i + 1] !== undefined) next = offs[i + 1];
      } else {
        if (!offs.has(seg)) return undefined;
        let found = false;
        for (const [k, off] of offs) {
          if (found) { next = off; break; }
          if (k === seg) found = true;
        }
      }
      node = (node as Record<string, unknown>)[seg];
    }
    return next;
  }

  /** Number of lines in the source. */
  get lineCount(): number {
    return this.#lineStarts.length;
  }

  /** 1-based line and column of the node at `segments` (or its nearest ancestor). */
  lineCol(segments: readonly string[]): { line: number; column: number } {
    return this.lineColAt(this.offsetOf(segments));
  }

  /** 1-based line and column of a source offset. */
  lineColAt(off: number): { line: number; column: number } {
    let lo = 0;
    let hi = this.#lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.#lineStarts[mid]! <= off) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: off - this.#lineStarts[lo]! + 1 };
  }
}

interface Frame {
  value: unknown;
  isArray: boolean;
  offsets: Offsets | undefined;
  /** Mappings: the key whose value comes next, or undefined when a key comes next. */
  key: string | undefined;
  /** Sequences: index of the next item. */
  index: number;
  /** A detached container used as a complex mapping key. */
  asKey: boolean;
}

/**
 * Receives parser events in document order. Calls must describe the same
 * structure as `root`. Parts that can't be matched (merge keys, aliases,
 * complex keys) are skipped; lookups there fall back to the nearest ancestor.
 */
export class PositionBuilder {
  readonly #index: PositionIndex;
  readonly #stack: Frame[] = [];
  #rootPending = true;

  constructor(index: PositionIndex) {
    this.#index = index;
  }

  /** The current value slot: the child about to be opened or set. */
  #nextValue(offset: number): unknown {
    if (this.#rootPending) {
      this.#rootPending = false;
      return this.#index.root;
    }
    const top = this.#stack[this.#stack.length - 1];
    if (!top) return undefined;
    if (top.isArray) {
      const i = top.index++;
      if (top.offsets && Array.isArray(top.offsets)) top.offsets[i] = offset;
      return Array.isArray(top.value) ? top.value[i] : undefined;
    }
    const key = top.key;
    top.key = undefined;
    if (key === undefined || top.value === null || typeof top.value !== 'object') return undefined;
    return (top.value as Record<string, unknown>)[key];
  }

  /** A mapping key (a scalar in key position). */
  key(name: string, offset: number): void {
    const top = this.#stack[this.#stack.length - 1];
    if (!top || top.isArray) return;
    top.key = name;
    if (top.offsets instanceof Map && !top.offsets.has(name)) top.offsets.set(name, offset);
  }

  /** True if the next event in the current mapping is a key. */
  expectsKey(): boolean {
    const top = this.#stack[this.#stack.length - 1];
    return !!top && !top.isArray && top.key === undefined;
  }

  scalar(offset: number): void {
    this.#nextValue(offset);
  }

  open(isArray: boolean, offset: number): void {
    const value = this.#nextValue(offset);
    const ok = value !== null && typeof value === 'object' && Array.isArray(value) === isArray;
    const offsets: Offsets | undefined = ok ? (isArray ? [] : new Map()) : undefined;
    if (ok && offsets) this.#index.set(value as object, offsets);
    this.#stack.push({ value: ok ? value : undefined, isArray, offsets, key: undefined, index: 0, asKey: false });
  }

  /** Opens a collection used as a mapping key. Its value isn't tracked. */
  openKey(isArray: boolean): void {
    this.#stack.push({ value: undefined, isArray, offsets: undefined, key: undefined, index: 0, asKey: true });
  }

  close(): void {
    const frame = this.#stack.pop();
    const top = this.#stack[this.#stack.length - 1];
    // After a complex key, the next node is its (untracked) value.
    if (frame?.asKey && top && !top.isArray) top.key = '\u0000';
  }
}

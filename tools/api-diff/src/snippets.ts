// Source snippets for the explore report. Each side of a finding gets a few
// lines around the changed line, the place's path from the document root
// (each step with its line, for the breadcrumb), the enclosing schema or
// operation (so the page can expand to show all of it) and, when the node is a
// `$ref`, the referenced node. The lines of scopes and targets are stored once
// per file and side in `sourceLines`, since many findings share a schema.
// See decision record 2026-11-23T2219-explore-expands-to-the-enclosing-schema.

import { encodePointer, type DocumentSet, type LoadedFile } from './load/documents.ts';
import type { Finding, Location, Result, Snippet, SnippetBlock } from './types.ts';

/** Lines shown either side of the changed line before the snippet is expanded. */
export const SNIPPET_CONTEXT = 4;
/** The most lines an expanded scope or `$ref` target shows. A longer scope is narrowed to the outermost node on the path that fits. */
export const SCOPE_MAX_LINES = 400;
/** Longer source lines are cut, so one minified line can't blow up the page. */
const MAX_LINE_LENGTH = 300;

type Side = 'base' | 'revision';
type Lines = NonNullable<Result['sourceLines']>[Side];

const cutLine = (s: string): string => (s.length > MAX_LINE_LENGTH ? `${s.slice(0, MAX_LINE_LENGTH)}…` : s);

/** A finding's pointer as segments (pointers in findings are not URI-encoded). */
function segmentsOf(pointer: string): string[] | undefined {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) return undefined;
  return pointer.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/** The named place a path is in: a component, a Swagger 2 definition, an operation or webhook, or a path item; else the top-level key. */
function scopeDepth(segs: readonly string[], isRootFile: boolean): number {
  if (!isRootFile) return 0; // a file of its own is usually one schema
  const [a] = segs;
  if (a === 'components' && segs.length >= 3) return 3;
  if ((a === 'definitions' || a === 'parameters' || a === 'responses') && segs.length >= 2) return 2;
  if ((a === 'paths' || a === 'webhooks') && segs.length >= 2) return segs.length >= 3 && /^(get|put|post|delete|options|head|patch|trace|query)$/.test(segs[2]!) ? 3 : 2;
  return Math.min(1, segs.length);
}

class Builder {
  readonly #files: Map<string, LoadedFile>;
  readonly #docs: DocumentSet;
  readonly #lines: Lines = {};
  readonly #text = new Map<LoadedFile, string[]>();

  constructor(docs: DocumentSet) {
    this.#docs = docs;
    this.#files = new Map([...docs.files.values()].map((f) => [f.display, f]));
  }

  get lines(): Lines {
    return this.#lines;
  }

  #textOf(file: LoadedFile): string[] {
    let t = this.#text.get(file);
    if (!t) this.#text.set(file, (t = file.text.split(/\r?\n/)));
    return t;
  }

  /** First and last line of the node at `segs`, trailing blank lines dropped. */
  #range(file: LoadedFile, segs: readonly string[]): { start: number; end: number } {
    const pos = file.parsed.positions;
    const text = this.#textOf(file);
    const start = pos.lineCol(segs).line;
    const after = pos.endOffsetOf(segs);
    let end = after === undefined ? text.length : pos.lineColAt(after).line - 1;
    while (end > start && !text[end - 1]?.trim()) end--;
    return { start, end: Math.max(start, end) };
  }

  /** Records the lines of a block in `sourceLines` and returns the block. */
  #block(file: LoadedFile, segs: readonly string[], line: number): SnippetBlock | undefined {
    const { start, end } = this.#range(file, segs);
    if (end - start + 1 > SCOPE_MAX_LINES) return undefined;
    const text = this.#textOf(file);
    const into = (this.#lines[file.display] ??= {});
    for (let n = start; n <= end; n++) into[n] ??= cutLine(text[n - 1] ?? '');
    return { pointer: encodePointer(segs), start, end, line };
  }

  /** The path from the root to `segs` (the breadcrumb) and the enclosing schema or operation, or the outermost node below it that fits. */
  #place(file: LoadedFile, segs: readonly string[], line: number): Pick<Snippet, 'path' | 'scope'> {
    const pos = file.parsed.positions;
    const out: Pick<Snippet, 'path' | 'scope'> = { path: segs.map((key, i) => ({ key, line: pos.lineCol(segs.slice(0, i + 1)).line })) };
    for (let d = scopeDepth(segs, file === this.#docs.root); d <= segs.length; d++) {
      const block = this.#block(file, segs.slice(0, d), line);
      if (block) {
        out.scope = block;
        break;
      }
    }
    return out;
  }

  /** True if this side has a node at `pointer` in the file shown as `display` on the other side (the root file matches the root, whatever its name). */
  has(display: string, pointer: string, fromRoot: boolean): boolean {
    const file = fromRoot ? this.#docs.root : this.#files.get(display);
    const segs = segmentsOf(pointer);
    return !!file && !!segs && this.#docs.value({ file, segs }) !== undefined;
  }

  /** The root file's display name. */
  get rootName(): string {
    return this.#docs.root.display;
  }

  /**
   * For an item only one side has (an operation added or removed): the nearest ancestor of `s`'s
   * scope that the other side has too, if it's a path item or a component's part and fits. Widens
   * `s`'s scope to it and returns that pointer's segments, so the other side can show the same node.
   */
  widenToShared(s: Snippet, other: Builder): string[] | undefined {
    const file = this.#files.get(s.file);
    const segs = s.scope ? segmentsOf(s.scope.pointer) : undefined;
    if (!file || file !== this.#docs.root || !segs) return undefined;
    for (let d = segs.length - 1; d >= 2; d--) {
      const anc = segs.slice(0, d);
      if (anc[0] === 'components' && d < 3) continue; // /components/schemas is no context
      if (anc[0] === 'info') return undefined;
      if (!other.has(other.rootName, encodePointer(anc), true)) continue;
      const block = this.#block(file, anc, s.line);
      if (!block) return undefined;
      s.scope = block;
      return anc;
    }
    return undefined;
  }

  /** A snippet of a node this side has but the finding has no location on: the node's lines, nothing highlighted. */
  context(segs: string[]): Snippet | undefined {
    const file = this.#docs.root;
    const block = this.#block(file, segs, file.parsed.positions.lineCol(segs).line);
    if (!block) return undefined;
    const pos = file.parsed.positions;
    return { file: file.display, start: block.start, line: block.start, lines: [], absent: true, scope: block, path: segs.map((key, i) => ({ key, line: pos.lineCol(segs.slice(0, i + 1)).line })) };
  }

  snippet(l: Location | undefined, other?: Builder): Snippet | undefined {
    const file = l?.line ? this.#files.get(l.file) : undefined;
    if (!l?.line || !file) return undefined;
    const text = this.#textOf(file);
    const start = Math.max(1, l.line - SNIPPET_CONTEXT);
    const end = Math.min(text.length, l.line + SNIPPET_CONTEXT);
    const s: Snippet = { file: l.file, start, line: l.line, lines: text.slice(start - 1, end).map(cutLine) };
    const segs = segmentsOf(l.pointer);
    if (!segs) return s;
    Object.assign(s, this.#place(file, segs, l.line));
    // `$ref`s only this side went through: each one's place, so the page shows the schema both
    // sides have in common (with the `$ref` line) before the one the change is in.
    const hops: NonNullable<Snippet['via']> = [];
    for (const v of l.via ?? []) {
      const vf = v.line ? this.#files.get(v.file) : undefined;
      const vs = segmentsOf(v.pointer);
      const node = vf && vs ? this.#docs.value({ file: vf, segs: vs }) : undefined;
      const name = node !== null && typeof node === 'object' && !Array.isArray(node) ? (node as Record<string, unknown>).$ref : undefined;
      if (!vf || !vs || typeof name !== 'string') break; // keep the hops up to the first one we can't show
      hops.push({ file: v.file, line: v.line!, name, ...this.#place(vf, vs, v.line!) });
    }
    if (hops.length) {
      s.via = hops;
      if (other && s.scope && !other.has(l.file, s.scope.pointer, file === this.#docs.root)) s.scopeIsNew = true;
    }
    // A `$ref` (the node itself, or its `$ref` key): the node it points at. One hop, and
    // resolveRef records no notices (the result's notices are already final).
    const last = segs.at(-1) === '$ref';
    const node = this.#docs.value({ file, segs: last ? segs.slice(0, -1) : segs });
    const ref = node !== null && typeof node === 'object' && !Array.isArray(node) ? (node as Record<string, unknown>).$ref : undefined;
    if (typeof ref === 'string') {
      const t = this.#docs.resolveRef(file, ref);
      const block = 'error' in t ? undefined : this.#block(t.file, t.segs, t.file.parsed.positions.lineCol(t.segs).line);
      if (block && !('error' in t)) {
        s.ref = { ...block, file: t.file.display, name: ref };
        if (other && !other.has(t.file.display, block.pointer, t.file === this.#docs.root)) s.ref.isNew = true;
      }
    }
    return s;
  }
}

/** Snippets for each finding's base and revision locations, and the lines their scopes and `$ref` targets need. */
export function snippetsFor(findings: Finding[], base: DocumentSet | undefined, rev: DocumentSet | undefined): Pick<Result, 'snippets' | 'sourceLines'> {
  const b = base ? new Builder(base) : undefined;
  const r = rev ? new Builder(rev) : undefined;
  const out: NonNullable<Result['snippets']> = {};
  for (const f of findings) {
    const s: { base?: Snippet; revision?: Snippet } = {};
    let bs = b?.snippet(f.base, r);
    let rs = r?.snippet(f.revision, b);
    // Only one side has it (an operation added or removed): show the path item it is in on both sides.
    if (bs && !rs && b && r) {
      const anc = b.widenToShared(bs, r);
      if (anc) rs = r.context(anc);
    } else if (rs && !bs && b && r) {
      const anc = r.widenToShared(rs, b);
      if (anc) bs = b.context(anc);
    }
    if (bs) s.base = bs;
    if (rs) s.revision = rs;
    if (bs || rs) out[f.id] = s;
  }
  const sourceLines: NonNullable<Result['sourceLines']> = { base: b?.lines ?? {}, revision: r?.lines ?? {} };
  return { snippets: out, sourceLines };
}

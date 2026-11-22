// Loads a root document and every file it reaches through `$ref`, from one
// document source. References are resolved on demand; nothing is inlined, so
// recursive schemas are safe.

import { createHash } from 'node:crypto';
import type { DocumentSource } from '../sources/source.ts';
import type { Location } from '../types.ts';
import { detectFormat, parse, ParseError, type Parsed } from './parse.ts';
import type { ParseCache } from './cache.ts';

export interface LoadedFile {
  /** Path in the source's namespace. */
  path: string;
  display: string;
  parsed: Parsed;
  sha256: string;
}

/** A node in a loaded file: the file and the JSON Pointer segments. */
export interface Ref {
  file: LoadedFile;
  segs: readonly string[];
}

export interface Notice {
  rule: 'spec-invalid' | 'ref-unresolved' | 'not-compared';
  details: Record<string, unknown>;
  at?: Location;
}

export function encodePointer(segs: readonly string[]): string {
  let out = '';
  for (const s of segs) out += '/' + (s.includes('~') || s.includes('/') ? s.replace(/~/g, '~0').replace(/\//g, '~1') : s);
  return out;
}

export function decodePointer(fragment: string): string[] | undefined {
  if (fragment === '') return [];
  if (!fragment.startsWith('/')) return undefined;
  return fragment
    .slice(1)
    .split('/')
    .map((s) => {
      let v = s;
      try {
        v = decodeURIComponent(s);
      } catch {
        /* keep as is */
      }
      return v.replace(/~1/g, '/').replace(/~0/g, '~');
    });
}

export function getAt(root: unknown, segs: readonly string[]): unknown {
  let node = root;
  for (const s of segs) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[s];
  }
  return node;
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export class LoadError extends Error {}

export class DocumentSet {
  readonly source: DocumentSource;
  readonly files = new Map<string, LoadedFile>();
  readonly notices: Notice[] = [];
  root!: LoadedFile;
  readonly #rootPath: string;
  readonly #cache: ParseCache | undefined;

  constructor(source: DocumentSource, rootPath: string, cache?: ParseCache) {
    this.source = source;
    this.#rootPath = rootPath;
    this.#cache = cache;
  }

  /** Loads the root file (errors are thrown) and every referenced file (errors become notices). */
  async load(): Promise<void> {
    this.root = await this.#loadFile(this.#rootPath);
    const queue: LoadedFile[] = [this.root];
    const requested = new Set([this.#rootPath]);
    let externalUrls = 0;
    while (queue.length) {
      const file = queue.shift()!;
      const wanted: { path: string; ref: string; at: Ref }[] = [];
      walkRefs(file.parsed.value, (ref, segs) => {
        const hash = ref.indexOf('#');
        const filePart = hash === -1 ? ref : ref.slice(0, hash);
        if (filePart === '') return;
        if (/^[a-z][a-z0-9+.-]*:/i.test(filePart)) {
          externalUrls++;
          return;
        }
        let path: string;
        try {
          path = this.source.resolve(file.path, filePart);
        } catch (e) {
          this.notices.push({ rule: 'ref-unresolved', details: { ref, reason: (e as Error).message }, at: this.location({ file, segs }) });
          return;
        }
        if (!requested.has(path)) {
          requested.add(path);
          wanted.push({ path, ref, at: { file, segs: [...segs] } });
        }
      });
      const loaded = await Promise.all(
        wanted.map(async (w) => {
          try {
            return await this.#loadFile(w.path);
          } catch (e) {
            this.notices.push({ rule: 'ref-unresolved', details: { ref: w.ref, reason: (e as Error).message }, at: this.location(w.at) });
            return undefined;
          }
        }),
      );
      for (const f of loaded) if (f) queue.push(f);
    }
    if (externalUrls) this.notices.push({ rule: 'not-compared', details: { what: `${externalUrls} $ref(s) to external URLs`, count: externalUrls } });
  }

  async #loadFile(path: string): Promise<LoadedFile> {
    const text = await this.source.read(path);
    const display = this.source.display(path);
    let parsed: Parsed;
    try {
      const format = detectFormat(display, text);
      const cached = this.#cache?.get(text, format);
      parsed = cached ?? parse(text, display, format);
      if (!cached) this.#cache?.put(text, parsed);
    } catch (e) {
      if (e instanceof ParseError) {
        const where = e.line ? `${display}:${e.line}${e.column ? `:${e.column}` : ''}` : display;
        throw new LoadError(`${where}: ${e.message}`);
      }
      throw e;
    }
    const file: LoadedFile = { path, display, parsed, sha256: createHash('sha256').update(text).digest('hex') };
    this.files.set(path, file);
    return file;
  }

  location(r: Ref): Location {
    const { line, column } = r.file.parsed.positions.lineCol(r.segs);
    return { file: r.file.display, pointer: encodePointer(r.segs), line, column };
  }

  value(r: Ref): unknown {
    return getAt(r.file.parsed.value, r.segs);
  }

  /** Resolves one `$ref` string found in `from`. */
  resolveRef(from: LoadedFile, ref: string): Ref | { error: string } {
    const hash = ref.indexOf('#');
    const filePart = hash === -1 ? ref : ref.slice(0, hash);
    const fragment = hash === -1 ? '' : ref.slice(hash + 1);
    let file = from;
    if (filePart !== '') {
      if (/^[a-z][a-z0-9+.-]*:/i.test(filePart)) return { error: 'external URLs are not supported' };
      let path: string;
      try {
        path = this.source.resolve(from.path, filePart);
      } catch (e) {
        return { error: (e as Error).message };
      }
      const f = this.files.get(path);
      if (!f) return { error: `${this.source.display(path)} could not be loaded` };
      file = f;
    }
    const segs = decodePointer(fragment);
    if (!segs) return { error: `only JSON Pointer fragments are supported (got '#${fragment}')` };
    if (getAt(file.parsed.value, segs) === undefined) return { error: `${encodePointer(segs) || '/'} doesn't exist in ${file.display}` };
    return { file, segs };
  }

  /**
   * Follows `$ref` chains from the node at `r`. Returns the final node, or an
   * error notice (already recorded) if a reference can't be resolved.
   */
  deref(r: Ref): { ref: Ref; value: unknown } | undefined {
    let cur = r;
    let value = this.value(cur);
    const seen = new Set<string>();
    while (isObject(value) && typeof value.$ref === 'string') {
      const key = `${cur.file.path}#${encodePointer(cur.segs)}`;
      if (seen.has(key)) {
        this.#unresolved(r, value.$ref, 'the $ref chain loops back on itself');
        return undefined;
      }
      seen.add(key);
      const next = this.resolveRef(cur.file, value.$ref);
      if ('error' in next) {
        this.#unresolved(cur, value.$ref, next.error);
        return undefined;
      }
      cur = next;
      value = this.value(cur);
    }
    return { ref: cur, value };
  }

  readonly #reported = new Set<string>();

  #unresolved(at: Ref, ref: string, reason: string): void {
    const loc = this.location(at);
    const key = `${loc.file}#${loc.pointer}`;
    if (this.#reported.has(key)) return;
    this.#reported.add(key);
    this.notices.push({ rule: 'ref-unresolved', details: { ref, reason }, at: { ...loc, pointer: loc.pointer + '/$ref' } });
  }
}

interface Link {
  parent: Link | null;
  key: string;
}

/** Calls `fn` for every `$ref` string in `root`, iteratively (no recursion limit). Paths are only built for `$ref`s. */
export function walkRefs(root: unknown, fn: (ref: string, segs: readonly string[]) => void): void {
  const nodes: unknown[] = [root];
  const links: (Link | null)[] = [null];
  while (nodes.length) {
    const node = nodes.pop();
    const link = links.pop()!;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const v = node[i];
        if (v !== null && typeof v === 'object') nodes.push(v), links.push({ parent: link, key: String(i) });
      }
    } else if (node !== null && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      if (typeof obj.$ref === 'string') {
        const segs: string[] = [];
        for (let x: Link | null = link; x; x = x.parent) segs.push(x.key);
        fn(obj.$ref, segs.reverse());
      }
      for (const k in obj) {
        const v = obj[k];
        if (v !== null && typeof v === 'object') nodes.push(v), links.push({ parent: link, key: k });
      }
    }
  }
}

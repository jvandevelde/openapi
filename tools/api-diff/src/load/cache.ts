// Parse cache (opt-in, --cache-dir): parsed documents with their source
// positions, keyed by a SHA-256 of the file's text, the tool version, the
// Node.js version and the format. In CI the base (usually main) rarely
// changes between runs, so its files are parsed once and then read back.
//
// Entries are written with v8.serialize, which keeps object identity: the
// position index's containers come back as the same objects inside the
// value, YAML aliases included. Anything unreadable or from another version
// is ignored and replaced.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deserialize, serialize } from 'node:v8';
import { VERSION } from '../version.ts';
import type { Parsed } from './parse.ts';
import { PositionIndex, type Offsets } from './positions.ts';

interface Entry {
  value: unknown;
  format: Parsed['format'];
  positions: [object, Offsets][];
}

/** What DocumentSet needs from a parse cache. */
export interface ParseCacheLike {
  get(text: string, format: Parsed['format']): Parsed | undefined;
  put(text: string, parsed: Parsed): void;
}

/**
 * An in-memory cache of the last few parsed files, for history: each version
 * is the revision of one step and the base of the next, so it's parsed once.
 */
export class MemoryParseCache implements ParseCacheLike {
  readonly #entries = new Map<string, Parsed>();
  readonly #max: number;
  constructor(max = 64) {
    this.#max = max;
  }
  #key(text: string, format: string): string {
    return `${format}\u0000${createHash('sha256').update(text).digest('hex')}`;
  }
  get(text: string, format: Parsed['format']): Parsed | undefined {
    const k = this.#key(text, format);
    const hit = this.#entries.get(k);
    if (hit) {
      this.#entries.delete(k);
      this.#entries.set(k, hit); // most recently used last
    }
    return hit;
  }
  put(text: string, parsed: Parsed): void {
    this.#entries.set(this.#key(text, parsed.format), parsed);
    while (this.#entries.size > this.#max) this.#entries.delete(this.#entries.keys().next().value!);
  }
}

export class ParseCache implements ParseCacheLike {
  readonly dir: string;
  hits = 0;
  misses = 0;

  constructor(dir: string) {
    this.dir = dir;
  }

  #path(text: string, format: string): string {
    const key = createHash('sha256').update(`api-diff ${VERSION}\u0000node ${process.versions.node}\u0000${format}\u0000`).update(text).digest('hex');
    return join(this.dir, `parse-${key}.bin`);
  }

  get(text: string, format: Parsed['format']): Parsed | undefined {
    try {
      const e = deserialize(readFileSync(this.#path(text, format))) as Entry;
      if (e.format !== format || !Array.isArray(e.positions)) throw new Error('mismatch');
      this.hits++;
      return { value: e.value, format: e.format, positions: PositionIndex.restore(e.value, text, e.positions) };
    } catch {
      this.misses++;
      return undefined;
    }
  }

  put(text: string, parsed: Parsed): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      const path = this.#path(text, parsed.format);
      const tmp = `${path}.${process.pid}.tmp`;
      const entry: Entry = { value: parsed.value, format: parsed.format, positions: parsed.positions.entries() };
      writeFileSync(tmp, serialize(entry));
      renameSync(tmp, path); // atomic, so a concurrent run never reads half a file
    } catch {
      // A cache that can't be written just isn't used.
    }
  }
}

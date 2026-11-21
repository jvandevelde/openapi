import { posix } from 'node:path';
import { SourceError, type DocumentSource } from './source.ts';

/** Documents held in memory, keyed by `/`-separated paths. Useful for tests and editor integrations. */
export class MemorySource implements DocumentSource {
  readonly info: { input: string };
  readonly #files: Map<string, string>;

  constructor(files: Record<string, string>, input = 'memory') {
    this.#files = new Map(Object.entries(files));
    this.info = { input };
  }

  async read(path: string): Promise<string> {
    const text = this.#files.get(path);
    if (text === undefined) throw new SourceError(`file not found: ${path}`);
    return text;
  }

  resolve(from: string, ref: string): string {
    return posix.normalize(posix.join(posix.dirname(from), decodeURIComponent(ref)));
  }

  display(path: string): string {
    return path;
  }

  close(): void {}
}

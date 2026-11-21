import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { SourceError, type DocumentSource } from './source.ts';

/** Reads files from disk. Paths are absolute; display names are relative to `cwd`. */
export class FsSource implements DocumentSource {
  readonly info: { input: string };
  readonly #cwd: string;

  constructor(input: string, cwd: string) {
    this.info = { input };
    this.#cwd = cwd;
  }

  async read(path: string): Promise<string> {
    try {
      return await readFile(path, 'utf8');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      throw new SourceError(code === 'ENOENT' ? `file not found: ${this.display(path)}` : `can't read ${this.display(path)}: ${(e as Error).message}`);
    }
  }

  resolve(from: string, ref: string): string {
    return resolve(dirname(from), decodeURIComponent(ref));
  }

  display(path: string): string {
    const rel = relative(this.#cwd, path);
    return (rel === '' || isAbsolute(rel) ? path : rel).split(sep).join('/');
  }

  close(): void {}
}

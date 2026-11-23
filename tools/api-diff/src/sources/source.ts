// A document source reads files for one side of a comparison. The engine only
// sees this interface, so it never knows whether files come from disk, git or
// memory (see decision record 2026-11-21T0352-git-revision-inputs).

export interface DocumentSource {
  /** Reads a file. `path` is in the source's own namespace (see `resolve`). */
  read(path: string): Promise<string>;
  /** Resolves `ref` (a relative file reference) against the file `from`. */
  resolve(from: string, ref: string): string;
  /** Name shown in reports, e.g. `openapi.yaml` or `main:openapi.yaml`. */
  display(path: string): string;
  /** Identity of the source shown in reports. */
  readonly info: { input: string; commit?: string };
  /** Tags on the source's commit (git sources only), for the `git-tag` version source. */
  tagsAt?(): Promise<string[]>;
  /** Releases resources (e.g. a git process). */
  close(): void;
}

export class SourceError extends Error {}

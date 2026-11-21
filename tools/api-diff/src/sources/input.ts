// Turns command-line inputs into document sources.
//
//   openapi.yaml            a file
//   main:openapi.yaml       the file at a git revision
//   :openapi.yaml           the staged version
//   main...:openapi.yaml    the file at the merge-base of main and the other side
//
// An argument is read as `rev:path` only if no file with that exact name
// exists and the part before `:` resolves to a commit.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { FsSource } from './fs.ts';
import { GitSource, locate, resolveRevision } from './git.ts';
import { SourceError, type DocumentSource } from './source.ts';

export type InputSpec = { kind: 'fs'; arg: string; path: string } | { kind: 'git'; arg: string; rev: string; path: string };

export interface OpenedInput {
  source: DocumentSource;
  /** Root file path in the source's namespace. */
  root: string;
}

/** Splits `arg` into a file or a git `rev:path`, without checking the revision yet. */
export function parseInput(arg: string, cwd: string): InputSpec {
  if (arg === '') throw new SourceError('empty input');
  if (existsSync(resolve(cwd, arg))) return { kind: 'fs', arg, path: arg };
  if (/^[A-Za-z]:[\\/]/.test(arg)) return { kind: 'fs', arg, path: arg };
  const i = arg.indexOf(':');
  if (i === -1) return { kind: 'fs', arg, path: arg };
  return { kind: 'git', arg, rev: arg.slice(0, i), path: arg.slice(i + 1) };
}

/**
 * Builds the base and revision inputs from the command line:
 * `<base> <revision>`, or `--base <rev> [--revision <rev>] <path>`.
 */
export function inputsFromArgs(positionals: string[], opts: { base?: string; revision?: string }, cwd: string): [InputSpec, InputSpec] {
  if (opts.base !== undefined || opts.revision !== undefined) {
    if (positionals.length !== 1) throw new SourceError('with --base or --revision, give exactly one file path');
    const path = positionals[0]!;
    const mk = (rev: string | undefined, label: string): InputSpec => (rev === undefined ? { kind: 'fs', arg: path, path } : { kind: 'git', arg: `${rev}:${path}`, rev, path: label });
    return [mk(opts.base, path), mk(opts.revision, path)];
  }
  if (positionals.length !== 2) throw new SourceError('give two inputs: <base> <revision>');
  return [parseInput(positionals[0]!, cwd), parseInput(positionals[1]!, cwd)];
}

export async function open(spec: InputSpec, cwd: string, other?: InputSpec): Promise<OpenedInput> {
  if (spec.kind === 'fs') {
    const abs = resolve(cwd, spec.path);
    if (!existsSync(abs)) throw new SourceError(`file not found: ${spec.path}`);
    return { source: new FsSource(spec.arg, cwd), root: abs };
  }
  const target = await locate(cwd, spec.path);
  let commit = '';
  if (spec.rev !== '') {
    const otherRev = other?.kind === 'git' && other.rev !== '' && !other.rev.endsWith('...') ? other.rev : 'HEAD';
    try {
      commit = await resolveRevision(target.toplevel, spec.rev, otherRev);
    } catch (e) {
      if (e instanceof SourceError && e.message === `revision '${spec.rev}' not found`) {
        throw new SourceError(`'${spec.arg}' is not a file, and '${spec.rev}' is not a git revision`);
      }
      throw e;
    }
  }
  const source = new GitSource(spec.arg, target.toplevel, spec.rev === '' ? '' : spec.rev, commit, cwd);
  return { source, root: target.path };
}

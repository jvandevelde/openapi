// Reads files at a git revision through one long-running `git cat-file
// --batch` process. Git runs in the repository that contains the spec, so the
// tool works from any repository.

import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { SourceError, type DocumentSource } from './source.ts';

const exec = promisify(execFile);

export async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return stdout.trim();
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === 'ENOENT') throw new SourceError('git is not installed or not on the PATH');
    throw new SourceError((err.stderr || err.message).trim());
  }
}

async function tryGit(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    return await git(cwd, args);
  } catch {
    return undefined;
  }
}

/** Nearest existing directory at or above `dir`, so git can run there even if the file doesn't exist in the working tree. */
function existingDir(dir: string): string {
  let d = dir;
  while (!existsSync(d)) {
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  return d;
}

export interface GitTarget {
  /** Repository root (absolute). */
  toplevel: string;
  /** Path of the file relative to the repository root, with `/` separators. */
  path: string;
}

export async function locate(cwd: string, file: string): Promise<GitTarget> {
  const abs = resolve(cwd, file);
  const toplevel = await tryGit(existingDir(dirname(abs)), ['rev-parse', '--show-toplevel']);
  if (!toplevel) throw new SourceError(`${file} is not inside a git repository`);
  return { toplevel, path: relative(toplevel, abs).split(sep).join('/') };
}

export function checkRev(rev: string): void {
  if (rev.startsWith('-')) throw new SourceError(`invalid revision '${rev}'`);
}

/** Resolves a revision to a commit SHA, with a helpful error for shallow clones. */
export async function resolveCommit(toplevel: string, rev: string): Promise<string> {
  checkRev(rev);
  const sha = await tryGit(toplevel, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${rev}^{commit}`]);
  if (sha) return sha;
  const shallow = await tryGit(toplevel, ['rev-parse', '--is-shallow-repository']);
  if (shallow === 'true') {
    throw new SourceError(
      `revision '${rev}' not found, and this is a shallow clone. Fetch more history, e.g. 'git fetch --unshallow', 'git fetch --depth=1 origin ${rev}', or in GitHub Actions 'fetch-depth: 0'.`,
    );
  }
  throw new SourceError(`revision '${rev}' not found`);
}

/** `main...` (merge-base with `other`, HEAD by default) or a plain revision. */
export async function resolveRevision(toplevel: string, rev: string, other = 'HEAD'): Promise<string> {
  if (rev.endsWith('...')) {
    const a = rev.slice(0, -3) || 'HEAD';
    checkRev(a);
    checkRev(other);
    const ca = await resolveCommit(toplevel, a);
    const cb = await resolveCommit(toplevel, other);
    const mb = await tryGit(toplevel, ['merge-base', ca, cb]);
    if (!mb) throw new SourceError(`no merge-base between '${a}' and '${other}'`);
    return mb;
  }
  return resolveCommit(toplevel, rev);
}

interface Pending {
  resolve: (v: Buffer | undefined) => void;
  reject: (e: Error) => void;
}

/** Minimal `git cat-file --batch` client: requests are answered in order. */
class CatFile {
  readonly #proc: ChildProcessWithoutNullStreams;
  readonly #queue: Pending[] = [];
  #buf: Buffer = Buffer.alloc(0);
  #error: Error | undefined;

  constructor(cwd: string) {
    this.#proc = spawn('git', ['cat-file', '--batch'], { cwd });
    this.#proc.stdout.on('data', (chunk: Buffer) => {
      this.#buf = this.#buf.length ? Buffer.concat([this.#buf, chunk]) : chunk;
      this.#drain();
    });
    const fail = (e: Error): void => {
      this.#error = e;
      for (const p of this.#queue.splice(0)) p.reject(e);
    };
    this.#proc.on('error', (e) => fail(new SourceError(`can't run git: ${e.message}`)));
    this.#proc.on('exit', (code) => {
      if (this.#queue.length) fail(new SourceError(`git cat-file exited with code ${code}`));
    });
  }

  #drain(): void {
    while (this.#queue.length) {
      const nl = this.#buf.indexOf(10);
      if (nl === -1) return;
      const header = this.#buf.subarray(0, nl).toString('utf8');
      if (header.endsWith(' missing') || header.endsWith(' ambiguous')) {
        this.#buf = this.#buf.subarray(nl + 1);
        this.#queue.shift()!.resolve(undefined);
        continue;
      }
      const size = Number(header.split(' ')[2]);
      if (!Number.isFinite(size)) {
        this.#queue.shift()!.reject(new SourceError(`unexpected git output: ${header}`));
        this.#buf = this.#buf.subarray(nl + 1);
        continue;
      }
      if (this.#buf.length < nl + 1 + size + 1) return;
      const body = this.#buf.subarray(nl + 1, nl + 1 + size);
      this.#buf = this.#buf.subarray(nl + 1 + size + 1);
      this.#queue.shift()!.resolve(Buffer.from(body));
    }
  }

  get(object: string): Promise<Buffer | undefined> {
    if (this.#error) return Promise.reject(this.#error);
    return new Promise((res, rej) => {
      this.#queue.push({ resolve: res, reject: rej });
      this.#proc.stdin.write(`${object}\n`);
    });
  }

  close(): void {
    this.#proc.stdin.end();
  }
}

/** Reads files at one commit. Paths are repository-root-relative with `/` separators. */
export class GitSource implements DocumentSource {
  readonly info: { input: string; commit: string };
  readonly #toplevel: string;
  readonly #commit: string;
  readonly #label: string;
  readonly #cwd: string;
  #cat: CatFile | undefined;

  /**
   * @param label revision as the user wrote it (shown in reports)
   * @param commit resolved commit SHA, or '' for the index (staged files)
   */
  constructor(input: string, toplevel: string, label: string, commit: string, cwd: string) {
    this.info = { input, commit };
    this.#toplevel = toplevel;
    this.#label = label;
    this.#commit = commit;
    this.#cwd = cwd;
  }

  async read(path: string): Promise<string> {
    this.#cat ??= new CatFile(this.#toplevel);
    const data = await this.#cat.get(`${this.#commit}:${path}`);
    if (!data) throw new SourceError(`${this.display(path)} doesn't exist at that revision`);
    return data.toString('utf8');
  }

  resolve(from: string, ref: string): string {
    const p = posix.normalize(posix.join(posix.dirname(from), decodeURIComponent(ref)));
    if (p.startsWith('../')) throw new SourceError(`$ref '${ref}' points outside the repository`);
    return p;
  }

  display(path: string): string {
    const rel = relative(this.#cwd, resolve(this.#toplevel, path));
    return `${this.#label}:${(rel === '' || isAbsolute(rel) ? path : rel).split(sep).join('/')}`;
  }

  close(): void {
    this.#cat?.close();
  }
}

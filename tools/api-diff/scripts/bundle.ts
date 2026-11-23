// Builds the release file: dist/api-diff.mjs, one ES module with every
// dependency bundled, plus dist/api-diff.mjs.sha256 in `sha256sum` format.
//
//   node scripts/bundle.ts [--outdir <dir>]
//
// The output is deterministic: the same sources and lockfile give the same
// bytes, so a release can be rebuilt from its tag and checked against the
// published SHA-256.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { VERSION } from '../src/version.ts';

export const BUNDLE_NAME = 'api-diff.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function bundle(outdir: string): Promise<{ file: string; sha256: string; bytes: number }> {
  mkdirSync(outdir, { recursive: true });
  const file = resolve(outdir, BUNDLE_NAME);
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['bin/api-diff.ts'],
    outfile: file,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22.18',
    // jsonc-parser's "main" is a UMD build whose dynamic require()s esbuild
    // can't follow; its "module" build is plain ESM.
    mainFields: ['module', 'main'],
    // The entry point's own `#!/usr/bin/env node` line is kept as the first line.
    banner: { js: `// api-diff ${VERSION}, built from tools/api-diff in https://github.com/jvandevelde/openapi.\n// The bundled packages and their licences are listed at the end of this file.` },
    legalComments: 'eof',
    metafile: true,
    charset: 'utf8',
    logLevel: 'warning',
    write: true,
  });
  if (result.errors.length > 0) throw new Error('esbuild failed');
  writeFileSync(file, `${readFileSync(file, 'utf8')}${notice(Object.keys(result.metafile!.inputs))}`);
  const bytes = readFileSync(file);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(`${file}.sha256`, `${sha256}  ${BUNDLE_NAME}\n`);
  return { file, sha256, bytes: bytes.length };
}

/** A comment naming every bundled package with its version and licence, sorted by name. */
export function notice(inputs: string[]): string {
  const names = new Set<string>();
  for (const input of inputs) {
    const m = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input);
    if (m) names.add(m[1]!);
  }
  const lines = [...names].sort().map((name) => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'node_modules', name, 'package.json'), 'utf8')) as { version: string; license?: string };
    return `//   ${name} ${pkg.version} (${pkg.license ?? 'see its package'})`;
  });
  return `\n// Bundled packages:\n${lines.join('\n')}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { outdir: { type: 'string', default: resolve(root, 'dist') } } });
  const r = await bundle(resolve(values.outdir!));
  process.stdout.write(`${r.file}  ${(r.bytes / 1024).toFixed(1)} KB\n${r.sha256}  ${BUNDLE_NAME}\n`);
}

#!/usr/bin/env node
import { main } from '../src/cli/main.ts';

// A reader that stops early (`api-diff rules | head`) closes the pipe; stop
// quietly, as other command-line tools do, instead of crashing.
process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') process.exit(process.exitCode ?? 0);
  throw e;
});

process.exitCode = await main(process.argv.slice(2));

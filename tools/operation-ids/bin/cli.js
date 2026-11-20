#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fillOperationIdsInText, CASES } from '../src/index.js';

const USAGE = `Usage: openapi-operation-ids <input|-> [options]

Fill in missing operationIds in an OpenAPI 3.0 / 3.1 / 3.2 document (JSON or YAML).
Existing operationIds are never changed. Output goes to stdout unless -o or --write is given.

Options:
  -o, --output <file>   Write the result to <file>
  -w, --write           Overwrite the input file in place
      --case <style>    Identifier case: ${CASES.join(' | ')} (default: camel)
      --format <fmt>    Force input/output format: json | yaml (default: detect)
      --dry-run         Print the ids that would be added; change nothing
      --check           Exit with code 1 if any operation is missing an operationId
  -q, --quiet           Do not print the summary or warnings to stderr
  -h, --help            Show this help
`;

function fail(msg, code = 2) {
  process.stderr.write(`openapi-operation-ids: ${msg}\n`);
  process.exit(code);
}

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      write: { type: 'boolean', short: 'w' },
      case: { type: 'string', default: 'camel' },
      format: { type: 'string' },
      'dry-run': { type: 'boolean' },
      check: { type: 'boolean' },
      quiet: { type: 'boolean', short: 'q' },
      help: { type: 'boolean', short: 'h' },
    },
  });
} catch (err) {
  fail(`${err.message}\n\n${USAGE}`);
}

const { values: opts, positionals } = args;
if (opts.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}
if (positionals.length !== 1) fail(`expected exactly one input file\n\n${USAGE}`);
if (opts.write && opts.output) fail('use either --write or --output, not both');
if (opts.format && !['json', 'yaml'].includes(opts.format)) fail('--format must be json or yaml');

const input = positionals[0];
if (opts.write && input === '-') fail('--write cannot be used with stdin');

let result;
try {
  const text = readFileSync(input === '-' ? 0 : input, 'utf8');
  result = fillOperationIdsInText(text, {
    case: opts.case,
    format: opts.format,
    filename: input === '-' ? undefined : input,
  });
} catch (err) {
  fail(err.message);
}

const log = (msg) => {
  if (!opts.quiet) process.stderr.write(`${msg}\n`);
};
for (const w of result.warnings) log(`warning: ${w}`);

if (opts.check || opts['dry-run']) {
  const out = opts.check ? process.stderr : process.stdout;
  const width = Math.max(0, ...result.added.map((a) => a.key.length));
  for (const a of result.added) out.write(`${a.key.padEnd(width)}  ->  ${a.operationId}\n`);
  if (opts.check) {
    if (result.added.length > 0) fail(`${result.added.length} operation(s) missing an operationId`, 1);
    log('All operations have an operationId.');
  } else {
    log(`${result.added.length} operationId(s) would be added.`);
  }
  process.exit(0);
}

if (opts.write || opts.output) {
  writeFileSync(opts.write ? input : opts.output, result.text);
} else {
  process.stdout.write(result.text);
}
log(`Added ${result.added.length} operationId(s).`);

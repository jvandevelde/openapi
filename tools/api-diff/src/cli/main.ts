// Command-line interface.
//
// Exit codes: 0 ok, 1 findings at or above --fail-on, 2 usage or input error.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { compareInputs, shouldFail, type CompareOptions } from '../engine.ts';
import { emptyPolicy, loadPolicyFile, parseRuleSetting, PolicyError } from '../policy/policy.ts';
import { isoDate } from '../diff/lifecycle.ts';
import { loadAcknowledgements } from '../policy/acks.ts';
import { renderTxt } from '../render/txt.ts';
import { RULE_DOCS } from '../rules/docs.ts';
import { getRule, isImplemented, RULES, type RuleMeta } from '../rules/registry.ts';
import { inputsFromArgs } from '../sources/input.ts';
import { SourceError } from '../sources/source.ts';
import type { FailOn, Profile } from '../types.ts';
import { VERSION } from '../version.ts';

const HELP = `api-diff ${VERSION}: compare two OpenAPI documents and report what changed.

Usage:
  api-diff [options] <base> <revision>
  api-diff [options] --base <rev> [--revision <rev>] <file>
  api-diff rules [<rule-id>] [--format txt|json] [--all]
  api-diff schema

Inputs:
  openapi.yaml          a file
  main:openapi.yaml     the file at a git revision (any revision git accepts)
  :openapi.yaml         the staged version
  main...:openapi.yaml  the file at the merge-base of main and the other side
  --base main <file>    same as main:<file> <file>; --base main... compares a branch with where it left main

Options:
  -C, --cwd <dir>        run as if started in <dir>
  -f, --format <fmt>     txt (default) or json
  -o, --output <file>    write the report to a file instead of stdout
      --fail-on <level>  exit 1 if any finding is at or above: error (default), warn, info, never
      --state            print only the state: no-changes, compatible or breaking
      --profile <name>   wire (default) or sdk
      --policy <file>    policy file (default: api-diff.yaml in the working directory, if present)
      --no-policy        ignore api-diff.yaml
      --base-version <v>, --revision-version <v>
                         the versions to record and check (default: from the documents, see the policy's versions)
      --base-label <k=v>, --revision-label <k=v>
                         extra version labels, e.g. build=8812; repeatable
      --as-of <date>     reference date (YYYY-MM-DD) for deprecation periods and sunsets; default today (UTC)
      --acknowledgements <file>  accepted findings (default: api-diff.ack.yaml in the working directory, if present)
      --no-acknowledgements      ignore api-diff.ack.yaml
      --rule <id>=<sev>  set a rule's severity (error, warn, info, off); repeatable, beats the policy file
      --color / --no-color
  -h, --help
  -v, --version
`;

class UsageError extends Error {}

export interface Io {
  stdout: { write(s: string): unknown; isTTY?: boolean };
  stderr: { write(s: string): unknown };
  env: Record<string, string | undefined>;
}

function oneOf<T extends string>(name: string, v: string | undefined, allowed: readonly T[], dflt: T): T {
  if (v === undefined) return dflt;
  if (!(allowed as readonly string[]).includes(v)) throw new UsageError(`--${name} must be one of: ${allowed.join(', ')}`);
  return v as T;
}

export async function main(argv: string[], io: Io = { stdout: process.stdout, stderr: process.stderr, env: process.env }): Promise<number> {
  try {
    if (argv[0] === 'rules') return rulesCommand(argv.slice(1), io.stdout);
    if (argv[0] === 'schema') {
      io.stdout.write(readFileSync(new URL('../../schema/result-v0.schema.json', import.meta.url), 'utf8'));
      return 0;
    }
    return await diffCommand(argv, io);
  } catch (e) {
    if (e instanceof UsageError || e instanceof SourceError || e instanceof PolicyError || (e as NodeJS.ErrnoException).code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' || (e as NodeJS.ErrnoException).code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
      io.stderr.write(`api-diff: ${(e as Error).message}\n`);
      if (e instanceof UsageError || !(e instanceof SourceError || e instanceof PolicyError)) io.stderr.write(`Run 'api-diff --help' for usage.\n`);
      return 2;
    }
    throw e;
  }
}

async function diffCommand(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      base: { type: 'string' },
      revision: { type: 'string' },
      cwd: { type: 'string', short: 'C' },
      format: { type: 'string', short: 'f' },
      output: { type: 'string', short: 'o' },
      'fail-on': { type: 'string' },
      state: { type: 'boolean' },
      profile: { type: 'string' },
      policy: { type: 'string' },
      'no-policy': { type: 'boolean' },
      rule: { type: 'string', multiple: true },
      'as-of': { type: 'string' },
      acknowledgements: { type: 'string' },
      'no-acknowledgements': { type: 'boolean' },
      'base-version': { type: 'string' },
      'revision-version': { type: 'string' },
      'base-label': { type: 'string', multiple: true },
      'revision-label': { type: 'string', multiple: true },
      color: { type: 'boolean' },
      'no-color': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  if (values.help) {
    io.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    io.stdout.write(`${VERSION}\n`);
    return 0;
  }
  const format = oneOf('format', values.format, ['txt', 'json'] as const, 'txt');
  const cwd = resolve(values.cwd ?? process.cwd());
  if (values.policy !== undefined && values['no-policy']) throw new UsageError('--policy and --no-policy cannot be used together');
  const policy = values['no-policy'] ? emptyPolicy() : loadPolicyFile(cwd, values.policy);
  for (const r of values.rule ?? []) {
    const eq = r.indexOf('=');
    if (eq <= 0) throw new UsageError(`--rule must be <rule-id>=<severity>, got '${r}'`);
    const id = r.slice(0, eq);
    const setting = parseRuleSetting(id, r.slice(eq + 1), `--rule ${id}`);
    policy.rules.set(id, { ...policy.rules.get(id), severity: setting.severity!, options: policy.rules.get(id)?.options ?? {}, from: '--rule' });
  }
  const failOn = oneOf<FailOn>('fail-on', values['fail-on'], ['error', 'warn', 'info', 'never'], policy.failOn ?? 'error');
  const profile = oneOf<Profile>('profile', values.profile, ['wire', 'sdk'], policy.profile ?? 'wire');
  if (positionals.length === 0 && values.base === undefined) {
    io.stdout.write(HELP);
    return 2;
  }
  const [base, revision] = inputsFromArgs(positionals, { base: values.base, revision: values.revision }, cwd);
  const asOf = values['as-of'];
  if (asOf !== undefined && !isoDate(asOf)) throw new UsageError(`--as-of must be a date (YYYY-MM-DD), got '${asOf}'`);
  const labels = (name: string, list: string[] | undefined): Record<string, string> | undefined => {
    if (!list?.length) return undefined;
    const out: Record<string, string> = {};
    for (const l of list) {
      const eq = l.indexOf('=');
      if (eq <= 0) throw new UsageError(`--${name} must be <name>=<value>, got '${l}'`);
      out[l.slice(0, eq)] = l.slice(eq + 1);
    }
    return out;
  };
  const opts: CompareOptions = { profile, policy };
  if (values.acknowledgements !== undefined && values['no-acknowledgements']) throw new UsageError('--acknowledgements and --no-acknowledgements cannot be used together');
  const acks = values['no-acknowledgements'] ? undefined : loadAcknowledgements(cwd, values.acknowledgements);
  if (acks) opts.acknowledgements = acks;
  if (asOf !== undefined) opts.asOf = asOf;
  if (values['base-version'] !== undefined) opts.baseVersion = values['base-version'];
  if (values['revision-version'] !== undefined) opts.revisionVersion = values['revision-version'];
  const bl = labels('base-label', values['base-label']);
  const rl = labels('revision-label', values['revision-label']);
  if (bl) opts.baseLabels = bl;
  if (rl) opts.revisionLabels = rl;
  const result = await compareInputs(base, revision, cwd, opts);

  let text: string;
  if (values.state) text = `${result.state}\n`;
  else if (format === 'json') text = JSON.stringify(result, null, 2) + '\n';
  else {
    const color = values['no-color'] ? false : values.color ? true : !values.output && !!io.stdout.isTTY && !io.env.NO_COLOR;
    text = renderTxt(result, { color });
  }
  if (values.output) writeFileSync(resolve(cwd, values.output), text);
  else io.stdout.write(text);
  return shouldFail(result, failOn) ? 1 : 0;
}

function severityText(r: RuleMeta): string {
  return typeof r.severity === 'string' ? r.severity : `${r.severity.in} / ${r.severity.out}`;
}

function rulesCommand(argv: string[], out: Io['stdout']): number {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { format: { type: 'string', short: 'f' }, all: { type: 'boolean' } } });
  const format = oneOf('format', values.format, ['txt', 'json'] as const, 'txt');
  const pick = positionals[0] ? [getRuleOrUsage(positionals[0])] : RULES.filter((r) => values.all || isImplemented(r));
  if (format === 'json') {
    const data = pick.map((r) => ({ id: r.id, section: r.section, kind: r.kind, title: r.title, severity: r.severity, sdkProfile: r.sdkProfile, variants: r.variants, milestone: `M${r.milestone}`, implemented: isImplemented(r) }));
    out.write(JSON.stringify(data, null, 2) + '\n');
    return 0;
  }
  if (positionals[0]) {
    const r = pick[0]!;
    const doc = RULE_DOCS[r.id];
    const sev = severityText(r) + (r.sdkProfile ? ` (--profile sdk: ${r.sdkProfile})` : '');
    out.write(`${r.id}: ${r.title}\n\nkind      ${r.kind}\nseverity  ${sev}${typeof r.severity === 'string' ? '' : ' (request / response)'}\nstatus    ${isImplemented(r) ? 'implemented' : 'planned'} (M${r.milestone})\n`);
    if (doc) out.write(`\n${doc.description}\n\nWhy: ${doc.why}\n\nFix: ${doc.fix}\n`);
    out.write(`\nMore: docs/rules/${r.id}.md\n`);
    return 0;
  }
  const w = Math.max(...pick.map((r) => r.id.length));
  for (const r of pick) {
    const sev = severityText(r) + (r.sdkProfile ? ` (sdk: ${r.sdkProfile})` : '');
    const status = isImplemented(r) ? '' : `  [M${r.milestone}]`;
    out.write(`${r.id.padEnd(w)}  ${r.kind.padEnd(4)}  ${sev.padEnd(24)}  ${r.title}${status}\n`);
  }
  if (!positionals[0] && !values.all) out.write(`\n${pick.length} implemented rules. 'api-diff rules --all' lists all ${RULES.length}, including planned ones.\n`);
  return 0;
}

function getRuleOrUsage(id: string): RuleMeta {
  const base = id.replace(/^(query|header|cookie)-/, '').replace(/-in-(request|response)$/, '');
  try {
    return getRule(base);
  } catch {
    throw new UsageError(`unknown rule '${id}'`);
  }
}

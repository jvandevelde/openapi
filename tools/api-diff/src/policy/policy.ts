// Policy file: loading and strict validation (POLICY.md). Unknown keys,
// rule IDs and rule options are errors, with a "did you mean" suggestion.
//
// Sections that later M6 steps implement (overrides, extensions, lifecycle,
// exclusions, ignore, versions, reports) are checked for their top-level
// shape and kept as given in `raw`, until their step validates them fully.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { RULE_DOCS } from '../rules/docs.ts';
import { allRuleIds, baseRuleId } from '../rules/registry.ts';
import type { FailOn, Profile, Severity } from '../types.ts';

export type RuleSeverity = Severity | 'off';

export interface RuleSetting {
  severity?: RuleSeverity;
  fix?: string;
  explanation?: string;
  /** Rule-specific options (POLICY.md section 4), as given. */
  options: Record<string, unknown>;
  /** Where the setting came from when not the policy file, e.g. `--rule`. */
  from?: string;
}

export interface Policy {
  /** File the policy came from, for messages and severity provenance. */
  file?: string;
  profile?: Profile;
  failOn?: FailOn;
  minSeverity?: Severity;
  /** Keyed by the rule ID as written: a base ID or a location/direction variant. */
  rules: Map<string, RuleSetting>;
  /** Sections not validated yet, as given. */
  raw: Record<string, unknown>;
}

export class PolicyError extends Error {}

export const DEFAULT_POLICY_FILE = 'api-diff.yaml';

const TOP_KEYS = ['version', 'profile', 'defaults', 'rules', 'overrides', 'extensions', 'lifecycle', 'exclusions', 'ignore', 'versions', 'reports'] as const;
const DEFAULT_KEYS = ['fail-on', 'min-severity'] as const;
const SETTING_KEYS = ['severity', 'fix', 'explanation'] as const;
const SEVERITIES = ['error', 'warn', 'info', 'off'] as const;

export function emptyPolicy(): Policy {
  return { rules: new Map(), raw: {} };
}

/**
 * Finds and loads the policy file. An explicit path must exist; otherwise
 * `api-diff.yaml` in `cwd` is used if present. Returns an empty policy when
 * there is none.
 */
export function loadPolicyFile(cwd: string, explicit?: string): Policy {
  const path = explicit !== undefined ? resolve(cwd, explicit) : resolve(cwd, DEFAULT_POLICY_FILE);
  if (!existsSync(path)) {
    if (explicit !== undefined) throw new PolicyError(`policy file ${explicit} not found`);
    return emptyPolicy();
  }
  let data: unknown;
  try {
    data = load(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new PolicyError(`${explicit ?? DEFAULT_POLICY_FILE}: ${(e as Error).message.split('\n')[0]}`);
  }
  return parsePolicy(data ?? {}, explicit ?? DEFAULT_POLICY_FILE);
}

/** Validates a parsed policy document. `file` is used in error messages. */
export function parsePolicy(data: unknown, file = 'policy'): Policy {
  const at = (path: string): string => `${file}: ${path}`;
  const obj = asObject(data, at('the policy'));
  const policy: Policy = { file, rules: new Map(), raw: {} };
  for (const [k, v] of Object.entries(obj)) {
    if (!(TOP_KEYS as readonly string[]).includes(k)) throw new PolicyError(`${at(k)}: unknown key${suggest(k, TOP_KEYS)}`);
    switch (k) {
      case 'version':
        if (v !== 1) throw new PolicyError(`${at('version')}: must be 1`);
        break;
      case 'profile':
        policy.profile = oneOf(v, ['wire', 'sdk'] as const, at('profile'));
        break;
      case 'defaults':
        for (const [dk, dv] of Object.entries(asObject(v, at('defaults')))) {
          if (dk === 'fail-on') policy.failOn = oneOf(dv, ['error', 'warn', 'info', 'never'] as const, at('defaults.fail-on'));
          else if (dk === 'min-severity') policy.minSeverity = oneOf(dv, ['error', 'warn', 'info'] as const, at('defaults.min-severity'));
          else throw new PolicyError(`${at(`defaults.${dk}`)}: unknown key${suggest(dk, DEFAULT_KEYS)}`);
        }
        break;
      case 'rules':
        for (const [id, setting] of Object.entries(asObject(v, at('rules')))) policy.rules.set(id, parseRuleSetting(id, setting, at(`rules.${id}`)));
        break;
      case 'ignore':
        if (!Array.isArray(v)) throw new PolicyError(`${at('ignore')}: must be a list`);
        policy.raw[k] = v;
        break;
      case 'overrides':
        if (!Array.isArray(v)) throw new PolicyError(`${at('overrides')}: must be a list`);
        policy.raw[k] = v;
        break;
      default:
        policy.raw[k] = asObject(v, at(k));
    }
  }
  return policy;
}

/** Parses `rule-id: severity` or `rule-id: { severity, fix, explanation, ...options }`. */
export function parseRuleSetting(id: string, value: unknown, where: string): RuleSetting {
  const base = baseRuleId(id);
  if (!base) throw new PolicyError(`${where}: unknown rule${suggest(id, allRuleIds())}`);
  if (typeof value === 'string') return { severity: oneOf(value, SEVERITIES, where), options: {} };
  const obj = asObject(value, where);
  const allowed = optionKeys(base);
  const setting: RuleSetting = { options: {} };
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'severity') setting.severity = oneOf(v, SEVERITIES, `${where}.severity`);
    else if (k === 'fix' || k === 'explanation') {
      if (typeof v !== 'string') throw new PolicyError(`${where}.${k}: must be text`);
      setting[k] = v;
    } else if (allowed.includes(k)) setting.options[k] = v;
    else {
      const known = [...SETTING_KEYS, ...allowed];
      const hint = allowed.length ? suggest(k, known) : ` (${base} takes only severity, fix and explanation)`;
      throw new PolicyError(`${where}.${k}: unknown option${hint}`);
    }
  }
  return setting;
}

/** Top-level option keys a rule accepts: `unless.deprecated-for-days` is under `unless`. */
function optionKeys(base: string): string[] {
  const names = (RULE_DOCS[base]?.options ?? []).map((o) => o.name.split('.')[0]!);
  return [...new Set(names)];
}

function asObject(v: unknown, where: string): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new PolicyError(`${where}: must be a mapping`);
  return v as Record<string, unknown>;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], where: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw new PolicyError(`${where}: must be one of ${allowed.join(', ')}${typeof v === 'string' ? suggest(v, allowed) : ''}`);
  return v as T;
}

/** ` (did you mean x?)` for the closest candidate within a small edit distance, or ''. */
export function suggest(word: string, candidates: readonly string[]): string {
  const prefix = candidates.find((c) => c.length >= 3 && (word.startsWith(c) || c.startsWith(word)) && word.length >= 3);
  if (prefix) return ` (did you mean ${prefix}?)`;
  let best = '';
  let bestD = Infinity;
  for (const c of candidates) {
    const d = editDistance(word, c);
    if (d < bestD) [best, bestD] = [c, d];
  }
  return best && bestD <= Math.max(2, Math.floor(word.length / 4)) ? ` (did you mean ${best}?)` : '';
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

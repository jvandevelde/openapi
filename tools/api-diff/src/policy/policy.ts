// Policy file: loading and strict validation (POLICY.md). Unknown keys,
// rule IDs and rule options are errors, with a "did you mean" suggestion.
//
// Sections that later M6 steps implement (overrides, extensions, lifecycle,
// exclusions, ignore, versions, reports) are checked for their top-level
// shape and kept as given in `raw`, until their step validates them fully.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { removalOptions, stabilityLevels } from '../diff/lifecycle.ts';
import { unrelatedOptions } from '../diff/unrelated.ts';
import { RULE_DOCS } from '../rules/docs.ts';
import { DEFAULT_LIFECYCLE, type LifecycleSettings } from './context.ts';
import { parseOverrides, type Override } from './overrides.ts';
import { parseExclusions, type ExclusionSet } from './exclusions.ts';
import { allRuleIds, baseRuleId, getRule } from '../rules/registry.ts';
import type { FailOn, Kind, Profile, Severity } from '../types.ts';

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
  /** In file order; the last match wins. */
  overrides?: Override[];
  /** Where stability (and later deprecation and sunset dates) are read from. */
  lifecycle: LifecycleSettings;
  /** Kind of each classified `x-` extension; unlisted ones are docs. */
  extensions: Map<string, Kind>;
  /** Named exclusion sets. */
  exclusions: Map<string, ExclusionSet>;
  /** Exclusion sets that are not compared at all. */
  ignore: string[];
  /** Sections not validated yet, as given. */
  raw: Record<string, unknown>;
}

export { PolicyError } from './errors.ts';
import { PolicyError } from './errors.ts';

export const DEFAULT_POLICY_FILE = 'api-diff.yaml';

const TOP_KEYS = ['version', 'profile', 'defaults', 'rules', 'overrides', 'extensions', 'lifecycle', 'exclusions', 'ignore', 'versions', 'reports'] as const;
const DEFAULT_KEYS = ['fail-on', 'min-severity'] as const;
const LIFECYCLE_KEYS = ['stability', 'default-stability', 'deprecated-since', 'sunset'] as const;
const SETTING_KEYS = ['severity', 'fix', 'explanation'] as const;
const SEVERITIES = ['error', 'warn', 'info', 'off'] as const;

export function emptyPolicy(): Policy {
  return { rules: new Map(), lifecycle: { ...DEFAULT_LIFECYCLE }, extensions: new Map(), exclusions: new Map(), ignore: [], raw: {} };
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
  const policy: Policy = { file, rules: new Map(), lifecycle: { ...DEFAULT_LIFECYCLE }, extensions: new Map(), exclusions: new Map(), ignore: [], raw: {} };
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
        policy.rules = parseRules(v, at('rules'));
        break;
      case 'ignore':
        if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) throw new PolicyError(`${at('ignore')}: must be a list of exclusion set names`);
        policy.ignore = v as string[];
        break;
      case 'exclusions':
        policy.exclusions = parseExclusions(asObject(v, at('exclusions')), at('exclusions'), suggest);
        break;
      case 'extensions':
        for (const [x, kind] of Object.entries(asObject(v, at('extensions')))) {
          if (!x.startsWith('x-')) throw new PolicyError(`${at(`extensions.${x}`)}: extension names start with x-`);
          if (x === 'x-api-diff') throw new PolicyError(`${at('extensions.x-api-diff')}: x-api-diff configures api-diff and can't be classified`);
          policy.extensions.set(x, oneOf(kind, ['wire', 'sdk', 'docs'] as const, at(`extensions.${x}`)));
        }
        break;
      case 'overrides':
        if (!Array.isArray(v)) throw new PolicyError(`${at('overrides')}: must be a list`);
        policy.overrides = parseOverrides(v, file, (r, where) => parseRules(r, where, true), suggest);
        break;
      case 'lifecycle':
        for (const [lk, lv] of Object.entries(asObject(v, at('lifecycle')))) {
          const where = at(`lifecycle.${lk}`);
          if (lk === 'stability') policy.lifecycle.stability = extensionName(lv, where);
          else if (lk === 'deprecated-since') policy.lifecycle.deprecatedSince = extensionName(lv, where);
          else if (lk === 'sunset') policy.lifecycle.sunset = extensionName(lv, where);
          else if (lk === 'default-stability') {
            if (typeof lv !== 'string' || lv === '') throw new PolicyError(`${where}: must be a stability level`);
            policy.lifecycle.defaultStability = lv;
          } else throw new PolicyError(`${where}: unknown key${suggest(lk, LIFECYCLE_KEYS)}`);
        }
        break;
      default:
        policy.raw[k] = asObject(v, at(k));
    }
  }
  for (const name of policy.ignore) if (!policy.exclusions.has(name)) throw new PolicyError(`${at('ignore')}: '${name}' is not an exclusion set${suggest(name, [...policy.exclusions.keys()])}`);
  const levels = stabilityLevels(policy.rules.get('stability-decreased')?.options.levels);
  if (!levels.includes(policy.lifecycle.defaultStability)) throw new PolicyError(`${at('lifecycle.default-stability')}: '${policy.lifecycle.defaultStability}' is not one of the stability-decreased levels (${levels.join(', ')})`);
  return policy;
}

/** Parses an `x-api-diff: { rules }` map from a spec: like an override's rules map. */
export function parseHintRules(v: unknown, where: string): Map<string, RuleSetting> {
  return parseRules(v, where, true);
}

/** Parses a `rules` map. In an override, only the severity and the conditional-case option can be set. */
function parseRules(v: unknown, where: string, inOverride = false): Map<string, RuleSetting> {
  const out = new Map<string, RuleSetting>();
  for (const [id, setting] of Object.entries(asObject(v, where))) {
    const s = parseRuleSetting(id, setting, `${where}.${id}`);
    if (inOverride) {
      const allowed = getRule(baseRuleId(id)!).conditionalOption;
      const extra = Object.keys(s.options).filter((o) => o !== allowed);
      if (extra.length) throw new PolicyError(`${where}.${id}.${extra[0]}: rule options can't be set in overrides, only in the top-level rules`);
    }
    out.set(id, s);
  }
  return out;
}

function extensionName(v: unknown, where: string): string {
  if (typeof v !== 'string' || !v.startsWith('x-')) throw new PolicyError(`${where}: must be an x- extension name`);
  return v;
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
  OPTION_CHECKS[base]?.(setting.options, where);
  return setting;
}

/** Value checks for rule options, per base rule ID. Rules without one accept any value until their step adds it. */
const OPTION_CHECKS: Record<string, (options: Record<string, unknown>, where: string) => void> = {
  'documents-unrelated': (o, where) => void unrelatedOptions(o, where),
  'operation-removed': (o, where) => void removalOptions(o.unless, `${where}.unless`),
  'stability-decreased': (o, where) => void stabilityLevels(o.levels, `${where}.levels`),
  'enum-value-added': (o, where) => {
    if (o['honour-open-hint'] !== undefined && typeof o['honour-open-hint'] !== 'boolean') throw new PolicyError(`${where}.honour-open-hint: must be true or false`);
    const x = o['open-extensions'];
    if (x !== undefined && !(Array.isArray(x) && x.every((e) => typeof e === 'string' && e.startsWith('x-')))) throw new PolicyError(`${where}.open-extensions: must be a list of x- extension names`);
  },
};

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

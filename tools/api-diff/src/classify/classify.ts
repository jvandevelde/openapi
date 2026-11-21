// Classify stage: turns changes (no severity) into findings (severity,
// specific rule ID, message, stable ID). Severity precedence (POLICY.md
// section 12), highest first: policy `rules` (the most specific rule ID wins;
// `--rule` on the command line beats the file) → profile → built-in default.
// Acknowledgements, in-spec hints and overrides are added by later M6 steps.

import { createHash } from 'node:crypto';
import type { Policy, RuleSetting } from '../policy/policy.ts';
import { getRule, specificRuleId, type RuleMeta } from '../rules/registry.ts';
import type { Change, Finding, Profile, Severity } from '../types.ts';

export interface ClassifyOptions {
  profile: Profile;
  policy?: Policy;
}

const SEVERITIES: readonly string[] = ['error', 'warn', 'info'];

/** The policy settings that apply to a finding, most specific rule ID first. */
function settingsFor(policy: Policy | undefined, rule: string, meta: RuleMeta): [string, RuleSetting][] {
  if (!policy) return [];
  const out: [string, RuleSetting][] = [];
  for (const id of rule === meta.id ? [rule] : [rule, meta.id]) {
    const s = policy.rules.get(id);
    if (s) out.push([id, s]);
  }
  return out;
}

/** A rule option from the policy (most specific rule ID first), or undefined. */
export function ruleOption(policy: Policy | undefined, rule: string, name: string): unknown {
  const meta = getRule(rule.replace(/^(query|header|cookie)-/, '').replace(/-in-(request|response)$/, ''));
  for (const [, s] of settingsFor(policy, rule, meta)) if (name in s.options) return s.options[name];
  return undefined;
}

/** The severity for a change, or `off`, and where it came from. */
export function resolveSeverity(c: Change, rule: string, opts: ClassifyOptions): { severity: Severity | 'off'; source: string } {
  const meta = getRule(c.rule);
  const settings = settingsFor(opts.policy, rule, meta);
  const set = settings.find(([, s]) => s.severity !== undefined);
  const from = (id: string, s: RuleSetting, key = ''): string => `${s.from ?? `policy ${opts.policy?.file ?? ''}`.trimEnd()}: rules.${id}${key}`;
  if (set?.[1].severity === 'off') return { severity: 'off', source: from(set[0], set[1]) };
  if (meta.conditional?.(c) && meta.conditionalOption) {
    for (const [id, s] of settings) {
      const v = s.options[meta.conditionalOption];
      if (typeof v === 'string' && SEVERITIES.includes(v)) return { severity: v as Severity, source: from(id, s, `.${meta.conditionalOption}`) };
    }
    return defaultSeverity(c, opts.profile);
  }
  if (meta.conditional?.(c)) return defaultSeverity(c, opts.profile);
  if (set) return { severity: set[1].severity as Severity, source: from(set[0], set[1]) };
  return defaultSeverity(c, opts.profile);
}

export function defaultSeverity(change: Change, profile: Profile): { severity: Severity; source: string } {
  const meta = getRule(change.rule);
  const conditional = meta.conditional?.(change);
  if (conditional) return { severity: conditional, source: 'default (conditional)' };
  if (profile === 'sdk' && meta.sdkProfile) return { severity: meta.sdkProfile, source: 'profile sdk' };
  const s = meta.severity;
  if (typeof s === 'string') return { severity: s, source: 'default' };
  return { severity: change.direction === 'in' ? s.in : s.out, source: 'default' };
}

export function findingId(c: Change, rule: string): string {
  const key = [rule, c.subject, c.base?.pointer ?? '', c.revision?.pointer ?? '', String(c.details.name ?? ''), String(c.details.status ?? '')].join('\u0000');
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

export function classify(changes: Change[], opts: ClassifyOptions): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const c of changes) {
    const meta = getRule(c.rule);
    const rule = specificRuleId(meta, c);
    const id = findingId(c, rule);
    if (seen.has(id)) continue; // the same change reported twice (e.g. a shared document notice)
    seen.add(id);
    const { severity, source } = resolveSeverity(c, rule, opts);
    if (severity === 'off') continue;
    if (opts.policy?.minSeverity && !severityAtLeast(severity, opts.policy.minSeverity)) continue;
    const f: Finding = {
      id,
      rule,
      baseRule: meta.id,
      kind: meta.kind,
      severity,
      severitySource: source,
      subject: c.subject,
      message: meta.message(c),
      details: c.details,
    };
    if (c.base) f.base = c.base;
    if (c.revision) f.revision = c.revision;
    if (c.impact?.length) f.impact = c.impact;
    out.push(f);
  }
  return out.sort(compareFindings);
}

const RANK: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

export function compareFindings(a: Finding, b: Finding): number {
  return RANK[a.severity] - RANK[b.severity] || a.subject.localeCompare(b.subject) || a.rule.localeCompare(b.rule) || a.message.localeCompare(b.message);
}

export function severityAtLeast(s: Severity, threshold: Severity): boolean {
  return RANK[s] <= RANK[threshold];
}

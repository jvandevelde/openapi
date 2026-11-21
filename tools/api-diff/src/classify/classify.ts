// Classify stage: turns changes (no severity) into findings (severity,
// specific rule ID, message, stable ID). Policy support arrives in M6; until
// then severities come from rule defaults and the profile.

import { createHash } from 'node:crypto';
import { getRule, specificRuleId } from '../rules/registry.ts';
import type { Change, Finding, Profile, Severity } from '../types.ts';

export interface ClassifyOptions {
  profile: Profile;
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
    const { severity, source } = defaultSeverity(c, opts.profile);
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

// The audit report (PLAN.md section 5): are we following our own rules?
// For API governance. It shows everything, whatever the reports' exclusion
// sets or filters: acknowledged findings with who accepted them, why and
// until when; expired, stale and not-owner acknowledgements; findings no
// rule classified; where each finding's severity came from (default,
// profile, policy rule, override, in-spec hint); the exclusion sets and the
// reports that hide them; and findings per owner. Grouped by rule unless
// `group-by` says otherwise.

import type { Finding, Result, Severity } from '../types.ts';
import { adviceLine, BOLD, COLOR, countsLine, DIM, findingLine, header, isChange, LABEL, painter, plural, type TxtOptions } from './common.ts';
import { groupKeys, type GroupBy } from './review.ts';

export interface AuditOptions extends Partial<TxtOptions> {
  /** Exclusion set → the reports whose `exclude` lists it. */
  hiddenBy?: Record<string, string[]>;
}

export interface AuditGroup {
  key: string;
  severity: Severity;
  count: number;
  /** Finding IDs, worst first. */
  findings: string[];
}

export interface AuditData {
  report: 'audit';
  tool: Result['tool'];
  profile: Result['profile'];
  compared: Result['compared'];
  policy?: Result['policy'];
  state: Result['state'];
  advice?: string;
  counts: Result['counts'];
  groupBy: GroupBy;
  groups: AuditGroup[];
  /** Where severities came from, most common first: `default`, `profile sdk`, `policy rules.x`, `policy override #2 (…)`, `x-api-diff hint …`. */
  severitySources: { source: string; count: number }[];
  acknowledgements: {
    /** Findings an acknowledgement covers. */
    active: { finding: string; rule: string; subject: string; severity: Severity; owner?: string; reason: string; expires: string }[];
    expired: string[];
    stale: string[];
    notOwner: string[];
  };
  /** Findings no rule classified (`unclassified-change`). */
  unclassified: string[];
  /** Parts of the specs that weren't compared (`not-compared`). */
  notCompared: string[];
  /** Each exclusion set: how many findings are in it, and which reports leave them out. */
  exclusions: { set: string; findings: number; hiddenBy: string[] }[];
  /** Findings per owner (`(no owner)` for the rest), with their worst severity. */
  owners: { owner: string; findings: number; error: number; warn: number; info: number }[];
  /** Every finding, in severity order; the lists above refer to them by ID. */
  findings: Finding[];
}

const RANK: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
const ids = (fs: Finding[]): string[] => fs.map((f) => f.id);

export function auditData(r: Result, opts: AuditOptions = {}): AuditData {
  const by: GroupBy = opts.groupBy ?? 'rule';
  const groups = new Map<string, AuditGroup>();
  for (const f of r.findings) {
    for (const key of groupKeys(f, by, r.operations)) {
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { key, severity: f.severity, count: 0, findings: [] }));
      g.count++;
      g.findings.push(f.id);
      if (RANK[f.severity] < RANK[g.severity]) g.severity = f.severity;
    }
  }
  const sources = new Map<string, number>();
  for (const f of r.findings) sources.set(f.severitySource, (sources.get(f.severitySource) ?? 0) + 1);
  const owners = new Map<string, AuditData['owners'][number]>();
  for (const f of r.findings) {
    if (!isChange(f)) continue;
    for (const o of f.owners?.length ? f.owners : ['(no owner)']) {
      const e = owners.get(o) ?? { owner: o, findings: 0, error: 0, warn: 0, info: 0 };
      e.findings++;
      e[f.severity]++;
      owners.set(o, e);
    }
  }
  const sets = new Map<string, number>();
  for (const f of r.findings) for (const s of f.exclusions ?? []) sets.set(s, (sets.get(s) ?? 0) + 1);
  for (const s of Object.keys(opts.hiddenBy ?? {})) if (!sets.has(s)) sets.set(s, 0);
  const rule = (id: string): Finding[] => r.findings.filter((f) => f.baseRule === id);
  const data: AuditData = {
    report: 'audit',
    tool: r.tool,
    profile: r.profile,
    compared: r.compared,
    state: r.state,
    counts: r.counts,
    groupBy: by,
    groups: [...groups.values()].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.count - a.count || a.key.localeCompare(b.key)),
    severitySources: [...sources.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count || a.source.localeCompare(b.source)),
    acknowledgements: {
      active: r.findings.filter((f) => f.acknowledged).map((f) => ({ finding: f.id, rule: f.rule, subject: f.subject, severity: f.severity, ...(f.acknowledged!.owner ? { owner: f.acknowledged!.owner } : {}), reason: f.acknowledged!.reason, expires: f.acknowledged!.expires })),
      expired: ids(rule('acknowledgement-expired')),
      stale: ids(rule('acknowledgement-stale')),
      notOwner: ids(rule('acknowledgement-not-owner')),
    },
    unclassified: ids(rule('unclassified-change')),
    notCompared: ids(rule('not-compared')),
    exclusions: [...sets.entries()].map(([set, findings]) => ({ set, findings, hiddenBy: opts.hiddenBy?.[set] ?? [] })).sort((a, b) => a.set.localeCompare(b.set)),
    owners: [...owners.values()].sort((a, b) => (a.owner === '(no owner)' ? 1 : 0) - (b.owner === '(no owner)' ? 1 : 0) || b.findings - a.findings || a.owner.localeCompare(b.owner)),
    findings: r.findings,
  };
  if (r.policy) data.policy = r.policy;
  const advice = adviceLine(r);
  if (advice) data.advice = advice;
  return data;
}

const NOUN: Record<GroupBy, string> = { 'root-cause': 'place', severity: 'severity level', tag: 'tag', operation: 'operation', rule: 'rule', owner: 'owner' };

export function renderAudit(r: Result, opts: AuditOptions): string {
  const c = painter(!!opts.color);
  const d = auditData(r, opts);
  const byId = new Map(r.findings.map((f) => [f.id, f]));
  const out = [...header(r, c), ''];
  const section = (title: string, lines: string[]): void => {
    if (!lines.length) return;
    out.push(c(BOLD, title), ...lines, '');
  };
  const a = d.acknowledgements;
  section(`Acknowledged (${a.active.length})`, a.active.map((x) => `  ${c(COLOR[x.severity], LABEL[x.severity])}  ${x.subject}  ${x.rule} ${c(DIM, x.finding)}\n         until ${x.expires}${x.owner ? ` by ${x.owner}` : ' (no owner)'}: ${x.reason}`));
  const ackNotices = [...a.expired, ...a.notOwner, ...a.stale].map((id) => byId.get(id)!);
  section(`Acknowledgement problems (${ackNotices.length})`, ackNotices.flatMap((f) => findingLine(f, c, { indent: '  ' })));
  section(`Not classified by any rule (${d.unclassified.length})`, d.unclassified.flatMap((id) => findingLine(byId.get(id)!, c, { indent: '  ' })));
  section('Where severities came from', d.severitySources.map((s) => `  ${String(s.count).padStart(5)}  ${s.source}`));
  section('Exclusion sets', d.exclusions.map((e) => `  ${e.set}: ${plural(e.findings, 'finding')}${e.hiddenBy.length ? `, left out of ${e.hiddenBy.join(', ')}` : ', not left out of any report'}`));
  section('Not compared', d.notCompared.map((id) => `  ${byId.get(id)!.message}`));
  section('By owner', d.owners.map((o) => `  ${o.owner.padEnd(Math.max(...d.owners.map((x) => x.owner.length)))}  ${plural(o.findings, 'finding')} (${o.error} error, ${o.warn} warn, ${o.info} info)`));
  if (d.groups.length) {
    out.push(c(BOLD, `Findings by ${d.groupBy === 'root-cause' ? 'root cause' : d.groupBy} (${plural(d.groups.length, NOUN[d.groupBy])})`));
    for (const g of d.groups) {
      out.push(`${c(COLOR[g.severity], LABEL[g.severity])}  ${c(BOLD, g.key)}  ${c(DIM, `×${g.count}`)}`);
      for (const id of g.findings) {
        const f = byId.get(id)!;
        out.push(...findingLine(f, c, { indent: '       ', subject: true }));
        const meta = [`severity ← ${f.severitySource}`, f.owners?.length ? `owners ${f.owners.join(', ')}` : '', f.exclusions?.length ? `in ${f.exclusions.join(', ')}` : ''].filter(Boolean).join(' · ');
        out.push(`              ${c(DIM, meta)}`);
      }
    }
    out.push('');
  }
  out.push(c(BOLD, countsLine(r, { color: !!opts.color, ...(opts.failOn ? { failOn: opts.failOn } : {}) })), '');
  return out.join('\n');
}

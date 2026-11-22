// The summary report (PLAN.md section 5): how big and how risky the change
// is, for release or product managers. Counts by kind and severity, the
// semver advice and the most serious findings.

import type { Finding, Kind, Result, Severity } from '../types.ts';
import { adviceLine, BOLD, countsLine, findingLine, header, isChange, painter, type TxtOptions } from './common.ts';
import { groupFindings } from './review.ts';

export const SUMMARY_TOP = 5;

export interface SummaryData {
  report: 'summary';
  compared: Result['compared'];
  state: Result['state'];
  advice?: Result['advice'];
  /** Counts of API changes (notices and version checks excluded) by kind and severity. */
  byKindAndSeverity: Record<Kind, Record<Severity, number>>;
  /** Places (components or operations) with changes, and how many have breaking changes. */
  places: { total: number; breaking: number };
  /** Operations affected by any change. */
  operationsAffected: number;
  acknowledged: number;
  notices: number;
  /** The most serious findings, worst first. */
  top: Finding[];
}

export function summaryData(r: Result): SummaryData {
  const kinds: Kind[] = ['wire', 'sdk', 'docs'];
  const table = Object.fromEntries(kinds.map((k) => [k, { error: 0, warn: 0, info: 0 }])) as Record<Kind, Record<Severity, number>>;
  const changes = r.findings.filter(isChange);
  for (const f of changes) table[f.kind][f.severity]++;
  const groups = groupFindings(r.findings);
  const ops = new Set<string>();
  for (const f of changes) {
    if (/^[A-Z]+ \//.test(f.subject)) ops.add(f.subject);
    for (const o of f.impact ?? []) ops.add(o);
  }
  const data: SummaryData = {
    report: 'summary',
    compared: r.compared,
    state: r.state,
    byKindAndSeverity: table,
    places: { total: groups.length, breaking: groups.filter((g) => g.severity === 'error').length },
    operationsAffected: ops.size,
    acknowledged: r.counts.acknowledged,
    notices: r.findings.filter((f) => !isChange(f)).length,
    top: changes.slice(0, SUMMARY_TOP), // findings are sorted worst first
  };
  if (r.advice) data.advice = r.advice;
  return data;
}

export function renderSummary(r: Result, opts: TxtOptions): string {
  const c = painter(opts.color);
  const d = summaryData(r);
  const out = [...header(r, c), ''];
  out.push(c(BOLD, 'Size and risk'));
  out.push(`  ${d.places.total} place${d.places.total === 1 ? '' : 's'} changed, ${d.places.breaking} with breaking changes; ${d.operationsAffected} operation${d.operationsAffected === 1 ? '' : 's'} affected`);
  out.push('', '           error  warn  info');
  for (const k of ['wire', 'sdk', 'docs'] as const) {
    const row = d.byKindAndSeverity[k];
    out.push(`  ${k.padEnd(7)}  ${String(row.error).padStart(5)} ${String(row.warn).padStart(5)} ${String(row.info).padStart(5)}`);
  }
  const advice = adviceLine(r);
  out.push('', `  version   ${advice ?? (r.advice ? 'no bump needed' : 'not checked (versions are not semver)')}`);
  if (d.top.length) {
    out.push('', c(BOLD, `Most serious (${d.top.length})`));
    for (const f of d.top) out.push(...findingLine(f, c, { indent: '  ' }));
  }
  out.push('', c(BOLD, countsLine(r, opts)), '');
  return out.join('\n');
}

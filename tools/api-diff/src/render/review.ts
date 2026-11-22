// The review report (PLAN.md section 5): what a PR changes and who it
// affects, for PR authors and reviewers. Changes are grouped by root cause
// (the component or operation they are in), worst first, with the
// operations each group affects. Documentation changes are collapsed into a
// short list; notices about the inputs come first. No fix advice: breaking
// changes are often intended (decision record "The PR check reports changes
// and doesn't fail by default").
//
// The text stays under `maxChars` (a GitHub comment holds 65,536): once the
// budget is reached, the remaining groups are listed one line each.

import type { Finding, Result, Severity } from '../types.ts';
import { affects, BOLD, COLOR, countsLine, DIM, findingLine, header, isChange, isNotice, isVersion, LABEL, painter, plural, type TxtOptions } from './common.ts';

export interface ReviewOptions extends TxtOptions {
  maxChars?: number;
}

export const REVIEW_MAX_CHARS = 60_000;

const RANK: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

export interface Group {
  subject: string;
  severity: Severity;
  findings: Finding[];
  /** Operations affected, from the findings' impact lists. */
  operations: string[];
}

/** Root-cause groups of wire and sdk findings, worst first, then by subject. */
export function groupFindings(findings: Finding[]): Group[] {
  const groups = new Map<string, Group>();
  for (const f of findings) {
    if (!isChange(f) || f.kind === 'docs') continue;
    let g = groups.get(f.subject);
    if (!g) groups.set(f.subject, (g = { subject: f.subject, severity: f.severity, findings: [], operations: [] }));
    g.findings.push(f);
    if (RANK[f.severity] < RANK[g.severity]) g.severity = f.severity;
    for (const op of f.impact ?? []) if (!g.operations.includes(op)) g.operations.push(op);
  }
  for (const g of groups.values()) {
    g.findings.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.message.localeCompare(b.message));
    g.operations.sort();
  }
  return [...groups.values()].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.findings.length - a.findings.length || a.subject.localeCompare(b.subject));
}

/** Documentation changes, collapsed: one line per rule with a count and a few subjects. */
export function docsSummary(findings: Finding[]): { rule: string; count: number; subjects: string[] }[] {
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) if (isChange(f) && f.kind === 'docs') byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f]);
  return [...byRule.entries()].map(([rule, fs]) => ({ rule, count: fs.length, subjects: [...new Set(fs.map((f) => f.subject))].sort() })).sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule));
}

export function renderReview(r: Result, opts: ReviewOptions): string {
  const c = painter(opts.color);
  const max = opts.maxChars ?? REVIEW_MAX_CHARS;
  const out: string[] = [...header(r, c), ''];
  if (r.findings.length === 0) return [...out, 'No changes found.', ''].join('\n');

  const notices = r.findings.filter(isNotice);
  const problems = notices.filter((f) => f.severity !== 'info');
  const notes = notices.filter((f) => f.severity === 'info');
  if (problems.length) {
    out.push(c(BOLD, 'Problems with the inputs'));
    for (const f of problems) out.push(...findingLine(f, c, { indent: '  ' }));
    out.push('');
  }

  const versions = r.findings.filter(isVersion);
  if (versions.length) {
    out.push(c(BOLD, 'Version'));
    for (const f of versions) out.push(...findingLine(f, c, { subject: false, indent: '  ' }));
    out.push('');
  }

  const groups = groupFindings(r.findings);
  if (groups.length) {
    const breaking = groups.filter((g) => g.severity === 'error').length;
    out.push(c(BOLD, `Changes (${plural(groups.length, 'place')}${breaking ? `, ${breaking} with breaking changes` : ''})`));
    let size = out.join('\n').length;
    let shown = 0;
    for (const g of groups) {
      const block = [`${c(COLOR[g.severity], LABEL[g.severity])}  ${c(BOLD, g.subject)}${g.operations.length ? `  ${c(DIM, affects(g.operations))}` : ''}`];
      const mixed = g.findings.some((f) => f.severity !== g.severity);
      for (const f of g.findings) block.push(...findingLine(f, c, { subject: false, indent: '       ', label: mixed }));
      const text = block.join('\n');
      if (size + text.length + 200 > max && shown > 0) break;
      out.push(...block);
      size += text.length + 1;
      shown++;
    }
    if (shown < groups.length) {
      const rest = groups.slice(shown);
      out.push('', c(DIM, `… ${plural(rest.length, 'more place')} (${plural(rest.reduce((n, g) => n + g.findings.length, 0), 'finding')}), shortened to fit; the JSON and HTML reports have them all:`));
      for (const g of rest) out.push(c(DIM, `  ${g.severity.padEnd(5)}  ${g.subject} (${plural(g.findings.length, 'finding')})`));
    }
    out.push('');
  }

  const docs = docsSummary(r.findings);
  if (docs.length) {
    const total = docs.reduce((n, d) => n + d.count, 0);
    out.push(c(BOLD, `Documentation changes (${total})`));
    for (const d of docs) out.push(`  ${d.rule} ×${d.count}  ${c(DIM, d.subjects.slice(0, 3).join(', ') + (d.subjects.length > 3 ? ', …' : ''))}`);
    out.push('');
  }

  if (notes.length) {
    out.push(c(BOLD, 'Notes'));
    for (const f of notes) out.push(...findingLine(f, c, { indent: '  ' }));
    out.push('');
  }

  out.push(c(BOLD, countsLine(r, opts)), '');
  return out.join('\n');
}

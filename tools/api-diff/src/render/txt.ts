// Plain-text renderer for terminals and CI logs.

import type { ComparedSide, Finding, Location, Result, Severity } from '../types.ts';

export interface TxtOptions {
  color: boolean;
}

const LABEL: Record<Severity, string> = { error: 'ERROR', warn: 'WARN ', info: 'INFO ' };
const COLOR: Record<Severity, string> = { error: '\x1b[31m', warn: '\x1b[33m', info: '\x1b[36m' };
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const where = (l: Location | undefined): string => (l ? `${l.file}${l.line ? `:${l.line}` : ''}` : '');

function side(s: ComparedSide): string {
  const parts = [s.file];
  if (s.commit) parts.push(`@ ${s.commit.slice(0, 7)}`);
  const meta = [s.openapi ? `OpenAPI ${s.openapi}` : undefined, `version ${s.version}`].filter(Boolean).join(', ');
  return `${parts.join(' ')}  (${meta})`;
}

export function renderTxt(result: Result, opts: TxtOptions): string {
  const c = (code: string, s: string): string => (opts.color ? `${code}${s}${RESET}` : s);
  const lines: string[] = [];
  lines.push(c(DIM, `api-diff ${result.tool.version} · profile ${result.profile}`));
  lines.push(`base      ${side(result.compared.base)}`);
  lines.push(`revision  ${side(result.compared.revision)}`);
  lines.push('');

  if (result.findings.length === 0) {
    lines.push('No changes found.');
    return lines.join('\n') + '\n';
  }

  const width = Math.min(48, Math.max(...result.findings.map((f) => f.subject.length)));
  for (const f of result.findings) lines.push(...findingLines(f, width, c));

  const n = result.counts;
  lines.push('');
  const summary = `${n.total} finding${n.total === 1 ? '' : 's'}: ${n.bySeverity.error} error, ${n.bySeverity.warn} warn, ${n.bySeverity.info} info · state: ${result.state}`;
  lines.push(c(BOLD, summary));
  return lines.join('\n') + '\n';
}

function findingLines(f: Finding, width: number, c: (code: string, s: string) => string): string[] {
  const loc = where(f.revision ?? f.base);
  const head = `${c(COLOR[f.severity], LABEL[f.severity])}  ${f.subject.padEnd(width)}  ${f.message}`;
  const out = [loc ? `${head}  ${c(DIM, `${loc} · ${f.rule}`)}` : `${head}  ${c(DIM, f.rule)}`];
  if (f.impact?.length) {
    const shown = f.impact.slice(0, 5).join(', ');
    out.push(`       ${c(DIM, `affects ${f.impact.length} operation${f.impact.length === 1 ? '' : 's'}: ${shown}${f.impact.length > 5 ? ', …' : ''}`)}`);
  }
  return out;
}

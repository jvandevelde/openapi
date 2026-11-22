// Report presets and the --report option (PLAN.md section 5). Every report
// is a view over one result, so all reports agree and the specs are parsed
// once however many reports are written.
//
//   --report <name>[:<format>[:<file>]]   e.g. ci, review:txt:out/review.txt
//
// Formats: txt for all, json for all (ci and review write the full result;
// summary writes its own data), html for review and summary (M7 step 3).

import type { Result } from '../types.ts';
import { renderCi } from './ci.ts';
import type { TxtOptions } from './common.ts';
import { renderReview } from './review.ts';
import { renderSummary, summaryData } from './summary.ts';

export const REPORTS = ['review', 'ci', 'summary'] as const;
export type ReportName = (typeof REPORTS)[number];
export type Format = 'txt' | 'json' | 'html';

export const FORMATS: Record<ReportName, Format[]> = { review: ['txt', 'json'], ci: ['txt', 'json'], summary: ['txt', 'json'] };

export interface ReportSpec {
  name: ReportName;
  format: Format;
  /** Output file; undefined means stdout. */
  file?: string;
}

export class ReportError extends Error {}

/** Parses `<name>[:<format>[:<file>]]`. A file path may itself contain `:` (e.g. C:\x). */
export function parseReportSpec(arg: string): ReportSpec {
  const [name, format, ...rest] = arg.split(':');
  if (!(REPORTS as readonly string[]).includes(name!)) {
    const later = ['changelog', 'sdk', 'audit', 'explore'].includes(name!) ? ` (${name} arrives in a later milestone)` : '';
    throw new ReportError(`unknown report '${name}'${later}; reports: ${REPORTS.join(', ')}`);
  }
  const n = name as ReportName;
  const f = (format || 'txt') as Format;
  if (!FORMATS[n].includes(f)) throw new ReportError(`report ${n} has no ${f} format; formats: ${FORMATS[n].join(', ')}`);
  const file = rest.join(':');
  return file && file !== '-' ? { name: n, format: f, file } : { name: n, format: f };
}

export function renderReport(spec: Pick<ReportSpec, 'name' | 'format'>, r: Result, opts: TxtOptions): string {
  if (spec.format === 'json') return JSON.stringify(spec.name === 'summary' ? summaryData(r) : r, null, 2) + '\n';
  switch (spec.name) {
    case 'review':
      return renderReview(r, opts);
    case 'ci':
      return renderCi(r, opts);
    case 'summary':
      return renderSummary(r, opts);
  }
}

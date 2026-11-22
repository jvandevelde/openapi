// Report presets and the --report option (PLAN.md section 5). Every report
// is a view over one result, so all reports agree and the specs are parsed
// once however many reports are written.
//
//   --report <name>[:<format>[:<file>]]   e.g. ci, review:txt:out/review.txt
//
// Formats: txt for all, json for all (ci and review write the full result;
// summary writes its own data), html for review and summary.

import type { Result } from '../types.ts';
import { renderCi } from './ci.ts';
import type { TxtOptions } from './common.ts';
import { renderReview } from './review.ts';
import { renderSummary, summaryData } from './summary.ts';
import { renderChangelogHtml, renderReviewHtml, renderSummaryHtml } from './html.ts';
import { changelogData, renderChangelog } from './changelog.ts';
import { renderSdk, sdkData } from './sdk.ts';
import { renderExplore } from './explore.ts';

export const REPORTS = ['review', 'ci', 'summary', 'changelog', 'sdk', 'explore'] as const;
export type ReportName = (typeof REPORTS)[number];
export type Format = 'txt' | 'json' | 'html';

export const FORMATS: Record<ReportName, Format[]> = { review: ['txt', 'json', 'html'], ci: ['txt', 'json'], summary: ['txt', 'json', 'html'], changelog: ['txt', 'json', 'html'], sdk: ['txt', 'json'], explore: ['html'] };

export interface ReportSpec {
  name: ReportName;
  /** Undefined: the policy's format for this report, else txt. */
  format?: Format;
  /** Output file; undefined means stdout. */
  file?: string;
}

export class ReportError extends Error {}

/** Parses `<name>[:<format>[:<file>]]`. A file path may itself contain `:` (e.g. C:\x). */
export function parseReportSpec(arg: string): ReportSpec {
  const [name, format, ...rest] = arg.split(':');
  if (!(REPORTS as readonly string[]).includes(name!)) {
    const later = ['audit'].includes(name!) ? ` (${name} arrives in a later milestone)` : ' (custom reports from the policy arrive in M9)';
    throw new ReportError(`unknown report '${name}'${later}; reports: ${REPORTS.join(', ')}`);
  }
  const n = name as ReportName;
  const spec: ReportSpec = { name: n };
  if (format) spec.format = checkFormat(n, format);
  const file = rest.join(':');
  if (file && file !== '-') spec.file = file;
  return spec;
}

export function checkFormat(name: ReportName, format: string): Format {
  if (!(FORMATS[name] as string[]).includes(format)) throw new ReportError(`report ${name} has no ${format} format; formats: ${FORMATS[name].join(', ')}`);
  return format as Format;
}

export function renderReport(spec: { name: ReportName; format: Format }, r: Result, opts: TxtOptions): string {
  if (spec.format === 'json') return JSON.stringify(spec.name === 'summary' ? summaryData(r) : spec.name === 'changelog' ? changelogData(r, opts) : spec.name === 'sdk' ? sdkData(r) : r, null, 2) + '\n';
  if (spec.name === 'explore') return renderExplore(r, opts.explorerUrl);
  if (spec.format === 'html') return spec.name === 'summary' ? renderSummaryHtml(r) : spec.name === 'changelog' ? renderChangelogHtml(r, opts) : renderReviewHtml(r);
  switch (spec.name) {
    case 'review':
      return renderReview(r, opts);
    case 'ci':
      return renderCi(r, opts);
    case 'summary':
      return renderSummary(r, opts);
    case 'changelog':
      return renderChangelog(r, opts);
    case 'sdk':
      return renderSdk(r);
  }
}

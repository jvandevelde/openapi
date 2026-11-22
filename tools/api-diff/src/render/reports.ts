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
import { auditData, renderAudit, type AuditOptions } from './audit.ts';
import { renderAuditHtml } from './html.ts';
import { renderTemplate } from './template.ts';

export const REPORTS = ['review', 'ci', 'summary', 'changelog', 'sdk', 'explore', 'audit'] as const;
export type ReportName = (typeof REPORTS)[number];
export type Format = 'txt' | 'json' | 'html';

export const FORMATS: Record<ReportName, Format[]> = { review: ['txt', 'json', 'html'], ci: ['txt', 'json'], summary: ['txt', 'json', 'html'], changelog: ['txt', 'json', 'html'], sdk: ['txt', 'json'], explore: ['html'], audit: ['txt', 'json', 'html'] };

export interface ReportSpec {
  /** The report as named: a built-in report, or a custom one from the policy. */
  name: string;
  /** The built-in report it is, or is based on. */
  base: ReportName;
  /** Undefined: the policy's format for this report, else txt. */
  format?: Format;
  /** Output file; undefined means stdout. */
  file?: string;
}

export class ReportError extends Error {}

/**
 * Parses `<name>[:<format>[:<file>]]`. A file path may itself contain `:`
 * (e.g. C:\x). `custom` gives the built-in report each custom report in the
 * policy is based on, and the format its template writes, if it has one.
 */
export function parseReportSpec(arg: string, custom: Map<string, { base: ReportName; template?: Format }> = new Map()): ReportSpec {
  const [name, format, ...rest] = arg.split(':');
  const c = custom.get(name!);
  if (!(REPORTS as readonly string[]).includes(name!) && !c) {
    const names = [...REPORTS, ...custom.keys()].filter((n, i, all) => all.indexOf(n) === i);
    throw new ReportError(`unknown report '${name}'; reports: ${names.join(', ')}${custom.size ? '' : ' (custom reports are defined in the policy, under reports)'}`);
  }
  const base = c?.base ?? (name as ReportName);
  const spec: ReportSpec = { name: name!, base };
  if (format) spec.format = c?.template ? (format === 'json' || format === c.template ? (format as Format) : templateFormatError(name!, c.template, format)) : checkFormat(base, format, name!);
  const file = rest.join(':');
  if (file && file !== '-') spec.file = file;
  return spec;
}

export function checkFormat(base: ReportName, format: string, name: string = base): Format {
  if (!(FORMATS[base] as string[]).includes(format)) throw new ReportError(`report ${name} has no ${format} format; formats: ${FORMATS[base].join(', ')}`);
  return format as Format;
}

function templateFormatError(name: string, template: Format, format: string): never {
  throw new ReportError(`report ${name} has a ${template} template, so its formats are ${template} and json (the data the template sees); got ${format}`);
}

/** The JSON data of a report: what `--report <name>:json` writes and what a template sees. */
export function reportData(name: ReportName, r: Result, opts: TxtOptions & AuditOptions): unknown {
  switch (name) {
    case 'summary':
      return summaryData(r);
    case 'changelog':
      return changelogData(r, opts);
    case 'sdk':
      return sdkData(r);
    case 'audit':
      return auditData(r, opts);
    default:
      return r;
  }
}

/** Renders a report. `template` (already checked) replaces the built-in txt or html rendering. */
export function renderReport(spec: { name: ReportName; format: Format }, r: Result, opts: TxtOptions & AuditOptions, template?: string): string {
  if (spec.format === 'json') return JSON.stringify(reportData(spec.name, r, opts), null, 2) + '\n';
  if (template !== undefined) return renderTemplate(template, reportData(spec.name, r, opts), spec.format);
  if (spec.name === 'audit') return spec.format === 'html' ? renderAuditHtml(r, opts) : renderAudit(r, opts);
  if (spec.name === 'explore') return renderExplore(r, opts.explorerUrl);
  if (spec.format === 'html') return spec.name === 'summary' ? renderSummaryHtml(r) : spec.name === 'changelog' ? renderChangelogHtml(r, opts) : renderReviewHtml(r, opts.groupBy);
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

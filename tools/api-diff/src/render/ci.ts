// The ci report (PLAN.md section 5): short, for CI logs. Lists the findings
// at or above the --fail-on threshold (warn and above when nothing gates),
// leaving out acknowledged ones, and says whether the run fails.

import type { Result, Severity } from '../types.ts';
import { ackHint, BOLD, countsLine, findingLine, header, painter, type TxtOptions } from './common.ts';
import { severityAtLeast } from '../classify/classify.ts';

export function ciThreshold(failOn: Severity | 'never' | undefined): Severity {
  return failOn === undefined || failOn === 'never' ? 'warn' : failOn;
}

export function renderCi(r: Result, opts: TxtOptions): string {
  const c = painter(opts.color);
  const threshold = ciThreshold(opts.failOn);
  const shown = r.findings.filter((f) => !f.acknowledged && severityAtLeast(f.severity, threshold));
  const out = [...header(r, c), ''];
  if (shown.length === 0) out.push(`No findings at ${threshold} or above${r.counts.total ? ` (${r.counts.total} below it, or acknowledged)` : ''}.`);
  else {
    const width = Math.min(48, Math.max(...shown.map((f) => f.subject.length)));
    for (const f of shown) out.push(...findingLine(f, c, { width }));
  }
  const failing = opts.failOn !== undefined && opts.failOn !== 'never' && shown.length > 0;
  out.push('', c(BOLD, countsLine(r, opts)));
  if (failing) out.push(c(BOLD, `FAIL: ${shown.length} finding${shown.length === 1 ? '' : 's'} at ${threshold} or above`));
  out.push(...ackHint(r, c), '');
  return out.join('\n');
}

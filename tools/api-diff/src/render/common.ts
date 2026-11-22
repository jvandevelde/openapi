// Shared pieces of the text reports: colours, the versions header, finding
// lines and the counts line.

import type { BumpLevel, ComparedSide, Finding, Location, Result, Severity } from '../types.ts';

export interface TxtOptions {
  color: boolean;
  /** The --fail-on threshold in effect, for the ci report and the footer. */
  failOn?: Severity | 'never';
}

export type Paint = (code: string, s: string) => string;

export const LABEL: Record<Severity, string> = { error: 'ERROR', warn: 'WARN ', info: 'INFO ' };
export const COLOR: Record<Severity, string> = { error: '\x1b[31m', warn: '\x1b[33m', info: '\x1b[36m' };
export const DIM = '\x1b[2m';
export const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export const painter = (color: boolean): Paint => (code, s) => (color ? `${code}${s}${RESET}` : s);

/** Rules about the inputs or the tool rather than the API. */
export const NOTICE_RULES = new Set(['spec-invalid', 'ref-unresolved', 'cycle-not-productive', 'not-compared', 'documents-unrelated', 'acknowledgement-stale', 'acknowledgement-expired']);
export const isNotice = (f: Finding): boolean => NOTICE_RULES.has(f.baseRule);
/** Rules about the release's version rather than a place in the API. */
export const VERSION_RULES = new Set(['version-unchanged', 'version-bump-too-small']);
export const isVersion = (f: Finding): boolean => VERSION_RULES.has(f.baseRule);
/** A change to the API: not a notice and not a version check. */
export const isChange = (f: Finding): boolean => !isNotice(f) && !isVersion(f);

export const where = (l: Location | undefined): string => (l ? `${l.file}${l.line ? `:${l.line}` : ''}` : '');

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function side(s: ComparedSide): string {
  const parts = [s.file];
  if (s.commit) parts.push(`@ ${s.commit.slice(0, 7)}`);
  const version = `version ${s.version}${s.versionSource && s.versionSource !== 'info.version' ? ` (${s.versionSource})` : ''}`;
  const labels = Object.entries(s.labels ?? {}).filter(([k]) => k !== 'commit').map(([k, v]) => `${k} ${v}`);
  const meta = [s.openapi ? `OpenAPI ${s.openapi}` : undefined, version, ...labels].filter(Boolean).join(', ');
  return `${parts.join(' ')}  (${meta})`;
}

const BUMP: Record<BumpLevel, string> = { none: "the version didn't change", patch: 'revision is a patch bump', minor: 'revision is a minor bump', major: 'revision is a major bump' };

/** The bump advice line, e.g. `major bump needed (2 breaking changes); revision is a minor bump`. */
export function adviceLine(r: Result): string | undefined {
  const a = r.advice;
  if (!a || a.needed === 'none') return undefined;
  const why = a.breaking ? plural(a.breaking, 'breaking change') : a.because ? `e.g. ${a.because}` : '';
  return `${a.needed} bump needed${why ? ` (${why})` : ''}; ${BUMP[a.actual]}${a.ok ? '' : ' (too small)'}`;
}

/** Tool, profile, policy, both sides and the bump advice. Every report starts with it. */
export function header(r: Result, c: Paint): string[] {
  const policy = r.policy ? ` · policy ${r.policy.file} (${r.policy.sha256.slice(0, 7)})` : '';
  const lines = [c(DIM, `api-diff ${r.tool.version} · profile ${r.profile}${policy}`), `base      ${side(r.compared.base)}`, `revision  ${side(r.compared.revision)}`];
  const advice = adviceLine(r);
  if (advice) lines.push(`advice    ${advice}`);
  return lines;
}

/** One finding: severity, subject, message, location and rule; then acknowledgement, if any. */
export function findingLine(f: Finding, c: Paint, opts: { subject?: boolean; width?: number; indent?: string; label?: boolean } = {}): string[] {
  const loc = where(f.revision ?? f.base);
  const subject = opts.subject === false ? '' : `${f.subject.padEnd(opts.width ?? 0)}  `;
  const tail = c(DIM, loc ? `${loc} · ${f.rule}` : f.rule);
  const label = opts.label === false ? '-' : c(COLOR[f.severity], LABEL[f.severity]);
  const out = [`${opts.indent ?? ''}${label}  ${subject}${f.message}  ${tail}`];
  if (f.acknowledged) {
    const a = f.acknowledged;
    out.push(`${opts.indent ?? ''}       ${c(DIM, `acknowledged until ${a.expires}${a.owner ? ` by ${a.owner}` : ''}: ${a.reason}`)}`);
  }
  return out;
}

/** `5 findings: 1 error, 2 warn, 2 info (1 acknowledged) · state: breaking`, plus the gate. */
export function countsLine(r: Result, opts: TxtOptions): string {
  const n = r.counts;
  const gate = opts.failOn === undefined ? '' : opts.failOn === 'never' ? ' · not failing CI (--fail-on never)' : ` · fails CI at ${opts.failOn} and above`;
  return `${plural(n.total, 'finding')}: ${n.bySeverity.error} error, ${n.bySeverity.warn} warn, ${n.bySeverity.info} info${n.acknowledged ? ` (${n.acknowledged} acknowledged)` : ''} · state: ${r.state}${gate}`;
}

export function affects(ops: string[], max = 5): string {
  return `affects ${plural(ops.length, 'operation')}: ${ops.slice(0, max).join(', ')}${ops.length > max ? `, … (${ops.length - max} more)` : ''}`;
}

export { plural };

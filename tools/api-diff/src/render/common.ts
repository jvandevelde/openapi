// Shared pieces of the text reports: colours, the versions header, finding
// lines and the counts line.

import { isChange, isNotice, isVersion, NOTICE_RULES, VERSION_RULES } from '../rules/registry.ts';
import type { BumpLevel, ComparedSide, Finding, Location, Result, Severity } from '../types.ts';

export interface TxtOptions {
  color: boolean;
  /** The --fail-on threshold in effect, for the ci report and the footer. */
  failOn?: Severity | 'never';
  /** Include documentation-only changes (changelog: when the report's include.kinds lists docs). */
  docs?: boolean;
  /** explore: URL template for links into the spec explorer. */
  explorerUrl?: string;
  /** review and audit: how findings are grouped (policy reports.<name>.group-by). */
  groupBy?: 'root-cause' | 'severity' | 'tag' | 'operation' | 'rule' | 'owner';
}

export type Paint = (code: string, s: string) => string;

export const LABEL: Record<Severity, string> = { error: 'ERROR', warn: 'WARN ', info: 'INFO ' };
export const COLOR: Record<Severity, string> = { error: '\x1b[31m', warn: '\x1b[33m', info: '\x1b[36m' };
export const DIM = '\x1b[2m';
export const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export const painter = (color: boolean): Paint => (code, s) => (color ? `${code}${s}${RESET}` : s);

// Notice and version rules are defined in the registry; re-exported for the reports.
export { isChange, isNotice, isVersion, NOTICE_RULES, VERSION_RULES };

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
  const uses = usesLine(r);
  if (uses) lines.push(`uses      ${uses}`);
  return lines;
}

/** `only changes that reach 12 operations from ops.txt (2 entries matched nothing)`, with --uses. */
export function usesLine(r: Result): string | undefined {
  if (!r.uses) return undefined;
  const u = r.uses;
  return `only changes that reach ${plural(u.operations.length, 'operation')} listed in ${u.file}${u.unmatched.length ? ` (${u.unmatched.length} ${u.unmatched.length === 1 ? 'entry' : 'entries'} matched nothing: ${u.unmatched.slice(0, 3).join(', ')}${u.unmatched.length > 3 ? ', …' : ''})` : ''}`;
}

/** One finding: severity, subject, message, location, rule and ID; then acknowledgement, if any. */
export function findingLine(f: Finding, c: Paint, opts: { subject?: boolean; width?: number; indent?: string; label?: boolean } = {}): string[] {
  const loc = where(f.revision ?? f.base);
  const subject = opts.subject === false ? '' : `${f.subject.padEnd(opts.width ?? 0)}  `;
  const tail = c(DIM, `${loc ? `${loc} · ` : ''}${f.rule} · id ${f.id}`);
  const label = opts.label === false ? '-' : c(COLOR[f.severity], LABEL[f.severity]);
  const out = [`${opts.indent ?? ''}${label}  ${subject}${f.message}  ${tail}`];
  if (f.acknowledged) {
    const a = f.acknowledged;
    out.push(`${opts.indent ?? ''}       ${c(DIM, `acknowledged until ${a.expires}${a.owner ? ` by ${a.owner}` : ''}: ${a.reason}`)}`);
  }
  return out;
}

/** Which direction a finding of a paired rule (`…-in-request` / `…-in-response`) is about. */
export type Direction = 'request' | 'response';
export const directionOf = (f: Finding): Direction | undefined => (f.rule.endsWith('-in-request') ? 'request' : f.rule.endsWith('-in-response') ? 'response' : undefined);
/** A rule ID without its direction: `max-length-decreased-in-request` → `max-length-decreased`. */
export const ruleWithoutDirection = (rule: string): string => rule.replace(/-in-(request|response)$/, '');

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

/**
 * One change as reports show it: a single finding, or the request and
 * response findings of one schema change, merged. `finding` is the worst
 * part, and `parts` lists every finding (request first) with its own
 * severity, ID and acknowledgement. Only the display is merged: the result,
 * finding IDs and acknowledgements are per finding.
 */
export interface Entry {
  finding: Finding;
  parts: Finding[];
}

/**
 * Merges each change's request and response findings into one entry: same
 * rule apart from the direction, same subject, message and place. Keeps the
 * order of `findings`, each entry at its first part's position.
 */
export function mergeDirections(findings: Finding[]): Entry[] {
  const out: Entry[] = [];
  const byKey = new Map<string, Entry>();
  for (const f of findings) {
    const dir = directionOf(f);
    const at = f.revision ?? f.base;
    const key = dir ? [ruleWithoutDirection(f.rule), f.subject, f.message, at?.file ?? '', at?.pointer ?? ''].join('\0') : undefined;
    const e = key !== undefined ? byKey.get(key) : undefined;
    if (e && !e.parts.some((p) => directionOf(p) === dir)) {
      e.parts.push(f);
      e.parts.sort((a, b) => (directionOf(a) === 'request' ? 0 : 1) - (directionOf(b) === 'request' ? 0 : 1));
      if (SEVERITY_RANK[f.severity] < SEVERITY_RANK[e.finding.severity]) e.finding = f;
      continue;
    }
    const entry = { finding: f, parts: [f] };
    out.push(entry);
    if (key !== undefined && !e) byKey.set(key, entry);
  }
  return out;
}

/** `request ERROR · id 8b48ac001f7e   response INFO · id c6a8e0868a08`, for a merged entry. */
export const directionsText = (e: Entry): string => e.parts.map((p) => `${directionOf(p)} ${p.severity.toUpperCase()} · id ${p.id}`).join('   ');

/** acknowledged until …, for a finding (with its direction, in a merged entry). */
export const ackText = (f: Finding, prefix = ''): string => `${prefix}acknowledged until ${f.acknowledged!.expires}${f.acknowledged!.owner ? ` by ${f.acknowledged!.owner}` : ''}: ${f.acknowledged!.reason}`;

/**
 * An entry's lines: `findingLine` for a single finding; for a merged one, the
 * change with its worst severity and the rule without direction, then a line
 * with each direction's severity and ID, then any acknowledgements.
 */
export function entryLines(e: Entry, c: Paint, opts: { subject?: boolean; width?: number; indent?: string; label?: boolean } = {}): string[] {
  if (e.parts.length === 1) return findingLine(e.finding, c, opts);
  const f = e.finding;
  const loc = where(f.revision ?? f.base);
  const subject = opts.subject === false ? '' : `${f.subject.padEnd(opts.width ?? 0)}  `;
  const label = opts.label === false ? '-' : c(COLOR[f.severity], LABEL[f.severity]);
  const pad = `${opts.indent ?? ''}       `;
  const out = [`${opts.indent ?? ''}${label}  ${subject}${f.message}  ${c(DIM, [loc, ruleWithoutDirection(f.rule)].filter(Boolean).join(' · '))}`, `${pad}${c(DIM, directionsText(e))}`];
  for (const p of e.parts) if (p.acknowledged) out.push(`${pad}${c(DIM, ackText(p, `${directionOf(p)}: `))}`);
  return out;
}

/** `5 findings: 1 error, 2 warn, 2 info (1 acknowledged) · state: breaking`, plus the gate. */
export function countsLine(r: Result, opts: TxtOptions): string {
  const n = r.counts;
  const gate = opts.failOn === undefined ? '' : opts.failOn === 'never' ? ' · not failing CI (--fail-on never)' : ` · fails CI at ${opts.failOn} and above`;
  return `${plural(n.total, 'finding')}: ${n.bySeverity.error} error, ${n.bySeverity.warn} warn, ${n.bySeverity.info} info${n.acknowledged ? ` (${n.acknowledged} acknowledged)` : ''} · state: ${r.state}${gate}`;
}

/**
 * How to accept a change, for the review and ci reports: shown when a change
 * at warn or above isn't acknowledged, since those are the ones that can fail CI.
 */
export function ackHint(r: Result, c: Paint): string[] {
  // Version findings are fixed by bumping the version, not by accepting them.
  const open = r.findings.some((f) => !f.acknowledged && f.severity !== 'info' && !isNotice(f) && !isVersion(f));
  return open ? [c(DIM, 'To accept a change on purpose: api-diff ack <id> --reason "…" --expires <YYYY-MM-DD> (POLICY.md section 11)')] : [];
}

export function affects(ops: string[], max = 5): string {
  return `affects ${plural(ops.length, 'operation')}: ${ops.slice(0, max).join(', ')}${ops.length > max ? `, … (${ops.length - max} more)` : ''}`;
}

export { plural };

/**
 * Makes an HTML page pure ASCII, so it reads the same whatever charset it is decoded with
 * (a server that sends `charset=iso-8859-1`, PowerShell's `>` redirection, an editor's guess).
 * Non-ASCII becomes `&#x..;` in markup, `\uXXXX` in scripts (valid in JS strings, regexes,
 * template literals and JSON) and `\HHHHHH` in styles (CSS's escape; six digits so no space is needed).
 */
export function asciiHtml(html: string): string {
  const markup = (s: string): string => s.replace(/[^\x00-\x7f]/gu, (ch) => `&#x${ch.codePointAt(0)!.toString(16)};`);
  const script = (s: string): string => s.replace(/[^\x00-\x7f]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const style = (s: string): string => s.replace(/[^\x00-\x7f]/gu, (ch) => `\\${ch.codePointAt(0)!.toString(16).padStart(6, '0')}`);
  let out = '';
  let at = 0;
  for (const m of html.matchAll(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi)) {
    out += markup(html.slice(at, m.index)) + m[1] + (m[2]!.toLowerCase() === 'style' ? style(m[3]!) : script(m[3]!)) + m[4];
    at = m.index + m[0].length;
  }
  return out + markup(html.slice(at));
}

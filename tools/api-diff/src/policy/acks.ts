// Acknowledgements file (POLICY.md section 11): findings a team has accepted.
// An acknowledged finding is still reported, with its severity, but doesn't
// fail CI or count towards the result's state until the acknowledgement
// expires. Acknowledgements whose finding no longer appears are stale.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dump, load } from 'js-yaml';
import { isoDate } from '../diff/lifecycle.ts';
import type { Change, Finding } from '../types.ts';
import { PolicyError } from './errors.ts';

export interface Acknowledgement {
  finding: string;
  reason: string;
  owner?: string;
  /** Last day it applies, `YYYY-MM-DD`. */
  expires: string;
}

export interface Acknowledgements {
  file: string;
  entries: Acknowledgement[];
}

export const DEFAULT_ACK_FILE = 'api-diff.ack.yaml';
const KEYS = ['finding', 'reason', 'owner', 'expires'];

/** True if a YAML text has no content besides comments and blank lines (js-yaml rejects it). */
const noContent = (text: string): boolean => text.split('\n').every((l) => /^\s*(#.*)?$/.test(l));

export function parseAcknowledgements(data: unknown, file: string): Acknowledgements {
  if (data === null || data === undefined) return { file, entries: [] };
  if (!Array.isArray(data)) throw new PolicyError(`${file}: must be a list of acknowledgements`);
  const seen = new Set<string>();
  const entries = data.map((e, i): Acknowledgement => {
    const at = `${file}: [${i}]`;
    if (e === null || typeof e !== 'object' || Array.isArray(e)) throw new PolicyError(`${at}: must be a mapping with finding, reason and expires`);
    const o = e as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!KEYS.includes(k)) throw new PolicyError(`${at}.${k}: unknown key (an acknowledgement takes finding, reason, owner and expires)`);
    const finding = typeof o.finding === 'number' ? String(o.finding) : o.finding;
    if (typeof finding !== 'string' || !/^[0-9a-f]{12}$/.test(finding)) throw new PolicyError(`${at}.finding: must be a 12-character finding ID from a report, e.g. c7f3e1a2b4d6`);
    if (seen.has(finding)) throw new PolicyError(`${at}.finding: ${finding} is acknowledged more than once`);
    seen.add(finding);
    if (typeof o.reason !== 'string' || o.reason.trim() === '') throw new PolicyError(`${at}.reason: is required: say why the finding is accepted`);
    const expires = isoDate(o.expires);
    if (!expires) throw new PolicyError(`${at}.expires: is required and must be a date (YYYY-MM-DD)`);
    if (o.owner !== undefined && typeof o.owner !== 'string') throw new PolicyError(`${at}.owner: must be text`);
    return { finding, reason: o.reason, expires, ...(typeof o.owner === 'string' ? { owner: o.owner } : {}) };
  });
  return { file, entries };
}

/** Loads the acknowledgements file: an explicit path must exist; the default is used if present. */
export function loadAcknowledgements(cwd: string, explicit?: string): Acknowledgements | undefined {
  const name = explicit ?? DEFAULT_ACK_FILE;
  const path = resolve(cwd, name);
  if (!existsSync(path)) {
    if (explicit !== undefined) throw new PolicyError(`acknowledgements file ${explicit} not found`);
    return undefined;
  }
  let data: unknown;
  try {
    const text = readFileSync(path, 'utf8');
    data = noContent(text) ? null : load(text);
  } catch (e) {
    throw new PolicyError(`${name}: ${(e as Error).message.split('\n')[0]}`);
  }
  return parseAcknowledgements(data, name);
}

/**
 * Marks acknowledged findings, and returns notices for acknowledgements that
 * are stale (their finding doesn't appear) or expired (`asOf` is after
 * `expires`; the finding counts again). With `requireOwner`, an
 * acknowledgement applies only if its `owner` is one of the finding's owners;
 * otherwise it is reported as `acknowledgement-not-owner`.
 */
export function applyAcknowledgements(findings: Finding[], acks: Acknowledgements, asOf: string, requireOwner = false): Change[] {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const notices: Change[] = [];
  for (const a of acks.entries) {
    const f = byId.get(a.finding);
    const details = { name: a.finding, reason: a.reason, expires: a.expires, file: acks.file, ...(a.owner ? { owner: a.owner } : {}) };
    if (!f) {
      notices.push({ rule: 'acknowledgement-stale', subject: acks.file, details });
      continue;
    }
    if (asOf > a.expires) {
      notices.push({ rule: 'acknowledgement-expired', subject: f.subject, details: { ...details, rule: f.rule } });
      continue;
    }
    if (requireOwner && !(a.owner !== undefined && f.owners?.includes(a.owner))) {
      // acknowledgements.require-owner: only an owner of the finding can accept it.
      notices.push({ rule: 'acknowledgement-not-owner', subject: f.subject, details: { ...details, rule: f.rule, owners: f.owners ?? [] } });
      continue;
    }
    f.acknowledged = { reason: a.reason, expires: a.expires, file: acks.file, ...(a.owner ? { owner: a.owner } : {}) };
  }
  return notices;
}

/**
 * Returns `text` (the acknowledgements file's contents, or undefined if it
 * doesn't exist yet) with `entry` appended. Existing entries and comments are
 * kept as written. Throws a PolicyError if the entry is invalid, its finding
 * is already acknowledged, or the file is in a form that can't be appended to
 * (e.g. a flow-style list); the result is checked by parsing it again.
 */
export function appendAcknowledgement(text: string | undefined, entry: Acknowledgement, file: string): string {
  const parse = (t: string): unknown => {
    try {
      return noContent(t) ? null : load(t);
    } catch (e) {
      throw new PolicyError(`${file}: ${(e as Error).message.split('\n')[0]}`);
    }
  };
  const before = parseAcknowledgements(text === undefined ? null : parse(text), file);
  if (before.entries.some((a) => a.finding === entry.finding)) throw new PolicyError(`${file}: finding ${entry.finding} is already acknowledged; edit its entry instead`);
  const block = dump([{ finding: entry.finding, reason: entry.reason, ...(entry.owner ? { owner: entry.owner } : {}), expires: entry.expires }], { lineWidth: -1 });
  let head = text ?? '# Accepted api-diff findings (POLICY.md section 11). Each entry stops one finding failing CI until it expires.\n';
  // A file with no entries may still hold a bare `[]` or `null`; keep only its comments and blank lines.
  if (before.entries.length === 0) head = head.split('\n').filter((l) => /^\s*(#.*)?$/.test(l)).join('\n');
  if (head !== '' && !head.endsWith('\n')) head += '\n';
  const out = head + block;
  const cant = new PolicyError(`${file}: can't append to this file automatically (is it a flow-style list?); add the entry by hand`);
  let after: Acknowledgements;
  try {
    after = parseAcknowledgements(load(out), file);
  } catch {
    throw cant;
  }
  const last = after.entries.at(-1);
  if (after.entries.length !== before.entries.length + 1 || last?.finding !== entry.finding || last.reason !== entry.reason || last.expires !== entry.expires) throw cant;
  return out;
}

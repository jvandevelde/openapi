// Lifecycle (POLICY.md section 7; RULES.md section 9): deprecation, sunset
// dates and stability levels on operations and parameters, and the
// deprecation period that lets an operation be removed without an error.
// Schema deprecation (`deprecated` on a schema or property) is reported by
// the schema engine.

import { isObject, type Ref } from '../load/documents.ts';
import type { Model, Operation } from '../model/model.ts';
import { PolicyError } from '../policy/errors.ts';
import type { LifecycleSettings } from '../policy/context.ts';
import type { Change, Side } from '../types.ts';

export interface RemovalOptions {
  /** Days an operation must be deprecated before removal; a number, or per stability level. */
  deprecatedForDays: number | Record<string, number>;
  pastSunset: boolean;
  /** `allow`: a deprecation without a date counts as long enough. `block`: it doesn't. */
  undatedDeprecation: 'allow' | 'block';
}

export interface LifecycleOptions {
  lifecycle: LifecycleSettings;
  /** Stability levels, lowest first. */
  levels: string[];
  removal: RemovalOptions;
  /** The reference date, `YYYY-MM-DD` (UTC). */
  asOf: string;
}

export const DEFAULT_LEVELS = ['draft', 'alpha', 'beta', 'stable'];
export const DEFAULT_DEPRECATED_FOR_DAYS = 90;

/** Validates `operation-removed`'s `unless` option. */
export function removalOptions(raw: unknown, where = 'rules.operation-removed.unless'): RemovalOptions {
  const o: RemovalOptions = { deprecatedForDays: DEFAULT_DEPRECATED_FOR_DAYS, pastSunset: true, undatedDeprecation: 'allow' };
  if (raw === undefined) return o;
  if (!isObject(raw)) throw new PolicyError(`${where}: must be a mapping`);
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'deprecated-for-days') {
      const ok = (n: unknown): boolean => Number.isInteger(n) && (n as number) >= 0;
      if (ok(v)) o.deprecatedForDays = v as number;
      else if (isObject(v) && Object.keys(v).length && Object.values(v).every(ok)) o.deprecatedForDays = v as Record<string, number>;
      else throw new PolicyError(`${where}.deprecated-for-days: must be a whole number of days, or a mapping of stability level to days`);
    } else if (k === 'past-sunset') {
      if (typeof v !== 'boolean') throw new PolicyError(`${where}.past-sunset: must be true or false`);
      o.pastSunset = v;
    } else if (k === 'undated-deprecation') {
      if (v !== 'allow' && v !== 'block') throw new PolicyError(`${where}.undated-deprecation: must be allow or block`);
      o.undatedDeprecation = v;
    } else throw new PolicyError(`${where}.${k}: unknown option (unless takes deprecated-for-days, past-sunset and undated-deprecation)`);
  }
  return o;
}

/** Validates `stability-decreased`'s `levels` option. */
export function stabilityLevels(raw: unknown, where = 'rules.stability-decreased.levels'): string[] {
  if (raw === undefined) return [...DEFAULT_LEVELS];
  if (!Array.isArray(raw) || raw.length < 2 || !raw.every((l) => typeof l === 'string' && l !== '') || new Set(raw).size !== raw.length) throw new PolicyError(`${where}: must be a list of at least two different level names, lowest first`);
  return raw as string[];
}

/** `YYYY-MM-DD` from a string or a YAML date, or undefined if it isn't a valid date. */
export function isoDate(v: unknown): string | undefined {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : undefined;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const opSubject = (op: Operation): string => `${op.method.toUpperCase()} ${op.path}`;

interface OpLifecycle {
  deprecated: boolean;
  deprecatedSince: string | undefined;
  sunset: string | undefined;
  stability: string;
}

/** Reads an operation's lifecycle values, reporting invalid ones as spec-invalid on `side`. */
function readOp(m: Model, op: Operation, o: LifecycleOptions, side: Side, problems: Change[] | undefined): OpLifecycle {
  const node = m.docs.value(op.at);
  const item = m.docs.value({ file: op.at.file, segs: op.at.segs.slice(0, -1) });
  const own = isObject(node) ? node : {};
  const lc = o.lifecycle;
  const pick = (k: string): [unknown, Ref] | undefined => {
    if (k in own) return [own[k], { file: op.at.file, segs: [...op.at.segs, k] }];
    if (isObject(item) && k in item) return [item[k], { file: op.at.file, segs: [...op.at.segs.slice(0, -1), k] }];
    return undefined;
  };
  const problem = (at: Ref, reason: string): void => {
    problems?.push({ rule: 'spec-invalid', subject: opSubject(op), [side]: m.docs.location(at), details: { reason, side } });
  };
  const date = (k: string): string | undefined => {
    const p = pick(k);
    if (!p) return undefined;
    const d = isoDate(p[0]);
    if (!d) problem(p[1], `${k} must be a date (YYYY-MM-DD), got ${JSON.stringify(p[0])}`);
    return d;
  };
  let stability = lc.defaultStability;
  const s = pick(lc.stability);
  if (s) {
    if (typeof s[0] === 'string' && o.levels.includes(s[0])) stability = s[0];
    else problem(s[1], `${lc.stability} must be one of ${o.levels.join(', ')} (the stability-decreased levels), got ${JSON.stringify(s[0])}`);
  }
  return { deprecated: own.deprecated === true, deprecatedSince: date(lc.deprecatedSince), sunset: date(lc.sunset), stability };
}

/** Lifecycle changes between paired operations, plus invalid lifecycle values on either side. */
export function diffLifecycle(base: Model, rev: Model, pairs: [Operation, Operation][], o: LifecycleOptions): Change[] {
  const out: Change[] = [];
  // Invalid values on every operation, on both sides.
  for (const [m, side] of [[base, 'base'], [rev, 'revision']] as const) for (const op of m.operations.values()) readOp(m, op, o, side, out);

  for (const [b, r] of pairs) {
    const bl = readOp(base, b, o, 'base', undefined);
    const rl = readOp(rev, r, o, 'revision', undefined);
    const subject = opSubject(r);
    const at = (m: Model, op: Operation, k: string): ReturnType<Model['docs']['location']> => m.docs.location({ file: op.at.file, segs: [...op.at.segs, k] });
    if (!bl.deprecated && rl.deprecated) out.push({ rule: 'deprecated-added', subject, revision: at(rev, r, 'deprecated'), details: { what: 'operation' } });
    if (bl.deprecated && !rl.deprecated) out.push({ rule: 'deprecated-removed', subject, base: at(base, b, 'deprecated'), details: { what: 'operation' } });
    if (bl.sunset && rl.sunset && rl.sunset < bl.sunset) out.push({ rule: 'sunset-moved-earlier', subject, base: at(base, b, o.lifecycle.sunset), revision: at(rev, r, o.lifecycle.sunset), details: { from: bl.sunset, to: rl.sunset } });
    if (o.levels.indexOf(rl.stability) < o.levels.indexOf(bl.stability)) out.push({ rule: 'stability-decreased', subject, base: base.docs.location(b.at), revision: rev.docs.location(r.at), details: { from: bl.stability, to: rl.stability } });

    for (const [key, bp] of b.params) {
      const rp = r.params.get(key);
      if (!rp) continue;
      const bd = isObject(base.docs.value(bp.at)) && (base.docs.value(bp.at) as Record<string, unknown>).deprecated === true;
      const rd = isObject(rev.docs.value(rp.at)) && (rev.docs.value(rp.at) as Record<string, unknown>).deprecated === true;
      if (!bd && rd) out.push({ rule: 'deprecated-added', subject, location: rp.in, revision: rev.docs.location({ file: rp.at.file, segs: [...rp.at.segs, 'deprecated'] }), details: { what: `${rp.in} parameter`, name: rp.name } });
      if (bd && !rd) out.push({ rule: 'deprecated-removed', subject, location: bp.in, base: base.docs.location({ file: bp.at.file, segs: [...bp.at.segs, 'deprecated'] }), details: { what: `${bp.in} parameter`, name: bp.name } });
    }
  }
  return out;
}

/**
 * Rewrites `operation-removed` as `operation-removed-after-deprecation` when
 * the base operation was deprecated long enough, or its sunset date passed.
 * Otherwise adds the deprecation details, so the message can say why not.
 */
export function applyDeprecationPeriod(changes: Change[], base: Model, o: LifecycleOptions): Change[] {
  const bySubject = new Map([...base.operations.values()].map((op) => [opSubject(op), op]));
  return changes.map((c) => {
    if (c.rule !== 'operation-removed') return c;
    const op = bySubject.get(c.subject);
    if (!op) return c;
    const l = readOp(base, op, o, 'base', undefined);
    const need = typeof o.removal.deprecatedForDays === 'number' ? o.removal.deprecatedForDays : (o.removal.deprecatedForDays[l.stability] ?? DEFAULT_DEPRECATED_FOR_DAYS);
    const details: Record<string, unknown> = { ...c.details, stability: l.stability, needDays: need, asOf: o.asOf };
    if (l.sunset) details.sunset = l.sunset;
    if (l.sunset && o.removal.pastSunset && l.sunset <= o.asOf) return { ...c, rule: 'operation-removed-after-deprecation', details: { ...details, reason: 'past-sunset' } };
    if (!l.deprecated) return { ...c, details: { ...details, reason: 'not-deprecated' } };
    if (l.deprecatedSince) {
      const days = daysBetween(l.deprecatedSince, o.asOf);
      details.deprecatedSince = l.deprecatedSince;
      details.deprecatedDays = days;
      if (days >= need) return { ...c, rule: 'operation-removed-after-deprecation', details: { ...details, reason: 'deprecation-period' } };
      return { ...c, details: { ...details, reason: 'deprecated-too-short' } };
    }
    if (need === 0 || o.removal.undatedDeprecation === 'allow') return { ...c, rule: 'operation-removed-after-deprecation', details: { ...details, reason: need === 0 ? 'deprecation-period' : 'undated-deprecation' } };
    return { ...c, details: { ...details, reason: 'undated-deprecation-blocked' } };
  });
}

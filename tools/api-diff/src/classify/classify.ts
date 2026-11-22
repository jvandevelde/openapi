// Classify stage: turns changes (no severity) into findings (severity,
// specific rule ID, message, stable ID).
//
// Severity precedence (POLICY.md section 12), highest first:
//   in-spec hints (`x-api-diff`): `enum: open`, then `rules` on the nodes
//     containing the change (nearest first), the affected operation and its
//     path item, then the document root
//   → policy `overrides` (the last matching entry that sets this rule)
//   → policy `rules` (the most specific rule ID wins; `--rule` beats the file)
//   → profile → built-in default.
// Acknowledgements are added by a later M6 step.
//
// Overrides apply per operation. A finding that affects several operations
// (a shared component's `impact`, or a bulk change) is split when they end up
// with different severities, so each part lists the operations it covers.

import { createHash } from 'node:crypto';
import type { OperationInfo, SpecContext } from '../policy/context.ts';
import { parentPointer, type Hint, type HintIndex } from '../policy/hints.ts';
import { matches, type Override } from '../policy/overrides.ts';
import type { Policy, RuleSetting } from '../policy/policy.ts';
import { getRule, specificRuleId, type RuleMeta } from '../rules/registry.ts';
import type { Change, Finding, Profile, Severity } from '../types.ts';

export interface ClassifyOptions {
  profile: Profile;
  policy?: Policy;
  /** Operations, components and document extensions, for overrides. */
  context?: SpecContext;
  /** `x-api-diff` hints per side. */
  hints?: { base: HintIndex | undefined; revision: HintIndex | undefined };
}

type Resolved = { severity: Severity | 'off'; source: string };

const SEVERITIES: readonly string[] = ['error', 'warn', 'info'];
const isOperation = (subject: string): boolean => /^[A-Z]+ \//.test(subject);

/** Settings for a rule from a rules map, most specific rule ID first. */
function settingsIn(rules: Map<string, RuleSetting> | undefined, rule: string, meta: RuleMeta): [string, RuleSetting][] {
  if (!rules) return [];
  const out: [string, RuleSetting][] = [];
  for (const id of rule === meta.id ? [rule] : [rule, meta.id]) {
    const s = rules.get(id);
    if (s) out.push([id, s]);
  }
  return out;
}

/** A rule option from the policy (most specific rule ID first), or undefined. */
export function ruleOption(policy: Policy | undefined, rule: string, name: string): unknown {
  const meta = getRule(rule.replace(/^(query|header|cookie)-/, '').replace(/-in-(request|response)$/, ''));
  for (const [, s] of settingsIn(policy?.rules, rule, meta)) if (name in s.options) return s.options[name];
  return undefined;
}

/**
 * Applies one rules map (the top-level `rules`, or an override's): `off`,
 * then the conditional case's option, then `severity`. Returns undefined if
 * the map says nothing for this change.
 */
function fromRules(c: Change, meta: RuleMeta, settings: [string, RuleSetting][], label: (id: string, key?: string) => string): Resolved | 'conditional' | undefined {
  const set = settings.find(([, s]) => s.severity !== undefined);
  if (set?.[1].severity === 'off') return { severity: 'off', source: label(set[0]) };
  if (meta.conditional?.(c)) {
    if (meta.conditionalOption) {
      for (const [id, s] of settings) {
        const v = s.options[meta.conditionalOption];
        if (typeof v === 'string' && SEVERITIES.includes(v)) return { severity: v as Severity, source: label(id, `.${meta.conditionalOption}`) };
      }
    }
    return settings.length ? 'conditional' : undefined; // the conditional default stands
  }
  if (set) return { severity: set[1].severity as Severity, source: label(set[0]) };
  return undefined;
}

const hintLabel = (h: Hint): string => `in-spec hint ${h.file}#${h.pointer}`;

/** `enum: open` on the schema holding the enum, or an `open-extensions` extension there. */
function openEnum(c: Change, rule: string, opts: ClassifyOptions): Resolved | undefined {
  if (ruleOption(opts.policy, rule, 'honour-open-hint') === false) return undefined;
  const exts = (ruleOption(opts.policy, rule, 'open-extensions') as string[] | undefined) ?? [];
  for (const [loc, idx] of [[c.revision, opts.hints?.revision], [c.base, opts.hints?.base]] as const) {
    if (!loc || !idx || !loc.pointer.endsWith('/enum')) continue;
    const schema = { file: loc.file, pointer: parentPointer(loc.pointer) };
    const h = idx.at(schema);
    if (h?.enumOpen) return { severity: 'info', source: `${hintLabel(h)}: enum: open` };
    const node = exts.length ? idx.node(schema) : undefined;
    const x = node && typeof node === 'object' ? exts.find((e) => (node as Record<string, unknown>)[e] !== undefined && (node as Record<string, unknown>)[e] !== false) : undefined;
    if (x) return { severity: 'info', source: `${opts.policy?.file ? `policy ${opts.policy.file}` : 'policy'}: rules.enum-value-added.open-extensions (${x} at ${loc.file}#${schema.pointer})` };
  }
  return undefined;
}

/** `x-api-diff: { rules }` hints that apply, in precedence order. */
function hintsFor(c: Change, op: OperationInfo | undefined, opts: ClassifyOptions): Hint[] {
  if (!opts.hints) return [];
  const near: Hint[] = [];
  for (const [loc, idx] of [[c.revision, opts.hints.revision], [c.base, opts.hints.base]] as const) {
    if (loc && idx) near.push(...idx.around(loc).filter((h) => !h.atRoot));
  }
  const roots = [opts.hints.revision?.root, opts.hints.base?.root].filter((h): h is Hint => !!h);
  return [...near, ...(op?.hints ?? []), ...roots].filter((h) => h.rules);
}

/** The severity for a change in one operation (or none), or `off`, and where it came from. */
export function resolveSeverity(c: Change, rule: string, opts: ClassifyOptions, op?: OperationInfo): Resolved {
  const meta = getRule(c.rule);
  const policy = opts.policy;
  const fileLabel = `policy ${policy?.file ?? ''}`.trimEnd();

  if (meta.id === 'enum-value-added') {
    const open = openEnum(c, rule, opts);
    if (open) return open;
  }
  for (const h of hintsFor(c, op, opts)) {
    const r = fromRules(c, meta, settingsIn(h.rules, rule, meta), (id, key = '') => `${hintLabel(h)}: rules.${id}${key}`);
    if (r === 'conditional') return defaultSeverity(c, opts.profile);
    if (r) return r;
  }

  const overrides = policy?.overrides ?? [];
  if (overrides.length) {
    const target = { rule, baseRule: meta.id, kind: meta.kind, direction: c.direction, subject: c.subject, op };
    for (let i = overrides.length - 1; i >= 0; i--) {
      const o: Override = overrides[i]!;
      if (!matches(o.match, target, opts.context ?? { operations: new Map(), components: new Map(), document: {} })) continue;
      const where = `${fileLabel}: overrides #${o.index} (${o.label})`;
      if (o.severity) return { severity: o.severity, source: where };
      const r = fromRules(c, meta, settingsIn(o.rules, rule, meta), (id, key = '') => `${where}: rules.${id}${key}`);
      if (r === 'conditional') return defaultSeverity(c, opts.profile);
      if (r) return r;
    }
  }

  const settings = settingsIn(policy?.rules, rule, meta);
  const r = fromRules(c, meta, settings, (id, key = '') => `${settings.find(([s]) => s === id)?.[1].from ?? fileLabel}: rules.${id}${key}`);
  if (r && r !== 'conditional') return r;
  return defaultSeverity(c, opts.profile);
}

export function defaultSeverity(change: Change, profile: Profile): { severity: Severity; source: string } {
  const meta = getRule(change.rule);
  const conditional = meta.conditional?.(change);
  if (conditional) return { severity: conditional, source: 'default (conditional)' };
  if (profile === 'sdk' && meta.sdkProfile) return { severity: meta.sdkProfile, source: 'profile sdk' };
  const s = meta.severity;
  if (typeof s === 'string') return { severity: s, source: 'default' };
  return { severity: change.direction === 'in' ? s.in : s.out, source: 'default' };
}

export function findingId(c: Change, rule: string, part?: string[]): string {
  const key = [rule, c.subject, c.base?.pointer ?? '', c.revision?.pointer ?? '', String(c.details.name ?? ''), String(c.details.status ?? ''), ...(part ? ['part', ...part] : [])].join('\u0000');
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

/** The operations a change affects: its subject, or its impact list. */
function operationsOf(c: Change): string[] {
  if (isOperation(c.subject)) return [c.subject];
  return (c.impact ?? []).filter(isOperation);
}

/**
 * Severity per operation, grouped. One group (the usual case) keeps the
 * change whole; several mean overrides treat the operations differently.
 */
function resolveGroups(c: Change, rule: string, opts: ClassifyOptions): { resolved: Resolved; ops: string[] | undefined }[] {
  const ops = opts.policy?.overrides?.length || opts.context?.operations.size ? operationsOf(c) : [];
  if (ops.length <= 1) return [{ resolved: resolveSeverity(c, rule, opts, ops[0] ? opts.context?.operations.get(ops[0]) : undefined), ops: undefined }];
  const groups = new Map<string, { resolved: Resolved; ops: string[] }>();
  for (const s of ops) {
    const resolved = resolveSeverity(c, rule, opts, opts.context?.operations.get(s));
    const key = `${resolved.severity}\u0000${resolved.source}`;
    const g = groups.get(key);
    if (g) g.ops.push(s);
    else groups.set(key, { resolved, ops: [s] });
  }
  if (groups.size === 1) return [{ resolved: [...groups.values()][0]!.resolved, ops: undefined }];
  return [...groups.values()];
}

export function classify(changes: Change[], opts: ClassifyOptions): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const c of changes) {
    const meta = getRule(c.rule);
    const rule = specificRuleId(meta, c);
    const whole = findingId(c, rule);
    if (seen.has(whole)) continue; // the same change reported twice (e.g. a shared document notice)
    seen.add(whole);
    for (const { resolved, ops } of resolveGroups(c, rule, opts)) {
      const { severity, source } = resolved;
      if (severity === 'off') continue;
      if (opts.policy?.minSeverity && !severityAtLeast(severity, opts.policy.minSeverity)) continue;
      // A split part: an operation subject stays as it is; otherwise the part lists its operations.
      const bulk = ops && /^\d+ operations$/.test(c.subject);
      const subject = !ops || !bulk ? c.subject : ops.length === 1 ? ops[0]! : `${ops.length} operations`;
      const f: Finding = {
        id: ops ? findingId(c, rule, ops) : whole,
        rule,
        baseRule: meta.id,
        kind: meta.kind,
        severity,
        severitySource: source,
        subject,
        message: meta.message(c),
        details: ops && bulk ? { ...c.details, operations: ops.length } : c.details,
      };
      if (c.base) f.base = c.base;
      if (c.revision) f.revision = c.revision;
      const impact = ops ? (subject === ops[0] && ops.length === 1 && bulk ? undefined : ops) : c.impact;
      if (impact?.length) f.impact = impact;
      out.push(f);
    }
  }
  return out.sort(compareFindings);
}

const RANK: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

export function compareFindings(a: Finding, b: Finding): number {
  return RANK[a.severity] - RANK[b.severity] || a.subject.localeCompare(b.subject) || a.rule.localeCompare(b.rule) || a.message.localeCompare(b.message);
}

export function severityAtLeast(s: Severity, threshold: Severity): boolean {
  return RANK[s] <= RANK[threshold];
}

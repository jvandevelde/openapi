// The sdk report (PLAN.md section 5): which generated methods, arguments and
// types change, for SDK maintainers. A table of renames (old → new), then
// changes grouped by method (operationId) and by type (component), and the
// SDK version bump. The bump uses --profile sdk severities whatever profile
// the run used, because that's what generated code sees: anything that is an
// error under the sdk profile needs a major SDK release.

import { getRule } from '../rules/registry.ts';
import type { BumpLevel, Finding, Result, Severity } from '../types.ts';
import { isChange } from './common.ts';

/** Wire rules that also change generated code's shape: methods, arguments, fields and enum members. */
const SHAPE = /^(operation-(added|removed|removed-after-deprecation|path-changed)|parameter-(added-required|added-optional|removed|became-required|became-optional|location-changed)|request-body-(added-required|added-optional|removed)|property-(added-required|added-optional|removed|became-required|became-optional)|type-(changed|widened|narrowed)|nullable-(added|removed)|enum-value-(added|removed)|union-branch-(added|removed)|union-kind-changed)$/;

export interface Rename {
  what: 'method' | 'argument' | 'type';
  from: string;
  to: string;
  /** Where: the operation, or the component. */
  where: string;
}

export interface SdkGroup {
  /** operationId (or the operation when it has none) for methods; the component name for types. */
  name: string;
  operation?: string;
  changes: { severity: Severity; text: string; rule: string; id: string }[];
}

export interface SdkData {
  report: 'sdk';
  title?: string;
  from: string;
  to: string;
  bump: BumpLevel;
  /** Changes that break generated code (errors under --profile sdk). */
  breaking: number;
  renames: Rename[];
  methods: SdkGroup[];
  types: SdkGroup[];
}

/** The finding's severity under --profile sdk (conditional defaults and policy-set severities stay). */
function sdkSeverity(f: Finding): Severity {
  if (f.severitySource !== 'default' && f.severitySource !== 'profile sdk') return f.severity;
  return getRule(f.baseRule).sdkProfile ?? f.severity;
}

const short = (s: string): string => s.replace(/^#\/components\/schemas\//, '');

export function sdkData(r: Result): SdkData {
  const relevant = r.findings.filter((f) => isChange(f) && (f.kind === 'sdk' || SHAPE.test(f.baseRule)));
  const renames: Rename[] = [];
  const methods = new Map<string, SdkGroup>();
  const types = new Map<string, SdkGroup>();
  let breaking = 0;
  let bump: BumpLevel = 'none';
  const raise = (l: BumpLevel): void => {
    const rank: Record<BumpLevel, number> = { none: 0, patch: 1, minor: 2, major: 3 };
    if (rank[l] > rank[bump]) bump = l;
  };
  for (const f of relevant) {
    const sev = sdkSeverity(f);
    if (sev === 'error') breaking++;
    raise(sev === 'error' ? 'major' : 'minor');
    const d = (k: string): string => String(f.details[k] ?? '');
    if (f.baseRule === 'operation-id-changed') renames.push({ what: 'method', from: d('from'), to: d('to'), where: f.subject });
    else if (f.baseRule === 'parameter-renamed' || f.baseRule === 'path-param-renamed') renames.push({ what: 'argument', from: d('from'), to: d('to'), where: f.subject });
    else if (f.baseRule === 'component-renamed') renames.push({ what: 'type', from: short(d('from')), to: short(d('to')), where: short(f.subject) });
    else if (f.baseRule === 'schema-title-changed') renames.push({ what: 'type', from: d('from'), to: d('to'), where: short(f.subject) });
    const change = { severity: sev, text: f.message, rule: f.rule, id: f.id };
    const ops = /^[A-Z]+ \//.test(f.subject) ? [f.subject] : f.subject.startsWith('#/components/') ? [] : (f.impact ?? []);
    if (f.subject.startsWith('#/components/')) {
      const name = short(f.subject);
      const g = types.get(name) ?? { name, changes: [] };
      g.changes.push(change);
      types.set(name, g);
    }
    for (const op of ops) {
      const name = r.operations?.[op]?.operationId ?? op;
      const g = methods.get(op) ?? { name, operation: op, changes: [] };
      g.changes.push(change);
      methods.set(op, g);
    }
  }
  const rank: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
  const sortGroup = (g: SdkGroup): SdkGroup => {
    // The same change in requests and responses reads the same: one line, with the worse severity.
    const byText = new Map<string, SdkGroup['changes'][number]>();
    for (const c of g.changes) {
      const seen = byText.get(c.text);
      if (!seen || rank[c.severity] < rank[seen.severity]) byText.set(c.text, c);
    }
    return { ...g, changes: [...byText.values()].sort((a, b) => rank[a.severity] - rank[b.severity] || a.text.localeCompare(b.text)) };
  };
  const data: SdkData = {
    report: 'sdk',
    from: r.compared.base.version,
    to: r.compared.revision.version,
    bump,
    breaking,
    renames: renames.sort((a, b) => a.what.localeCompare(b.what) || a.from.localeCompare(b.from)),
    methods: [...methods.values()].map(sortGroup).sort((a, b) => a.name.localeCompare(b.name)),
    types: [...types.values()].map(sortGroup).sort((a, b) => a.name.localeCompare(b.name)),
  };
  const title = r.compared.revision.title ?? r.compared.base.title;
  if (title) data.title = title;
  return data;
}

const MARK: Record<Severity, string> = { error: 'breaks', warn: 'check', info: '     ' };

export function renderSdk(r: Result): string {
  const d = sdkData(r);
  const out = [`SDK changes: ${d.title ?? 'API'} ${d.from} → ${d.to}`, ''];
  if (d.bump === 'none') return [...out, 'Nothing changes for generated SDKs.', ''].join('\n');
  out.push(`SDK release: ${d.bump} version${d.breaking ? ` (${d.breaking} change${d.breaking === 1 ? '' : 's'} break${d.breaking === 1 ? 's' : ''} generated code)` : ''}`, '');
  if (d.renames.length) {
    out.push('Renamed');
    const w = Math.max(...d.renames.map((x) => x.from.length));
    for (const x of d.renames) out.push(`  ${x.what.padEnd(8)}  ${x.from.padEnd(w)} → ${x.to}   (${x.where})`);
    out.push('');
  }
  const group = (title: string, gs: SdkGroup[]): void => {
    if (!gs.length) return;
    out.push(title);
    for (const g of gs) {
      out.push(`  ${g.name}${g.operation && g.operation !== g.name ? `  (${g.operation})` : ''}`);
      for (const c of g.changes) out.push(`    ${MARK[c.severity]}  ${c.text}  [${c.rule}]`);
    }
    out.push('');
  };
  group('Methods', d.methods);
  group('Types', d.types);
  return out.join('\n');
}

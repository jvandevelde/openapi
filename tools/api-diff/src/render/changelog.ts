// The changelog report (PLAN.md section 5): what changed for API consumers
// in this release and what they need to do. Plain-language entries (added,
// changed, deprecated, removed) with migration notes, grouped by tag and
// then operation; changes to shared components get their own section with
// the operations they affect. Leaves out docs-only changes (unless the
// report's include.kinds asks for them), notices, version checks,
// acknowledgement details and unused components. The report's exclusion
// sets apply (policy reports.changelog.exclude).

import type { Finding, Result } from '../types.ts';
import { clientNote } from '../rules/notes.ts';
import { adviceLine, isChange } from './common.ts';

export type EntryKind = 'added' | 'changed' | 'deprecated' | 'removed';

export interface ChangelogEntry {
  kind: EntryKind;
  breaking: boolean;
  /** What changed, from the finding's message. */
  text: string;
  /** What a client has to do, if anything. */
  note?: string;
  rule: string;
  id: string;
}

export interface ChangelogOperation {
  operation: string;
  summary?: string;
  entries: ChangelogEntry[];
}

export interface ChangelogData {
  report: 'changelog';
  title?: string;
  from: string;
  to: string;
  advice?: string;
  breaking: number;
  /** By tag (operations without tags under "Other"), in tag order. */
  tags: { tag: string; operations: ChangelogOperation[] }[];
  /** Changes to shared components, with the operations they affect. */
  components: { component: string; operations: string[]; entries: ChangelogEntry[] }[];
}

const ADDED = /^(operation-added|parameter-added-optional|request-body-added-optional|request-media-type-added|response-(success|error)-status-added|response-media-type-added|response-header-added|property-added-optional|enum-value-added|union-branch-added|discriminator-mapping-added|security-alternative-added)$/;
const REMOVED = /^(operation-removed|operation-removed-after-deprecation|parameter-removed|request-body-removed|request-media-type-removed|response-(success|error)-status-removed|response-default-removed|response-media-type-removed|response-header-removed|response-body-removed|property-removed|enum-value-removed|union-branch-removed|discriminator-mapping-removed|security-alternative-removed)$/;
const DEPRECATED = /^(deprecated-added|sunset-moved-earlier|stability-decreased)$/;
/** Not about clients: unused components. */
const SKIP = /^(component-added|component-removed|component-unused)$/;

export function entryKind(f: Finding): EntryKind {
  if (DEPRECATED.test(f.baseRule)) return 'deprecated';
  if (ADDED.test(f.baseRule)) return 'added';
  if (REMOVED.test(f.baseRule)) return 'removed';
  return 'changed';
}

const ORDER: Record<EntryKind, number> = { removed: 0, changed: 1, deprecated: 2, added: 3 };
const isOperation = (s: string): boolean => /^[A-Z]+ \//.test(s);

function entry(f: Finding): ChangelogEntry {
  const note = clientNote(f);
  const e: ChangelogEntry = { kind: entryKind(f), breaking: f.severity === 'error', text: f.message, rule: f.rule, id: f.id };
  if (note) e.note = note;
  return e;
}

/** The same change in requests and responses reads the same: keep one entry, breaking if either is, with each distinct note. */
function merge(es: ChangelogEntry[]): ChangelogEntry[] {
  const byText = new Map<string, ChangelogEntry>();
  for (const e of es) {
    const k = `${e.kind}\u0000${e.text}`;
    const seen = byText.get(k);
    if (!seen) byText.set(k, { ...e });
    else {
      seen.breaking ||= e.breaking;
      if (e.note && seen.note !== e.note) seen.note = seen.note ? `${seen.note} ${e.note}` : e.note;
    }
  }
  return [...byText.values()];
}

const sortEntries = (es: ChangelogEntry[]): ChangelogEntry[] => merge(es).sort((a, b) => Number(b.breaking) - Number(a.breaking) || ORDER[a.kind] - ORDER[b.kind] || a.text.localeCompare(b.text));

export function changelogData(r: Result, opts: { docs?: boolean } = {}): ChangelogData {
  const findings = r.findings.filter((f) => isChange(f) && !SKIP.test(f.baseRule) && f.kind !== 'docs');
  const docs = opts.docs ? r.findings.filter((f) => isChange(f) && f.kind === 'docs') : []; // only when the report's include.kinds asks for docs
  const byOp = new Map<string, ChangelogEntry[]>();
  const byComponent = new Map<string, { operations: Set<string>; entries: ChangelogEntry[] }>();
  for (const f of [...findings, ...docs]) {
    if (isOperation(f.subject)) byOp.set(f.subject, [...(byOp.get(f.subject) ?? []), entry(f)]);
    else if (f.subject.startsWith('#/components/')) {
      const c = byComponent.get(f.subject) ?? { operations: new Set<string>(), entries: [] };
      c.entries.push(entry(f));
      for (const o of f.impact ?? []) c.operations.add(o);
      byComponent.set(f.subject, c);
    } else if (f.impact?.length) {
      // Bulk changes ("N operations") and document-level changes with affected operations: list under each.
      for (const o of f.impact) byOp.set(o, [...(byOp.get(o) ?? []), entry(f)]);
    } else byOp.set('API-wide', [...(byOp.get('API-wide') ?? []), entry(f)]);
  }
  const byTag = new Map<string, ChangelogOperation[]>();
  for (const [operation, entries] of byOp) {
    const meta = r.operations?.[operation];
    const tag = operation === 'API-wide' ? 'API-wide' : (meta?.tags[0] ?? 'Other');
    const op: ChangelogOperation = { operation, entries: sortEntries(entries) };
    if (meta?.summary) op.summary = meta.summary;
    byTag.set(tag, [...(byTag.get(tag) ?? []), op]);
  }
  const tagRank = (t: string): number => (t === 'API-wide' ? 0 : t === 'Other' ? 2 : 1);
  const tags = [...byTag.entries()]
    .sort(([a], [b]) => tagRank(a) - tagRank(b) || a.localeCompare(b))
    .map(([tag, operations]) => ({ tag, operations: operations.sort((a, b) => a.operation.split(' ')[1]!.localeCompare(b.operation.split(' ')[1]!) || a.operation.localeCompare(b.operation)) }));
  const components = [...byComponent.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([component, c]) => ({ component: component.replace(/^#\/components\/schemas\//, ''), operations: [...c.operations].sort(), entries: sortEntries(c.entries) }));
  const all = [...findings, ...docs];
  const data: ChangelogData = {
    report: 'changelog',
    from: r.compared.base.version,
    to: r.compared.revision.version,
    breaking: all.filter((f) => f.severity === 'error').length,
    tags,
    components,
  };
  const title = r.compared.revision.title ?? r.compared.base.title;
  if (title) data.title = title;
  const advice = adviceLine(r);
  if (advice) data.advice = advice;
  return data;
}

const LABEL: Record<EntryKind, string> = { added: 'Added', changed: 'Changed', deprecated: 'Deprecated', removed: 'Removed' };

function entryLines(e: ChangelogEntry): string[] {
  const out = [`- **${LABEL[e.kind]}${e.breaking ? ' (breaking)' : ''}:** ${e.text}`];
  if (e.note) out.push(`  ${e.note}`);
  return out;
}

/** Text in Markdown style, so it can be pasted into release notes. */
export function renderChangelog(r: Result, opts: { docs?: boolean } = {}): string {
  const d = changelogData(r, opts);
  const out = [`# ${d.title ?? 'API'} ${d.from} → ${d.to}`, ''];
  if (!d.tags.length && !d.components.length) return [...out, 'No changes for API clients.', ''].join('\n');
  out.push(d.breaking ? `**${d.breaking} breaking change${d.breaking === 1 ? '' : 's'}.** Clients may need updating; each change below says what to do.` : 'No breaking changes.');
  out.push('');
  for (const t of d.tags) {
    out.push(`## ${t.tag}`, '');
    for (const op of t.operations) {
      if (op.operation !== 'API-wide') out.push(`### \`${op.operation}\`${op.summary ? `: ${op.summary}` : ''}`, '');
      for (const e of op.entries) out.push(...entryLines(e));
      out.push('');
    }
  }
  if (d.components.length) {
    out.push('## Shared types', '');
    for (const c of d.components) {
      out.push(`### \`${c.component}\``, '');
      if (c.operations.length) out.push(`Used by ${c.operations.map((o) => `\`${o}\``).join(', ')}.`, '');
      for (const e of c.entries) out.push(...entryLines(e));
      out.push('');
    }
  }
  return out.join('\n');
}

// HTML for the review and summary reports: one self-contained file (inline
// CSS, no scripts, no network), so it works as a CI artifact or opened
// locally. Light and dark themes follow the viewer's settings.

import type { Finding, Result, Severity } from '../types.ts';
import { adviceLine, isChange, isNotice, isVersion, where } from './common.ts';
import { docsSummary, groupFindings, type Group } from './review.ts';
import { summaryData } from './summary.ts';
import { changelogData, type ChangelogEntry } from './changelog.ts';

const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

const CSS = `
:root { --bg: #ffffff; --fg: #1f2328; --muted: #59636e; --line: #d1d9e0; --card: #f6f8fa;
  --error: #cf222e; --warn: #9a6700; --info: #0969da; --error-bg: #ffebe9; --warn-bg: #fff8c5; --info-bg: #ddf4ff; }
@media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --fg: #e6edf3; --muted: #9198a1; --line: #3d444d; --card: #151b23;
  --error: #ff7b72; --warn: #d29922; --info: #58a6ff; --error-bg: #3c1618; --warn-bg: #3a2d0a; --info-bg: #0c2d4a; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 17px; margin: 28px 0 10px; }
.muted { color: var(--muted); } code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
table.meta { border-collapse: collapse; margin: 12px 0; width: 100%; } .meta td { padding: 3px 12px 3px 0; vertical-align: top; }
.meta td:first-child { color: var(--muted); width: 90px; }
.sev { display: inline-block; min-width: 52px; text-align: center; font-size: 12px; font-weight: 600; padding: 1px 6px; border-radius: 10px; }
.sev.error { color: var(--error); background: var(--error-bg); } .sev.warn { color: var(--warn); background: var(--warn-bg); } .sev.info { color: var(--info); background: var(--info-bg); }
details { border: 1px solid var(--line); border-radius: 8px; margin: 8px 0; background: var(--card); }
summary { cursor: pointer; padding: 10px 12px; display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; list-style: none; }
summary::-webkit-details-marker { display: none; }
summary::before { content: '▸'; color: var(--muted); width: 10px; } details[open] > summary::before { content: '▾'; }
summary .subject { font-weight: 600; overflow-wrap: anywhere; }
ul.findings { margin: 0; padding: 0 12px 10px 12px; list-style: none; }
ul.findings li { padding: 6px 0; border-top: 1px solid var(--line); display: grid; grid-template-columns: 64px 1fr; gap: 8px; align-items: start; }
ul.findings li.plain { grid-template-columns: 1fr; }
.where { color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
.ack { color: var(--muted); font-size: 13px; }
table.grid { border-collapse: collapse; } .grid th, .grid td { border: 1px solid var(--line); padding: 4px 12px; text-align: right; }
.grid th:first-child, .grid td:first-child { text-align: left; }
.counts { margin-top: 28px; padding-top: 12px; border-top: 1px solid var(--line); font-weight: 600; }
`;

function page(title: string, body: string): string {
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(title)}</title>\n<style>${CSS}</style>\n</head>\n<body>\n<main>\n${body}\n</main>\n</body>\n</html>\n`;
}

const sev = (s: Severity): string => `<span class="sev ${s}">${s}</span>`;

function header(r: Result, title: string): string {
  const side = (s: Result['compared']['base']): string => {
    const bits = [`<code>${esc(s.file)}</code>`];
    if (s.commit) bits.push(`<span class="mono">@ ${esc(s.commit.slice(0, 7))}</span>`);
    bits.push(`version ${esc(s.version)}${s.versionSource && s.versionSource !== 'info.version' ? ` <span class="muted">(${esc(s.versionSource)})</span>` : ''}`);
    for (const [k, v] of Object.entries(s.labels ?? {})) if (k !== 'commit') bits.push(`${esc(k)} ${esc(v)}`);
    if (s.openapi) bits.push(`<span class="muted">OpenAPI ${esc(s.openapi)}</span>`);
    return bits.join(' · ');
  };
  const advice = adviceLine(r);
  const policy = r.policy ? ` · policy <code>${esc(r.policy.file)}</code> <span class="mono">${esc(r.policy.sha256.slice(0, 7))}</span>` : '';
  return `<h1>${esc(title)}</h1>
<div class="muted">api-diff ${esc(r.tool.version)} · profile ${esc(r.profile)}${policy}</div>
<table class="meta">
<tr><td>base</td><td>${side(r.compared.base)}</td></tr>
<tr><td>revision</td><td>${side(r.compared.revision)}</td></tr>
${advice ? `<tr><td>advice</td><td>${esc(advice)}</td></tr>` : ''}
</table>`;
}

function findingItem(f: Finding, withSubject = false, label = true): string {
  const loc = where(f.revision ?? f.base);
  const ack = f.acknowledged ? `<div class="ack">acknowledged until ${esc(f.acknowledged.expires)}${f.acknowledged.owner ? ` by ${esc(f.acknowledged.owner)}` : ''}: ${esc(f.acknowledged.reason)}</div>` : '';
  return `<li${label ? '' : ' class="plain"'}>${label ? sev(f.severity) : ''}<div>${withSubject ? `<strong>${esc(f.subject)}</strong> ` : ''}${esc(f.message)}<div class="where">${loc ? `${esc(loc)} · ` : ''}<code>${esc(f.rule)}</code> · id <code>${esc(f.id)}</code></div>${ack}</div></li>`;
}

function groupBlock(g: Group): string {
  const ops = g.operations.length ? `<span class="muted">affects ${g.operations.length} operation${g.operations.length === 1 ? '' : 's'}: ${esc(g.operations.join(', '))}</span>` : '';
  return `<details${g.severity === 'info' ? '' : ' open'}><summary>${sev(g.severity)}<span class="subject">${esc(g.subject)}</span>${ops}</summary>
<ul class="findings">${g.findings.map((f) => findingItem(f, false, g.findings.some((x) => x.severity !== g.severity))).join('\n')}</ul></details>`;
}

function countsLine(r: Result): string {
  const n = r.counts;
  return `<div class="counts">${n.total} finding${n.total === 1 ? '' : 's'}: ${n.bySeverity.error} error, ${n.bySeverity.warn} warn, ${n.bySeverity.info} info${n.acknowledged ? ` (${n.acknowledged} acknowledged)` : ''} · state: ${esc(r.state)}</div>`;
}

export function renderReviewHtml(r: Result): string {
  const parts = [header(r, 'API changes')];
  if (r.findings.length === 0) return page('api-diff review', `${parts[0]}\n<p>No changes found.</p>`);
  const notices = r.findings.filter(isNotice);
  const problems = notices.filter((f) => f.severity !== 'info');
  if (problems.length) parts.push(`<h2>Problems with the inputs</h2><ul class="findings">${problems.map((f) => findingItem(f, true)).join('\n')}</ul>`);
  const versions = r.findings.filter(isVersion);
  if (versions.length) parts.push(`<h2>Version</h2><ul class="findings">${versions.map((f) => findingItem(f)).join('\n')}</ul>`);
  const groups = groupFindings(r.findings);
  if (groups.length) {
    const breaking = groups.filter((g) => g.severity === 'error').length;
    parts.push(`<h2>Changes <span class="muted">(${groups.length} place${groups.length === 1 ? '' : 's'}${breaking ? `, ${breaking} with breaking changes` : ''})</span></h2>`, ...groups.map(groupBlock));
  }
  const docs = docsSummary(r.findings);
  if (docs.length) {
    const rows = docs.map((d) => `<tr><td><code>${esc(d.rule)}</code></td><td>${d.count}</td><td style="text-align:left">${esc(d.subjects.join(', '))}</td></tr>`).join('\n');
    parts.push(`<h2>Documentation changes <span class="muted">(${docs.reduce((n, d) => n + d.count, 0)})</span></h2><details><summary>Show</summary><table class="grid"><tr><th>Rule</th><th>Count</th><th style="text-align:left">Where</th></tr>${rows}</table></details>`);
  }
  const notes = notices.filter((f) => f.severity === 'info');
  if (notes.length) parts.push(`<h2>Notes</h2><ul class="findings">${notes.map((f) => findingItem(f, true)).join('\n')}</ul>`);
  parts.push(countsLine(r));
  return page('api-diff review', parts.join('\n'));
}

export function renderSummaryHtml(r: Result): string {
  const d = summaryData(r);
  const rows = (['wire', 'sdk', 'docs'] as const).map((k) => `<tr><td>${k}</td><td>${d.byKindAndSeverity[k].error}</td><td>${d.byKindAndSeverity[k].warn}</td><td>${d.byKindAndSeverity[k].info}</td></tr>`).join('\n');
  const advice = adviceLine(r) ?? (r.advice ? 'no bump needed' : 'not checked (versions are not semver)');
  const top = r.findings.filter(isChange).slice(0, d.top.length);
  const body = [
    header(r, 'API change summary'),
    `<h2>Size and risk</h2><p>${d.places.total} place${d.places.total === 1 ? '' : 's'} changed, ${d.places.breaking} with breaking changes; ${d.operationsAffected} operation${d.operationsAffected === 1 ? '' : 's'} affected.</p>`,
    `<table class="grid"><tr><th>Kind</th><th>error</th><th>warn</th><th>info</th></tr>${rows}</table>`,
    `<h2>Version</h2><p>${esc(advice)}</p>`,
    top.length ? `<h2>Most serious</h2><ul class="findings">${top.map((f) => findingItem(f, true)).join('\n')}</ul>` : '',
    countsLine(r),
  ];
  return page('api-diff summary', body.join('\n'));
}

const KIND_LABEL: Record<ChangelogEntry['kind'], string> = { added: 'Added', changed: 'Changed', deprecated: 'Deprecated', removed: 'Removed' };

function changelogEntry(e: ChangelogEntry): string {
  const tag = e.breaking ? '<span class="sev error">breaking</span>' : `<span class="sev info">${KIND_LABEL[e.kind].toLowerCase()}</span>`;
  return `<li>${tag}<div><strong>${KIND_LABEL[e.kind]}:</strong> ${esc(e.text)}${e.note ? `<div>${inlineCode(e.note)}</div>` : ''}</div></li>`;
}

/** Escapes, then turns `code` spans into <code>. */
const inlineCode = (s: string): string => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

export function renderChangelogHtml(r: Result, opts: { docs?: boolean } = {}): string {
  const d = changelogData(r, opts);
  const title = `${d.title ?? 'API'} ${d.from} → ${d.to}`;
  const parts = [`<h1>${esc(title)}</h1>`];
  if (!d.tags.length && !d.components.length) return page(`${title}: changelog`, `${parts[0]}\n<p>No changes for API clients.</p>`);
  parts.push(`<p>${d.breaking ? `<strong>${d.breaking} breaking change${d.breaking === 1 ? '' : 's'}.</strong> Clients may need updating; each change below says what to do.` : 'No breaking changes.'}</p>`);
  for (const t of d.tags) {
    parts.push(`<h2>${esc(t.tag)}</h2>`);
    for (const op of t.operations) {
      const head = op.operation === 'API-wide' ? '' : `<summary><span class="subject"><code>${esc(op.operation)}</code></span>${op.summary ? `<span class="muted">${esc(op.summary)}</span>` : ''}</summary>`;
      parts.push(op.operation === 'API-wide' ? `<ul class="findings">${op.entries.map(changelogEntry).join('\n')}</ul>` : `<details open>${head}<ul class="findings">${op.entries.map(changelogEntry).join('\n')}</ul></details>`);
    }
  }
  if (d.components.length) {
    parts.push('<h2>Shared types</h2>');
    for (const c of d.components) {
      const used = c.operations.length ? `<span class="muted">used by ${esc(c.operations.join(', '))}</span>` : '';
      parts.push(`<details open><summary><span class="subject"><code>${esc(c.component)}</code></span>${used}</summary><ul class="findings">${c.entries.map(changelogEntry).join('\n')}</ul></details>`);
    }
  }
  return page(`${title}: changelog`, parts.join('\n'));
}

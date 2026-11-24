// HTML for the review and summary reports: one self-contained file (inline
// CSS, no scripts, no network), so it works as a CI artifact or opened
// locally. Dark by default, with a light theme switch that needs no script
// (theme.ts).

import type { Finding, Result, Severity } from '../types.ts';
import { ackText, adviceLine, asciiHtml, directionOf, isChange, isNotice, isVersion, mergeDirections, ruleWithoutDirection, usesLine, where, type Entry } from './common.ts';
import { docsSummary, GROUP_NOUN, groupFindings, ownersText, type Group, type GroupBy } from './review.ts';
import { summaryData } from './summary.ts';
import { auditData, type AuditOptions } from './audit.ts';
import { changelogData, usesHeadline, type ChangelogEntry } from './changelog.ts';
import { CHEVRON, THEME_CSS, THEME_INPUT, topbar } from './theme.ts';

const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

const CSS = `${THEME_CSS}
main { max-width:1080px; margin:0 auto; padding:8px 20px 56px; }
h1 { font-size:26px; line-height:1.25; letter-spacing:-.02em; margin:0; font-weight:700; }
h2 { font-size:16px; letter-spacing:-.01em; margin:0 0 12px; font-weight:650; } h2 .muted { font-weight:450; }
.hero { padding:28px 0 4px; } .hero-top { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.sub { margin-top:6px; font-size:13px; } .sub code { font-size:12px; }
.state { display:inline-flex; align-items:center; gap:6px; height:24px; padding:0 10px; border-radius:999px; font-size:12px; font-weight:600; color:var(--muted); background:var(--surface-2); box-shadow:inset 0 0 0 1px var(--border); }
.state.breaking { color:var(--error); background:var(--error-bg); box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--error) 30%, transparent); }
.state.compatible { color:var(--ok); background:var(--ok-bg); box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--ok) 30%, transparent); }
.compare { display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); gap:10px; align-items:center; margin:20px 0 0; }
.side-card { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:12px 14px; min-width:0; }
.side-card .k { font-size:11px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); margin-bottom:4px; }
.side-card .v { overflow-wrap:anywhere; font-size:13.5px; }
.arrow { color:var(--muted); }
.callout { display:flex; gap:10px; align-items:flex-start; margin:12px 0 0; padding:10px 14px; border-radius:10px; border:1px solid var(--border); background:var(--surface); font-size:13.5px; }
.callout .k { font-weight:600; flex:none; } .callout.warn { border-color:color-mix(in srgb, var(--warn) 35%, transparent); background:var(--warn-bg); } .callout.warn .k { color:var(--warn); }
.callout.error { border-color:color-mix(in srgb, var(--error) 35%, transparent); background:var(--error-bg); } .callout.error .k { color:var(--error); }
.callout.info .k { color:var(--info); } .callout.ok { border-color:color-mix(in srgb, var(--ok) 35%, transparent); background:var(--ok-bg); } .callout.ok .k { color:var(--ok); }
.stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:10px; margin:16px 0 0; }
.stat { --c:var(--border-strong); position:relative; overflow:hidden; background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:12px 16px; }
.stat::before { content:""; position:absolute; left:0; top:0; bottom:0; width:3px; background:var(--c); }
.stat .n { font-size:24px; font-weight:700; letter-spacing:-.02em; font-variant-numeric:tabular-nums; line-height:1.2; }
.stat .l { font-size:11px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
.stat.error { --c:var(--error); } .stat.warn { --c:var(--warn); } .stat.info { --c:var(--info); } .stat.ok { --c:var(--ok); }
.stat.error .n { color:var(--error); } .stat.warn .n { color:var(--warn); } .stat.info .n { color:var(--info); } .stat.zero .n { color:var(--muted); } .stat.zero::before { background:var(--border-strong); }
nav.toc { display:flex; gap:6px; flex-wrap:wrap; margin:24px 0 0; padding:6px; background:var(--surface); border:1px solid var(--border); border-radius:12px; }
nav.toc a { display:inline-flex; align-items:center; gap:8px; padding:5px 10px; border-radius:8px; color:var(--fg-2); font-size:13px; }
nav.toc a:hover { background:var(--surface-2); color:var(--fg); text-decoration:none; }
nav.toc .n { font-size:11.5px; color:var(--muted); background:var(--surface-2); border-radius:999px; padding:0 7px; font-variant-numeric:tabular-nums; }
section.sec { margin-top:32px; scroll-margin-top:16px; }
details.card, .panel { background:var(--surface); border:1px solid var(--border); border-radius:12px; margin:10px 0; box-shadow:var(--shadow); overflow:hidden; }
details.card { border-left:3px solid var(--sevc, var(--border-strong)); }
details.card.error { --sevc:var(--error); } details.card.warn { --sevc:var(--warn); } details.card.info { --sevc:var(--info); }
details.card > summary { display:flex; flex-wrap:wrap; align-items:center; gap:6px 12px; padding:12px 16px; }
details.card > summary:hover { background:var(--surface-2); }
details.card > summary:focus-visible { outline-offset:-2px; }
summary .subject { font-weight:600; overflow-wrap:anywhere; }
summary .aside { flex-basis:100%; padding-left:28px; font-size:12.5px; overflow-wrap:anywhere; }
ul.findings { margin:0; padding:0; list-style:none; }
details.card > ul.findings { border-top:1px solid var(--border); }
ul.findings li { padding:12px 16px; display:grid; grid-template-columns:72px minmax(0,1fr); gap:12px; align-items:start; overflow-wrap:anywhere; }
ul.findings li + li { border-top:1px solid var(--border); }
ul.findings li.plain { grid-template-columns:minmax(0,1fr); }
ul.findings li > .sev { margin-top:1px; min-width:0; width:72px; }
ul.findings.cl li { grid-template-columns:108px minmax(0,1fr); } ul.findings.cl li > .sev { width:108px; }
.where { color:var(--muted); font-size:12.5px; margin-top:3px; overflow-wrap:anywhere; }
.g-ops { display:flex; gap:8px; align-items:baseline; padding:0 16px 12px 44px; font-size:13px; }
details.ops > summary { color:var(--accent); width:max-content; display:inline-flex; align-items:center; gap:4px; }
details.ops > summary::before { content:""; width:5px; height:5px; margin:0 3px 0 1px; border-right:1.5px solid currentColor; border-bottom:1.5px solid currentColor; transform:rotate(-45deg); transition:transform .15s ease; }
details.ops[open] > summary::before { transform:rotate(45deg); }
details.ops ul { margin:6px 0 0; padding:6px 10px; list-style:none; width:max-content; max-width:100%; max-height:16em; overflow:auto; border:1px solid var(--border); border-radius:8px; background:var(--bg-elev); }
details.ops li { white-space:nowrap; }
.where code { background:none; border:0; padding:0; color:var(--fg-2); }
.where .sev { min-width:0; height:18px; font-size:10px; padding:0 7px 0 6px; vertical-align:1px; }
.ack { margin-top:6px; padding:6px 10px; border-left:2px solid var(--ok); background:var(--ok-bg); border-radius:0 6px 6px 0; color:var(--fg-2); font-size:12.5px; }
.table-wrap { overflow-x:auto; background:var(--surface); border:1px solid var(--border); border-radius:12px; box-shadow:var(--shadow); margin:10px 0; }
details.card > .table-wrap { margin:0; border:0; border-top:1px solid var(--border); border-radius:0; box-shadow:none; }
table.grid { border-collapse:separate; border-spacing:0; width:100%; font-size:13.5px; }
.grid th, .grid td { padding:9px 14px; text-align:right; border-bottom:1px solid var(--border); vertical-align:top; font-variant-numeric:tabular-nums; }
.grid th { font-size:11px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); background:var(--surface-2); white-space:nowrap; }
.grid tr:last-child td { border-bottom:0; } .grid tr:hover td { background:var(--surface-2); }
.grid th:first-child, .grid td:first-child { text-align:left; }
.grid.text th, .grid.text td { text-align:left; } .nowrap { white-space:nowrap; }
.counts { margin-top:40px; padding:14px 0 0; border-top:1px solid var(--border); color:var(--muted); font-size:13px; font-weight:500; }
.lead { font-size:15px; color:var(--fg-2); margin:12px 0 0; }
@media (max-width:640px) {
  main { padding:4px 16px 40px; } h1 { font-size:22px; }
  .compare { grid-template-columns:minmax(0,1fr); } .arrow { justify-self:center; transform:rotate(90deg); }
  ul.findings li { grid-template-columns:minmax(0,1fr); gap:6px; } summary .aside { padding-left:0; } .g-ops { padding-left:16px; }
}
`;

function page(title: string, report: string, body: string): string {
  return asciiHtml(`<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(title)}</title>\n<style>${CSS}</style>\n</head>\n<body>\n${THEME_INPUT}\n${topbar(report)}\n<main>\n${body}\n</main>\n</body>\n</html>\n`);
}

const sev = (s: Severity): string => `<span class="sev ${s}">${s}</span>`;

const STATE_LABEL: Record<Result['state'], string> = { breaking: 'Breaking', compatible: 'Compatible', 'no-changes': 'No changes' };

/** Base and revision as two cards with an arrow between them. */
function compare(r: Result): string {
  const side = (name: string, s: Result['compared']['base']): string => {
    const bits = [`<code>${esc(s.file)}</code>${s.commit ? ` <span class="mono muted">@ ${esc(s.commit.slice(0, 7))}</span>` : ''}`];
    const more = [`version ${esc(s.version)}${s.versionSource && s.versionSource !== 'info.version' ? ` <span class="muted">(${esc(s.versionSource)})</span>` : ''}`];
    for (const [k, v] of Object.entries(s.labels ?? {})) if (k !== 'commit') more.push(`${esc(k)} ${esc(v)}`);
    if (s.openapi) more.push(`<span class="muted">OpenAPI ${esc(s.openapi)}</span>`);
    return `<div class="side-card"><div class="k">${name}</div><div class="v">${bits.join('')}</div><div class="v">${more.join(' · ')}</div></div>`;
  };
  const arrow = '<svg class="arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="to"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  return `<div class="compare">${side('base', r.compared.base)}${arrow}${side('revision', r.compared.revision)}</div>`;
}

/** Finding counts as tiles: total, then one per severity. */
function stats(r: Result): string {
  const n = r.counts;
  const tile = (cls: string, count: number, label: string): string => `<div class="stat ${cls}${count ? '' : ' zero'}"><div class="n">${count}</div><div class="l">${label}</div></div>`;
  return `<div class="stats"><div class="stat"><div class="n">${n.total}</div><div class="l">findings</div></div>${tile('error', n.bySeverity.error, 'error')}${tile('warn', n.bySeverity.warn, 'warn')}${tile('info', n.bySeverity.info, 'info')}${n.acknowledged ? tile('ok', n.acknowledged, 'acknowledged') : ''}</div>`;
}

function header(r: Result, title: string): string {
  const advice = adviceLine(r);
  const policy = r.policy ? ` · policy <code>${esc(r.policy.file)}</code> <span class="mono">${esc(r.policy.sha256.slice(0, 7))}</span>` : '';
  return `<div class="hero"><div class="hero-top"><h1>${esc(title)}</h1><span class="state ${r.state}">${STATE_LABEL[r.state]}</span></div>
<div class="sub muted">api-diff ${esc(r.tool.version)} · profile ${esc(r.profile)}${policy}</div></div>
${compare(r)}
${advice ? `<div class="callout ${r.advice?.ok === false ? 'warn' : 'info'}"><span class="k">Version advice</span><span>${esc(advice)}</span></div>` : ''}
${r.uses ? `<div class="callout info"><span class="k">Uses</span><span>${esc(usesLine(r)!)}</span></div>` : ''}
${stats(r)}`;
}

/** A section with an anchor, for the page's table of contents. */
interface Section { id: string; title: string; count?: number; html: string }

function sections(list: Section[]): string {
  const nav = list.length > 1 ? `<nav class="toc" aria-label="Sections">${list.map((x) => `<a href="#${x.id}">${esc(x.title)}${x.count === undefined ? '' : `<span class="n">${x.count}</span>`}</a>`).join('')}</nav>` : '';
  return nav + list.map((x) => `<section class="sec" id="${x.id}">${x.html}</section>`).join('\n');
}

function findingItem(f: Finding, withSubject = false, label = true): string {
  const loc = where(f.revision ?? f.base);
  const ack = f.acknowledged ? `<div class="ack">acknowledged until ${esc(f.acknowledged.expires)}${f.acknowledged.owner ? ` by ${esc(f.acknowledged.owner)}` : ''}: ${esc(f.acknowledged.reason)}</div>` : '';
  return `<li${label ? '' : ' class="plain"'}>${label ? sev(f.severity) : ''}<div>${withSubject ? `<strong>${esc(f.subject)}</strong> ` : ''}${esc(f.message)}<div class="where">${loc ? `${esc(loc)} · ` : ''}<code>${esc(f.rule)}</code> · id <code>${esc(f.id)}</code></div>${ack}</div></li>`;
}

/** A merged entry (request and response findings of one change): worst severity, the rule without direction, and each direction's severity and ID. */
function entryItem(e: Entry, withSubject: boolean, label: boolean): string {
  if (e.parts.length === 1) return findingItem(e.finding, withSubject, label);
  const f = e.finding;
  const loc = where(f.revision ?? f.base);
  const dirs = e.parts.map((p) => `${esc(directionOf(p)!)} ${sev(p.severity)} id <code>${esc(p.id)}</code>`).join(' · ');
  const acks = e.parts.filter((p) => p.acknowledged).map((p) => `<div class="ack">${esc(ackText(p, `${directionOf(p)}: `))}</div>`).join('');
  return `<li${label ? '' : ' class="plain"'}>${label ? sev(f.severity) : ''}<div>${withSubject ? `<strong>${esc(f.subject)}</strong> ` : ''}${esc(f.message)}<div class="where">${loc ? `${esc(loc)} · ` : ''}<code>${esc(ruleWithoutDirection(f.rule))}</code></div><div class="where">${dirs}</div>${acks}</div></li>`;
}

/** How many operations a card lists in its header before folding them (as in explore). */
const OPS_INLINE = 3;

/**
 * A card's list of operations (`affects …`, `used by …`): up to OPS_INLINE in the header; more give
 * only the count there, and a folded list, one per line, at the top of the card (a fold can't sit inside a <summary>).
 */
function opsFold(verb: string, ops: string[]): { aside: string; list: string } {
  if (!ops.length) return { aside: '', list: '' };
  const noun = `${ops.length} operation${ops.length === 1 ? '' : 's'}`;
  if (ops.length <= OPS_INLINE) return { aside: `<span class="aside muted">${verb} ${noun}: ${esc(ops.join(', '))}</span>`, list: '' };
  return {
    aside: `<span class="aside muted">${verb} ${noun}</span>`,
    list: `<div class="g-ops"><span class="muted">${verb}</span><details class="ops"><summary>${noun}</summary><ul class="mono">${ops.map((o) => `<li>${esc(o)}</li>`).join('')}</ul></details></div>`,
  };
}

function groupBlock(g: Group, by: GroupBy = 'root-cause'): string {
  const { aside: ops, list: opsList } = opsFold('affects', by === 'operation' ? [] : g.operations);
  const owners = ownersText(g, by) ? `<span class="aside muted">${esc(ownersText(g, by))}</span>` : '';
  const entries = mergeDirections(g.findings);
  return `<details class="card ${g.severity}"${g.severity === 'info' ? '' : ' open'}><summary>${CHEVRON}${sev(g.severity)}<span class="subject">${esc(g.subject)}</span>${ops}${owners}</summary>${opsList}
<ul class="findings">${entries.map((e) => entryItem(e, by !== 'root-cause', entries.some((x) => x.finding.severity !== g.severity))).join('\n')}</ul></details>`;
}

const panel = (items: string): string => `<ul class="findings panel">${items}</ul>`;

function countsLine(r: Result): string {
  const n = r.counts;
  return `<footer class="counts">${n.total} finding${n.total === 1 ? '' : 's'}: ${n.bySeverity.error} error, ${n.bySeverity.warn} warn, ${n.bySeverity.info} info${n.acknowledged ? ` (${n.acknowledged} acknowledged)` : ''} · state: ${esc(r.state)}</footer>`;
}

const table = (head: string[], rows: string[][], cls = 'grid'): string => `<div class="table-wrap"><table class="${cls}"><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('\n')}</table></div>`;

export function renderReviewHtml(r: Result, by: GroupBy = 'root-cause'): string {
  const head = header(r, 'API changes');
  if (r.findings.length === 0) return page('api-diff review', 'review', `${head}\n<div class="callout ok"><span class="k">All clear</span><span>No changes found.</span></div>`);
  const list: Section[] = [];
  const notices = r.findings.filter(isNotice);
  const problems = notices.filter((f) => f.severity !== 'info');
  if (problems.length) list.push({ id: 'problems', title: 'Problems with the inputs', count: problems.length, html: `<h2>Problems with the inputs</h2>${panel(problems.map((f) => findingItem(f, true)).join('\n'))}` });
  const versions = r.findings.filter(isVersion);
  if (versions.length) list.push({ id: 'version', title: 'Version', count: versions.length, html: `<h2>Version</h2>${panel(versions.map((f) => findingItem(f)).join('\n'))}` });
  const groups = groupFindings(r.findings, by, r.operations);
  if (groups.length) {
    const breaking = groups.filter((g) => g.severity === 'error').length;
    const noun = GROUP_NOUN[by];
    list.push({ id: 'changes', title: 'Changes', count: groups.length, html: [`<h2>Changes <span class="muted">(${groups.length} ${noun}${groups.length === 1 ? '' : 's'}${breaking ? `, ${breaking} with breaking changes` : ''})</span></h2>`, ...groups.map((g) => groupBlock(g, by))].join('\n') });
  }
  const docs = docsSummary(r.findings);
  if (docs.length) {
    const total = docs.reduce((n, d) => n + d.count, 0);
    const rows = docs.map((d) => `<tr><td><code>${esc(d.rule)}</code></td><td>${d.count}</td><td style="text-align:left">${esc(d.subjects.join(', '))}</td></tr>`).join('\n');
    list.push({ id: 'docs', title: 'Documentation', count: total, html: `<h2>Documentation changes <span class="muted">(${total})</span></h2><details class="card"><summary>${CHEVRON}<span>Show ${total} documentation change${total === 1 ? '' : 's'}</span></summary><div class="table-wrap"><table class="grid"><tr><th>Rule</th><th>Count</th><th style="text-align:left">Where</th></tr>${rows}</table></div></details>` });
  }
  const notes = notices.filter((f) => f.severity === 'info');
  if (notes.length) list.push({ id: 'notes', title: 'Notes', count: notes.length, html: `<h2>Notes</h2>${panel(notes.map((f) => findingItem(f, true)).join('\n'))}` });
  return page('api-diff review', 'review', [head, sections(list), countsLine(r)].join('\n'));
}

export function renderSummaryHtml(r: Result): string {
  const d = summaryData(r);
  const rows = (['wire', 'sdk', 'docs'] as const).map((k) => [k, String(d.byKindAndSeverity[k].error), String(d.byKindAndSeverity[k].warn), String(d.byKindAndSeverity[k].info)]);
  const advice = adviceLine(r) ?? (r.advice ? 'no bump needed' : 'not checked (versions are not semver)');
  const top = r.findings.filter(isChange).slice(0, d.top.length);
  const list: Section[] = [
    { id: 'size', title: 'Size and risk', html: `<h2>Size and risk</h2><p>${d.places.total} place${d.places.total === 1 ? '' : 's'} changed, ${d.places.breaking} with breaking changes; ${d.operationsAffected} operation${d.operationsAffected === 1 ? '' : 's'} affected.</p>${table(['Kind', 'error', 'warn', 'info'], rows)}` },
    { id: 'version', title: 'Version', html: `<h2>Version</h2><p>${esc(advice)}</p>` },
  ];
  if (top.length) list.push({ id: 'top', title: 'Most serious', count: top.length, html: `<h2>Most serious</h2>${panel(top.map((f) => findingItem(f, true)).join('\n'))}` });
  return page('api-diff summary', 'summary', [header(r, 'API change summary'), sections(list), countsLine(r)].join('\n'));
}

const KIND_LABEL: Record<ChangelogEntry['kind'], string> = { added: 'Added', changed: 'Changed', deprecated: 'Deprecated', removed: 'Removed' };
const KIND_CLASS: Record<ChangelogEntry['kind'], string> = { added: 'ok', changed: 'info', deprecated: 'warn', removed: 'warn' };

function changelogEntry(e: ChangelogEntry): string {
  const tag = e.breaking ? '<span class="sev error">breaking</span>' : `<span class="sev ${KIND_CLASS[e.kind]}">${KIND_LABEL[e.kind].toLowerCase()}</span>`;
  return `<li>${tag}<div><strong>${KIND_LABEL[e.kind]}:</strong> ${esc(e.text)}${e.note ? `<div class="where">${inlineCode(e.note)}</div>` : ''}</div></li>`;
}

/** Escapes, then turns `code` spans into <code>. */
const inlineCode = (s: string): string => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

export function renderChangelogHtml(r: Result, opts: { docs?: boolean } = {}): string {
  const d = changelogData(r, opts);
  const title = `${d.title ?? 'API'} ${d.from} → ${d.to}`;
  const hero = [`<div class="hero"><div class="hero-top"><h1>${esc(title)}</h1></div><div class="sub muted">Changelog for API clients</div></div>`];
  if (d.uses) hero.push(`<div class="callout info"><span class="k">Uses</span><span>${esc(usesHeadline(d.uses))}</span></div>`);
  if (!d.tags.length && !d.components.length) return page(`${title}: changelog`, 'changelog', `${hero.join('\n')}\n<div class="callout ok"><span class="k">All clear</span><span>No changes for API clients.</span></div>`);
  hero.push(d.breaking
    ? `<div class="callout error"><span class="k">${d.breaking} breaking change${d.breaking === 1 ? '' : 's'}</span><span>Clients may need updating; each change below says what to do.</span></div>`
    : '<div class="callout ok"><span class="k">Compatible</span><span>No breaking changes.</span></div>');
  const list: Section[] = [];
  d.tags.forEach((t, i) => {
    const html = [`<h2>${esc(t.tag)}</h2>`];
    for (const op of t.operations) {
      const worst = op.entries.some((e) => e.breaking) ? ' error' : '';
      const head = `<summary>${CHEVRON}<span class="subject"><code>${esc(op.operation)}</code></span>${op.summary ? `<span class="muted">${esc(op.summary)}</span>` : ''}</summary>`;
      html.push(op.operation === 'API-wide' ? `<ul class="findings panel cl">${op.entries.map(changelogEntry).join('\n')}</ul>` : `<details class="card${worst}" open>${head}<ul class="findings cl">${op.entries.map(changelogEntry).join('\n')}</ul></details>`);
    }
    list.push({ id: `tag-${i}`, title: t.tag, count: t.operations.reduce((n, op) => n + op.entries.length, 0), html: html.join('\n') });
  });
  if (d.components.length) {
    const html = ['<h2>Shared types</h2>'];
    for (const c of d.components) {
      const worst = c.entries.some((e) => e.breaking) ? ' error' : '';
      const used = opsFold('used by', c.operations);
      html.push(`<details class="card${worst}" open><summary>${CHEVRON}<span class="subject"><code>${esc(c.component)}</code></span>${used.aside}</summary>${used.list}<ul class="findings cl">${c.entries.map(changelogEntry).join('\n')}</ul></details>`);
    }
    list.push({ id: 'shared-types', title: 'Shared types', count: d.components.reduce((n, c) => n + c.entries.length, 0), html: html.join('\n') });
  }
  return page(`${title}: changelog`, 'changelog', [...hero, sections(list)].join('\n'));
}

/** The audit report: everything, with acknowledgements, severity sources, exclusion sets and owners. */
export function renderAuditHtml(r: Result, opts: AuditOptions = {}): string {
  const d = auditData(r, opts);
  const byId = new Map(r.findings.map((f) => [f.id, f]));
  const list: Section[] = [];
  const add = (id: string, title: string, html: string, count?: number): void => { list.push({ id, title, html, count }); };
  const a = d.acknowledgements;
  if (a.active.length) add('acknowledged', 'Acknowledged', `<h2>Acknowledged <span class="muted">(${a.active.length})</span></h2>${table(['Finding', 'Severity', 'Owner', 'Until', 'Reason'], a.active.map((x) => [`<strong>${esc(x.subject)}</strong> <code>${esc(x.rule)}</code> <code>${esc(x.finding)}</code>`, sev(x.severity), `<span class="nowrap">${esc(x.owner ?? '—')}</span>`, `<span class="nowrap">${esc(x.expires)}</span>`, esc(x.reason)]), 'grid text')}`, a.active.length);
  const problems = [...a.expired, ...a.notOwner, ...a.stale].map((id) => byId.get(id)!);
  if (problems.length) add('ack-problems', 'Acknowledgement problems', `<h2>Acknowledgement problems <span class="muted">(${problems.length})</span></h2>${panel(problems.map((f) => findingItem(f, true)).join('\n'))}`, problems.length);
  if (d.unclassified.length) add('unclassified', 'Not classified', `<h2>Not classified by any rule <span class="muted">(${d.unclassified.length})</span></h2>${panel(d.unclassified.map((id) => findingItem(byId.get(id)!, true)).join('\n'))}`, d.unclassified.length);
  if (d.severitySources.length) add('severity-sources', 'Severity sources', `<h2>Where severities came from</h2>${table(['Source', 'Findings'], d.severitySources.map((s) => [esc(s.source), String(s.count)]))}`);
  if (d.exclusions.length) add('exclusions', 'Exclusion sets', `<h2>Exclusion sets</h2>${table(['Set', 'Findings', 'Left out of'], d.exclusions.map((e) => [`<code>${esc(e.set)}</code>`, String(e.findings), esc(e.hiddenBy.join(', ') || 'no report')]))}`);
  if (d.notCompared.length) add('not-compared', 'Not compared', `<h2>Not compared</h2>${panel(d.notCompared.map((id) => findingItem(byId.get(id)!, false, false)).join('\n'))}`, d.notCompared.length);
  if (d.owners.length) add('owners', 'By owner', `<h2>By owner</h2>${table(['Owner', 'Findings', 'error', 'warn', 'info'], d.owners.map((o) => [esc(o.owner), String(o.findings), String(o.error), String(o.warn), String(o.info)]))}`);
  if (d.groups.length) {
    const html = [`<h2>Findings by ${esc(d.groupBy === 'root-cause' ? 'root cause' : d.groupBy)} <span class="muted">(${d.groups.length})</span></h2>`];
    for (const g of d.groups) {
      const items = g.findings.map((id) => {
        const f = byId.get(id)!;
        const meta = [`severity ← ${f.severitySource}`, f.owners?.length ? `owners ${f.owners.join(', ')}` : '', f.exclusions?.length ? `in ${f.exclusions.join(', ')}` : ''].filter(Boolean).join(' · ');
        return findingItem(f, true).replace(/<\/div><\/li>$/, `<div class="where">${esc(meta)}</div></div></li>`);
      });
      html.push(`<details class="card ${g.severity}"${g.severity === 'info' ? '' : ' open'}><summary>${CHEVRON}${sev(g.severity)}<span class="subject">${esc(g.key)}</span><span class="muted">×${g.count}</span></summary><ul class="findings">${items.join('\n')}</ul></details>`);
    }
    add('findings', 'Findings', html.join('\n'), d.groups.length);
  }
  return page('api-diff audit', 'audit', [header(r, 'API governance audit'), sections(list), countsLine(r)].join('\n'));
}

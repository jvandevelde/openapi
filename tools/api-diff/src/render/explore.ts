// The explore report (PLAN.md section 5): every finding in one interactive,
// self-contained HTML file (inline CSS and JS, no network), for anyone
// investigating a change. Filters by severity, kind, tag and path, a search
// box, and for each finding its details, client note, affected operations
// and the base and revision source side by side. A schema change's request
// and response findings share one row, with each direction's details inside.
// Rows are in sections as in the review report: input problems, version,
// changes (grouped by schema or operation, or a flat list: the 'group by'
// control, remembered in the browser), documentation changes (one group per
// rule) and notes.
// Findings inside recursive schemas are marked ↻.
//
// The page embeds the result as JSON (with `<` escaped, so it can't close the
// script tag) and renders it with a small script; everything spec-controlled
// is inserted as text, never as HTML.

import { clientNote } from '../rules/notes.ts';
import type { Finding, Result } from '../types.ts';
import { adviceLine, isNotice, isVersion, mergeDirections } from './common.ts';
import { explorerLink } from './config.ts';

const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** JSON that is safe inside <script>: no `<`, and no U+2028/2029 line breaks. */
export function scriptJson(v: unknown): string {
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  return JSON.stringify(v).replace(/</g, '\\u003c').split(LS).join('\\u2028').split(PS).join('\\u2029');
}

const CSS = `
:root { --bg:#fff; --fg:#1f2328; --muted:#59636e; --line:#d1d9e0; --card:#f6f8fa; --hl:#fff8c5;
  --error:#cf222e; --warn:#9a6700; --info:#0969da; --error-bg:#ffebe9; --warn-bg:#fff8c5; --info-bg:#ddf4ff; }
@media (prefers-color-scheme: dark) { :root { --bg:#0d1117; --fg:#e6edf3; --muted:#9198a1; --line:#3d444d; --card:#151b23; --hl:#3a2d0a;
  --error:#ff7b72; --warn:#d29922; --info:#58a6ff; --error-bg:#3c1618; --warn-bg:#3a2d0a; --info-bg:#0c2d4a; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
header { padding:16px; border-bottom:1px solid var(--line); }
h1 { font-size:20px; margin:0 0 4px; }
.muted { color:var(--muted); } code, pre, .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px; }
.meta { margin-top:6px; display:grid; grid-template-columns:auto 1fr; gap:2px 12px; }
.bar { position:sticky; top:0; z-index:1; background:var(--bg); border-bottom:1px solid var(--line); padding:10px 16px; display:flex; flex-wrap:wrap; gap:8px 16px; align-items:center; }
.bar label { white-space:nowrap; } .bar input[type=search] { min-width:200px; flex:1; padding:5px 8px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--fg); }
.bar select { padding:4px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--fg); max-width:180px; }
main { padding:8px 16px 48px; max-width:1400px; }
.count { color:var(--muted); margin:8px 0; }
.sev { justify-self:start; align-self:start; display:inline-block; min-width:48px; text-align:center; font-size:11.5px; font-weight:600; padding:1px 6px; border-radius:10px; }
.sev.error { color:var(--error); background:var(--error-bg); } .sev.warn { color:var(--warn); background:var(--warn-bg); } .sev.info { color:var(--info); background:var(--info-bg); }
details.f { border:1px solid var(--line); border-radius:8px; margin:6px 0; background:var(--card); }
details.f > summary { cursor:pointer; padding:8px 10px; display:grid; grid-template-columns:60px minmax(0,1fr); gap:8px; list-style:none; }
details.f > summary::-webkit-details-marker { display:none; }
.subj { font-weight:600; overflow-wrap:anywhere; } .msg { overflow-wrap:anywhere; }
.body { padding:0 10px 10px 78px; }
.body dl { display:grid; grid-template-columns:max-content 1fr; gap:2px 12px; margin:6px 0; } .body dt { color:var(--muted); } .body dd { margin:0; overflow-wrap:anywhere; }
.sec h2 { font-size:15px; margin:18px 0 6px; } .sec h2 .muted { font-weight:400; }
details.g { border:1px solid var(--line); border-radius:8px; margin:8px 0; }
details.g > summary { cursor:pointer; padding:8px 10px; display:grid; grid-template-columns:60px minmax(0,1fr); gap:8px; list-style:none; }
details.g > summary::-webkit-details-marker { display:none; }
details.g > .rows { padding:0 8px 4px; } .rows.in-place .subj { display:none; }
.dirs { color:var(--muted); font-size:12.5px; white-space:nowrap; }
.part { margin:8px 0 0; padding-top:6px; border-top:1px solid var(--line); } .part h4 { margin:0; font-size:13px; font-weight:600; } .part h4 .sev { margin-left:6px; }
.note { margin:6px 0; padding:6px 10px; border-left:3px solid var(--info); background:var(--bg); }
.sides { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px; }
.side { border:1px solid var(--line); border-radius:6px; overflow:auto; background:var(--bg); }
.side h4 { margin:0; padding:4px 8px; font-size:12px; font-weight:600; border-bottom:1px solid var(--line); color:var(--muted); }
pre { margin:0; padding:4px 0; } .ln { display:inline-block; width:44px; padding-right:8px; text-align:right; color:var(--muted); user-select:none; }
.hit { background:var(--hl); display:block; } .at { outline:2px solid var(--info); outline-offset:-2px; display:block; }
.side { max-height:70vh; } .side h4 { position:sticky; top:0; background:var(--bg); z-index:1; }
.crumbs { padding:4px 8px; font:12px ui-monospace, SFMono-Regular, Menlo, monospace; border-bottom:1px solid var(--line); overflow-wrap:anywhere; }
button.link { background:none; border:0; padding:0; font:inherit; color:var(--info); cursor:pointer; text-decoration:underline; text-decoration-color:color-mix(in srgb, currentColor 40%, transparent); }
.side h4 button.link { font-weight:400; } button.link.ref { margin-left:6px; }
@media (max-width:700px) { .sides { grid-template-columns:1fr; } .body { padding-left:10px; } details.f > summary, details.g > summary { grid-template-columns:1fr; } }
`;

const SCRIPT = `
const data = JSON.parse(document.getElementById('data').textContent);
const $ = (s) => document.querySelector(s);
const el = (tag, attrs, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); for (const k of kids) e.append(k); return e; };
const opsOf = (f) => (/^[A-Z]+ \\//.test(f.subject) ? [f.subject] : []).concat(f.impact || []);
const tagsOf = (f) => [...new Set(opsOf(f).flatMap((o) => (data.operations[o] || {}).tags || []))];
const tags = [...new Set(data.findings.flatMap(tagsOf))].sort();
for (const t of tags) $('#tag').append(el('option', { value: t }, t));
// One side of a finding: the lines around it, the path to it (each step jumps to its line), a
// toggle that shows all of the enclosing schema or operation, and a jump to a $ref's target.
function side(name, s) {
  const box = el('div', { class: 'side' });
  const head = el('h4', {}, name + (s ? ' · ' + s.file + ':' + s.line : ''));
  const pre = el('pre');
  box.append(head);
  if (!s) { pre.append(el('span', { class: 'muted' }, '  (not in this version)')); box.append(pre); return box; }
  const src = ((data.sourceLines || {})[name] || {});
  const rows = (lines, start, hit) => { pre.textContent = ''; const at = {}; lines.forEach((line, i) => { const n = start + i; const row = el('span', n === hit ? { class: 'hit' } : {}, el('span', { class: 'ln' }, String(n)), line + '\\n'); at[n] = row; pre.append(row); }); return at; };
  const block = (file, b) => { const f = src[file] || {}; const out = []; for (let n = b.start; n <= b.end; n++) out.push(f[n] === undefined ? '' : f[n]); return out; };
  const scope = s.scope && (s.scope.start < s.start || s.scope.end > s.start + s.lines.length - 1) ? s.scope : undefined;
  const unesc = (k) => k.replace(/~1/g, '/').replace(/~0/g, '~');
  const last = (p) => { const segs = p.split('/').slice(1).map(unesc); const op = /^(paths|webhooks)$/.test(segs[0]) && segs.length === 3; return op ? segs[2].toUpperCase() + ' ' + segs[1] : segs.length ? segs[segs.length - 1] : s.file; };
  let view = 'window', at = rows(s.lines, s.start, s.line), toggle, back;
  const show = (v) => {
    view = v;
    if (v === 'window') at = rows(s.lines, s.start, s.line);
    else if (v === 'scope') at = rows(block(s.file, scope), scope.start, s.line);
    else at = rows(block(s.ref.file, s.ref), s.ref.start, s.ref.line);
    if (toggle) toggle.hidden = v === 'ref';
    if (toggle) toggle.textContent = v === 'scope' ? 'show less' : 'show all of ' + last(scope.pointer) + ' (' + (scope.end - scope.start + 1) + ' lines)';
    if (back) back.textContent = v === 'ref' ? '← back' : '→ ' + s.ref.name;
    head.firstChild.textContent = name + ' · ' + (v === 'ref' ? s.ref.file + ':' + s.ref.line + ' (' + s.ref.name + ')' : s.file + ':' + s.line);
  };
  const jump = (n) => { const row = at[n]; if (!row) return; pre.querySelectorAll('.at').forEach((x) => x.classList.remove('at')); row.classList.add('at'); box.scrollTop += row.getBoundingClientRect().top - box.getBoundingClientRect().top - 70; };
  if (scope) { toggle = el('button', { type: 'button', class: 'link' }); toggle.addEventListener('click', () => { show(view === 'scope' ? 'window' : 'scope'); jump(s.line); }); head.append(' ', toggle); }
  if (s.path && s.path.length) {
    const crumbs = el('div', { class: 'crumbs' });
    s.path.forEach((p, i) => {
      if (i) crumbs.append(el('span', { class: 'muted' }, ' › '));
      const inWindow = p.line >= s.start && p.line < s.start + s.lines.length;
      const reachable = inWindow || (scope && p.line >= scope.start && p.line <= scope.end);
      if (!reachable) { crumbs.append(el('span', { title: 'line ' + p.line }, p.key)); return; }
      const b = el('button', { type: 'button', class: 'link', title: 'line ' + p.line }, p.key);
      b.addEventListener('click', () => { if (view === 'ref' || (!inWindow && view !== 'scope')) show(inWindow ? 'window' : 'scope'); jump(p.line); });
      crumbs.append(b);
    });
    if (s.ref) { back = el('button', { type: 'button', class: 'link ref' }); back.addEventListener('click', () => show(view === 'ref' ? 'window' : 'ref')); crumbs.append(' ', back); }
    box.append(crumbs);
  }
  box.append(pre);
  show('window');
  return box;
}
const RANK = { error: 0, warn: 1, info: 2 };
const worst = (fs) => fs.reduce((a, b) => (RANK[b.severity] < RANK[a.severity] ? b : a));
const dirOf = (f) => (/-in-request$/.test(f.rule) ? 'request' : /-in-response$/.test(f.rule) ? 'response' : '');
const noteEl = (note) => el('div', { class: 'note' }, ...note.split(String.fromCharCode(96)).map((part, i) => (i % 2 ? el('code', {}, part) : part)));
// The per-finding facts: rule (and kind), severity source, ID, affected operations, acknowledgement, exclusions, links.
function facts(dl, f, withKind) {
  const row = (k, v) => { if (v) dl.append(el('dt', {}, k), el('dd', {}, v)); };
  row('rule', f.rule); if (withKind) row('kind', f.kind); row('severity from', f.severitySource); row('finding id', f.id);
  row('affects', (f.impact || []).join(', '));
  if (f.acknowledged) row('acknowledged', 'until ' + f.acknowledged.expires + (f.acknowledged.owner ? ' by ' + f.acknowledged.owner : '') + ': ' + f.acknowledged.reason);
  if (f.exclusions) row('exclusion sets', f.exclusions.join(', '));
  if (f.links) {
    const dd = el('span');
    for (const side of ['base', 'revision']) if (f.links[side]) { if (dd.childNodes.length) dd.append(' · '); dd.append(el('a', { href: f.links[side], target: '_blank', rel: 'noopener' }, side)); }
    dl.append(el('dt', {}, 'spec explorer'), el('dd', {}, dd));
  }
}
// One row: a finding, or a schema change's request and response findings merged (worst severity on the badge).
function item(parts) {
  const f = worst(parts);
  const d = el('details', { class: 'f' });
  const badge = el('span', { class: 'sev ' + f.severity }, f.severity);
  const head = el('div', {}, el('span', { class: 'subj' }, f.subject), f.details.recursive ? ' ↻' : '', ' ', el('span', { class: 'msg' }, f.message));
  if (parts.length > 1) head.append(' ', el('span', { class: 'dirs' }, parts.map((p) => dirOf(p) + ' ' + p.severity).join(' · ')));
  d.append(el('summary', {}, badge, head));
  d.addEventListener('toggle', () => {
    if (!d.open || d.dataset.built) return;
    d.dataset.built = '1';
    const body = el('div', { class: 'body' });
    const notes = [...new Set(parts.map((p) => p.note).filter(Boolean))];
    if (notes.length === 1) body.append(noteEl(notes[0]));
    const dl = el('dl');
    if (parts.length === 1) facts(dl, f, true);
    else { dl.append(el('dt', {}, 'rule'), el('dd', {}, f.rule.replace(/-in-(request|response)$/, '')), el('dt', {}, 'kind'), el('dd', {}, f.kind)); }
    if (f.details.recursive) dl.append(el('dt', {}, 'recursive'), el('dd', {}, '↻ this schema refers to itself'));
    body.append(dl);
    if (parts.length > 1) for (const p of parts) {
      const part = el('div', { class: 'part' }, el('h4', {}, 'In ' + dirOf(p) + 's ', el('span', { class: 'sev ' + p.severity }, p.severity)));
      if (notes.length > 1 && p.note) part.append(noteEl(p.note));
      const pdl = el('dl'); facts(pdl, p, false); part.append(pdl); body.append(part);
    }
    const snip = parts.map((p) => (data.snippets || {})[p.id]).find((x) => x && (x.base || x.revision));
    if (snip) body.append(el('div', { class: 'sides' }, side('base', snip.base), side('revision', snip.revision)));
    d.append(body);
  });
  return { node: d, badge };
}
const items = data.rows.map((row) => {
  const parts = row.parts.map((n) => data.findings[n]);
  const { node, badge } = item(parts);
  const f = parts[0];
  return { node, badge, section: row.section, key: row.section === 'docs' ? f.rule : f.subject, parts: parts.map((f) => ({ f, text: (f.subject + ' ' + f.message + ' ' + f.rule + ' ' + (f.note || '')).toLowerCase(), tags: tagsOf(f), paths: opsOf(f).map((o) => o.split(' ')[1]) })) };
});
// Sections, as in the review report: input problems and version checks first, then changes
// (grouped by schema or operation, or a flat list), documentation changes (one group per rule), then notes.
const SECTIONS = [['problems', 'Problems with the inputs'], ['version', 'Version'], ['changes', 'Changes'], ['docs', 'Documentation changes'], ['notes', 'Notes']];
const sections = {};
for (const [id, title] of SECTIONS) {
  const count = el('span', { class: 'muted' });
  const box = el('section', { class: 'sec' }, el('h2', {}, title + ' ', count));
  const body = el('div');
  box.append(body);
  $('#list').append(box);
  sections[id] = { box, body, count, groups: new Map() };
}
// A group: a schema or operation (changes) or a rule (docs), with its rows inside. Worst first, then largest.
function groupsFor(section) {
  const by = new Map();
  for (const i of items) if (i.section === section) (by.get(i.key) || by.set(i.key, []).get(i.key)).push(i);
  return [...by].map(([key, rows]) => ({ key, rows, sev: worst(rows.flatMap((r) => r.parts.map((p) => p.f))).severity }))
    .sort((a, b) => RANK[a.sev] - RANK[b.sev] || b.rows.length - a.rows.length || a.key.localeCompare(b.key, undefined, { numeric: true }));
}
function groupNode(g, section) {
  const badge = el('span', { class: 'sev ' + g.sev }, g.sev);
  const count = el('span', { class: 'muted' });
  const ops = [...new Set(g.rows.flatMap((r) => r.parts.flatMap((p) => p.f.impact || [])))].sort();
  const head = el('div', {}, el('span', { class: 'subj' }, g.key), ' ', count);
  if (section === 'changes' && ops.length) head.append(el('span', { class: 'muted' }, ' · affects ' + ops.length + ' operation' + (ops.length === 1 ? '' : 's') + ': ' + ops.slice(0, 5).join(', ') + (ops.length > 5 ? ', …' : '')));
  const d = el('details', { class: 'g' }, el('summary', {}, badge, head));
  // Rows in a schema or operation group don't repeat its name.
  const inner = el('div', { class: section === 'changes' ? 'rows in-place' : 'rows' });
  d.append(inner);
  // Error and warn groups start open; info-only groups and documentation rules start closed.
  if (section === 'changes' && g.sev !== 'info') d.open = true;
  return { node: d, inner, badge, count, rows: g.rows };
}
const grouped = {};
for (const section of ['changes', 'docs']) grouped[section] = groupsFor(section).map((g) => groupNode(g, section));
let groupBy = 'place';
try { groupBy = localStorage.getItem('api-diff-explore-group-by') || 'place'; } catch (e) {}
$('#group').value = groupBy === 'none' ? 'none' : 'place';
// Puts every row in its place: in its group, or straight in its section (no grouping; docs always grouped).
function layout() {
  groupBy = $('#group').value;
  try { localStorage.setItem('api-diff-explore-group-by', groupBy); } catch (e) {}
  for (const [id] of SECTIONS) sections[id].body.textContent = '';
  for (const i of items) if (!(i.section === 'docs' || (i.section === 'changes' && groupBy === 'place'))) sections[i.section].body.append(i.node);
  for (const section of ['changes', 'docs']) {
    if (section === 'changes' && groupBy !== 'place') continue;
    for (const g of grouped[section]) { for (const r of g.rows) g.inner.append(r.node); sections[section].body.append(g.node); }
  }
}
$('#group').addEventListener('input', () => { layout(); apply(); });
layout();
// A row is shown while any of its findings matches; its badge shows the worst severity among those that match.
// A group is shown while any of its rows is, with the worst severity and number of its shown rows.
function apply() {
  const sev = new Set([...document.querySelectorAll('input[name=sev]:checked')].map((x) => x.value));
  const kind = new Set([...document.querySelectorAll('input[name=kind]:checked')].map((x) => x.value));
  const tag = $('#tag').value, path = $('#path').value.trim(), q = $('#q').value.trim().toLowerCase();
  let shown = 0, shownFindings = 0;
  for (const i of items) {
    const hits = i.parts.filter((p) => sev.has(p.f.severity) && kind.has(p.f.kind) && (!tag || p.tags.includes(tag)) && (!path || p.paths.some((x) => x && x.startsWith(path)) || p.f.subject.includes(path)) && (!q || p.text.includes(q)));
    i.node.hidden = hits.length === 0;
    if (hits.length) { shown++; shownFindings += hits.length; const w = worst(hits.map((h) => h.f)).severity; i.badge.className = 'sev ' + w; i.badge.textContent = w; }
  }
  const typing = !!(q || path);
  for (const section of ['changes', 'docs']) for (const g of grouped[section]) {
    const shownRows = g.rows.filter((r) => !r.node.hidden);
    g.node.hidden = shownRows.length === 0;
    if (shownRows.length) {
      const w = worst(shownRows.map((r) => r.badge.textContent).map((severity) => ({ severity }))).severity;
      g.badge.className = 'sev ' + w; g.badge.textContent = w;
      g.count.textContent = '×' + shownRows.length;
      if (typing) g.node.open = true; // show what a search or path filter found
    }
  }
  for (const [id] of SECTIONS) {
    const n = items.filter((i) => i.section === id && !i.node.hidden).length;
    sections[id].box.hidden = n === 0;
    sections[id].count.textContent = '(' + n + ')';
  }
  $('#count').textContent = items.length === data.findings.length ? shown + ' of ' + items.length + ' findings' : shown + ' of ' + items.length + ' changes (' + shownFindings + ' of ' + data.findings.length + ' findings)';
}
document.querySelectorAll('.bar input, .bar select:not(#group)').forEach((x) => x.addEventListener('input', apply));
apply();
`;

export function renderExplore(r: Result, explorerUrl?: string): string {
  const findings = r.findings.map((f) => {
    const note = clientNote(f);
    const links = { base: explorerLink(explorerUrl, 'base', f.base), revision: explorerLink(explorerUrl, 'revision', f.revision) };
    return { ...f, ...(note ? { note } : {}), ...(links.base || links.revision ? { links } : {}) };
  });
  // Rows: a schema change's request and response findings share one row. Each row's
  // section is where the page puts it: input problems, version checks, changes, docs or notes.
  const index = new Map(r.findings.map((f, i) => [f, i]));
  const sectionOf = (f: Finding): string => (isNotice(f) ? (f.severity === 'info' ? 'notes' : 'problems') : isVersion(f) ? 'version' : f.kind === 'docs' ? 'docs' : 'changes');
  const rows = mergeDirections(r.findings).map((e) => ({ parts: e.parts.map((f) => index.get(f)!), section: sectionOf(e.finding) }));
  const data = { findings, rows, operations: r.operations ?? {}, snippets: r.snippets ?? {}, sourceLines: r.sourceLines ?? {} };
  const side = (s: Result['compared']['base']): string => `<code>${esc(s.file)}</code>${s.commit ? ` <span class="mono">@ ${esc(s.commit.slice(0, 7))}</span>` : ''} · version ${esc(s.version)}`;
  const advice = adviceLine(r);
  const title = r.compared.revision.title ?? r.compared.base.title ?? 'API';
  const n = r.counts;
  const check = (name: string, value: string, label: string): string => `<label><input type="checkbox" name="${name}" value="${value}" checked> ${label}</label>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`${title}: explore changes`)}</title>
<style>${CSS}</style>
</head>
<body>
<header>
<h1>${esc(title)}: all changes</h1>
<div class="muted">api-diff ${esc(r.tool.version)} · profile ${esc(r.profile)} · ${n.total} findings: ${n.bySeverity.error} error, ${n.bySeverity.warn} warn, ${n.bySeverity.info} info · state ${esc(r.state)}</div>
<div class="meta"><span class="muted">base</span><span>${side(r.compared.base)}</span><span class="muted">revision</span><span>${side(r.compared.revision)}</span>${advice ? `<span class="muted">advice</span><span>${esc(advice)}</span>` : ''}</div>
</header>
<div class="bar">
<span>${check('sev', 'error', 'error')} ${check('sev', 'warn', 'warn')} ${check('sev', 'info', 'info')}</span>
<span>${check('kind', 'wire', 'wire')} ${check('kind', 'sdk', 'sdk')} ${check('kind', 'docs', 'docs')}</span>
<label>tag <select id="tag"><option value="">all</option></select></label>
<label>path <input id="path" type="search" placeholder="/pets" style="min-width:120px;flex:0"></label>
<input id="q" type="search" placeholder="Search findings, rules and notes" aria-label="Search">
<label>group by <select id="group"><option value="place">schema or operation</option><option value="none">none</option></select></label>
</div>
<main>
<div id="count" class="count"></div>
<div id="list"></div>
<noscript><p>This report needs JavaScript to show the findings. The JSON report has the same data.</p></noscript>
</main>
<script type="application/json" id="data">${scriptJson(data)}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

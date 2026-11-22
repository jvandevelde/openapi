// The explore report (PLAN.md section 5): every finding in one interactive,
// self-contained HTML file (inline CSS and JS, no network), for anyone
// investigating a change. Filters by severity, kind, tag and path, a search
// box, and for each finding its details, client note, affected operations
// and the base and revision source side by side. Findings inside recursive
// schemas are marked ↻.
//
// The page embeds the result as JSON (with `<` escaped, so it can't close the
// script tag) and renders it with a small script; everything spec-controlled
// is inserted as text, never as HTML.

import { clientNote } from '../rules/notes.ts';
import type { Result } from '../types.ts';
import { adviceLine } from './common.ts';
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
.note { margin:6px 0; padding:6px 10px; border-left:3px solid var(--info); background:var(--bg); }
.sides { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px; }
.side { border:1px solid var(--line); border-radius:6px; overflow:auto; background:var(--bg); }
.side h4 { margin:0; padding:4px 8px; font-size:12px; font-weight:600; border-bottom:1px solid var(--line); color:var(--muted); }
pre { margin:0; padding:4px 0; } .ln { display:inline-block; width:44px; padding-right:8px; text-align:right; color:var(--muted); user-select:none; }
.hit { background:var(--hl); display:block; }
@media (max-width:700px) { .sides { grid-template-columns:1fr; } .body { padding-left:10px; } details.f > summary { grid-template-columns:1fr; } }
`;

const SCRIPT = `
const data = JSON.parse(document.getElementById('data').textContent);
const $ = (s) => document.querySelector(s);
const el = (tag, attrs, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); for (const k of kids) e.append(k); return e; };
const opsOf = (f) => (/^[A-Z]+ \\//.test(f.subject) ? [f.subject] : []).concat(f.impact || []);
const tagsOf = (f) => [...new Set(opsOf(f).flatMap((o) => (data.operations[o] || {}).tags || []))];
const tags = [...new Set(data.findings.flatMap(tagsOf))].sort();
for (const t of tags) $('#tag').append(el('option', { value: t }, t));
function side(title, s) {
  const box = el('div', { class: 'side' }, el('h4', {}, title + (s ? ' · ' + s.file + ':' + s.line : '')));
  const pre = el('pre');
  if (!s) pre.append(el('span', { class: 'muted' }, '  (not in this version)'));
  else s.lines.forEach((line, i) => { const n = s.start + i; const row = el('span', n === s.line ? { class: 'hit' } : {}, el('span', { class: 'ln' }, String(n)), line + '\\n'); pre.append(row); });
  box.append(pre);
  return box;
}
function item(f) {
  const d = el('details', { class: 'f' });
  const sum = el('summary', {}, el('span', { class: 'sev ' + f.severity }, f.severity), el('div', {}, el('span', { class: 'subj' }, f.subject + (f.details.recursive ? ' ↻' : '')), ' ', el('span', { class: 'msg' }, f.message)));
  d.append(sum);
  d.addEventListener('toggle', () => {
    if (!d.open || d.dataset.built) return;
    d.dataset.built = '1';
    const body = el('div', { class: 'body' });
    if (f.note) body.append(el('div', { class: 'note' }, ...f.note.split(String.fromCharCode(96)).map((part, i) => (i % 2 ? el('code', {}, part) : part))));
    const dl = el('dl');
    const row = (k, v) => { if (v) dl.append(el('dt', {}, k), el('dd', {}, v)); };
    row('rule', f.rule); row('kind', f.kind); row('severity from', f.severitySource); row('finding id', f.id);
    row('affects', (f.impact || []).join(', '));
    if (f.details.recursive) row('recursive', '↻ this schema refers to itself');
    if (f.acknowledged) row('acknowledged', 'until ' + f.acknowledged.expires + (f.acknowledged.owner ? ' by ' + f.acknowledged.owner : '') + ': ' + f.acknowledged.reason);
    if (f.exclusions) row('exclusion sets', f.exclusions.join(', '));
    if (f.links) {
      const dd = el('span');
      for (const side of ['base', 'revision']) if (f.links[side]) { if (dd.childNodes.length) dd.append(' · '); dd.append(el('a', { href: f.links[side], target: '_blank', rel: 'noopener' }, side)); }
      dl.append(el('dt', {}, 'spec explorer'), el('dd', {}, dd));
    }
    body.append(dl);
    const s = (data.snippets || {})[f.id] || {};
    if (s.base || s.revision) body.append(el('div', { class: 'sides' }, side('base', s.base), side('revision', s.revision)));
    d.append(body);
  });
  return d;
}
const items = data.findings.map((f) => ({ f, node: item(f), text: (f.subject + ' ' + f.message + ' ' + f.rule + ' ' + (f.note || '')).toLowerCase(), tags: tagsOf(f), paths: opsOf(f).map((o) => o.split(' ')[1]) }));
const list = $('#list');
for (const i of items) list.append(i.node);
function apply() {
  const sev = new Set([...document.querySelectorAll('input[name=sev]:checked')].map((x) => x.value));
  const kind = new Set([...document.querySelectorAll('input[name=kind]:checked')].map((x) => x.value));
  const tag = $('#tag').value, path = $('#path').value.trim(), q = $('#q').value.trim().toLowerCase();
  let shown = 0;
  for (const i of items) {
    const ok = sev.has(i.f.severity) && kind.has(i.f.kind) && (!tag || i.tags.includes(tag)) && (!path || i.paths.some((p) => p && p.startsWith(path)) || i.f.subject.includes(path)) && (!q || i.text.includes(q));
    i.node.hidden = !ok; if (ok) shown++;
  }
  $('#count').textContent = shown + ' of ' + items.length + ' findings';
}
document.querySelectorAll('.bar input, .bar select').forEach((x) => x.addEventListener('input', apply));
apply();
`;

export function renderExplore(r: Result, explorerUrl?: string): string {
  const findings = r.findings.map((f) => {
    const note = clientNote(f);
    const links = { base: explorerLink(explorerUrl, 'base', f.base), revision: explorerLink(explorerUrl, 'revision', f.revision) };
    return { ...f, ...(note ? { note } : {}), ...(links.base || links.revision ? { links } : {}) };
  });
  const data = { findings, operations: r.operations ?? {}, snippets: r.snippets ?? {} };
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

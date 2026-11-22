// Output for `api-diff history`: the timeline report in text, JSON and HTML.
// See PLAN.md section 5, *Timeline (history mode)*.

import type { History, RevertLink } from '../history.ts';
import type { Finding, Result, Severity } from '../types.ts';
import { isChange, isVersion } from './common.ts';
import { scriptJson } from './explore.ts';

const RANK: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
const LABEL: Record<Severity, string> = { error: 'ERROR', warn: 'WARN ', info: 'INFO ' };
const counts = (fs: Finding[]): Record<Severity, number> => ({ error: fs.filter((f) => f.severity === 'error').length, warn: fs.filter((f) => f.severity === 'warn').length, info: fs.filter((f) => f.severity === 'info').length });
const countText = (c: Record<Severity, number>): string => `${c.error} error, ${c.warn} warn, ${c.info} info`;
const shown = (r: Result): Finding[] => r.findings.filter((f) => isChange(f) || isVersion(f));

/** Text for one finding's revert link, if any. */
function linkText(f: Finding, step: number, links: RevertLink[], h: History): string {
  const ref = (i: number): string => {
    const s = h.steps[i]!;
    return s.pr ? `#${s.pr}` : s.commit.slice(0, 7);
  };
  const undone = links.find((l) => l.finding === f.id && l.step === step);
  if (undone) return `  ↺ reverted in ${ref(undone.revertedIn)}`;
  const undoes = links.find((l) => l.revertedBy === f.id && l.revertedIn === step);
  if (undoes) return `  ↺ reverts ${ref(undoes.step)}`;
  return '';
}

export function renderTimeline(h: History): string {
  const out: string[] = [];
  const short = (c: string): string => c.slice(0, 7);
  out.push(`api-diff history  ${h.spec}  ${h.range.start.rev} (${short(h.range.start.commit)}) → ${h.range.end.rev} (${short(h.range.end.commit)})`);
  const net = counts(shown(h.net));
  out.push(`${h.steps.length} step${h.steps.length === 1 ? '' : 's'}${h.omitted ? ` (${h.omitted} earlier step${h.omitted === 1 ? '' : 's'} left out by --max-steps)` : ''} · net: ${countText(net)}`, '');
  if (!h.steps.length) out.push('The spec did not change in this range.', '');
  h.steps.forEach((s, i) => {
    const head = `${s.date}  ${short(s.commit)}  ${s.pr ? `#${s.pr} ` : ''}${s.pr ? s.subject.replace(/\s*\(#\d+\)\s*$/, '') : s.subject}`;
    const v = s.versions.base !== s.versions.revision ? `  ${s.versions.base} → ${s.versions.revision}` : '';
    out.push(`${head}${v}`);
    const fs = shown(s.result).sort((a, b) => RANK[a.severity] - RANK[b.severity]);
    const docs = fs.filter((f) => f.kind === 'docs');
    for (const f of fs.filter((x) => x.kind !== 'docs')) out.push(`            ${LABEL[f.severity]}  ${f.subject}  ${f.message}${linkText(f, i, h.links, h)}`);
    if (docs.length) out.push(`            INFO   ${docs.length} documentation change${docs.length === 1 ? '' : 's'}`);
    for (const t of s.tags) out.push(`── tag ${t} ${'─'.repeat(Math.max(3, 60 - t.length))}`);
  });
  const reverted = h.links.length;
  out.push('', `Net (${h.range.start.rev} → ${h.range.end.rev}): ${countText(net)}${reverted ? `   (${reverted} change${reverted === 1 ? '' : 's'} reverted within the range)` : ''}`, '');
  return out.join('\n');
}

/** JSON: steps with commit details and finding IDs, every finding once, links, and the net result. */
export function timelineData(h: History): unknown {
  const findings: Record<string, Finding> = {};
  const steps = h.steps.map((s) => {
    for (const f of s.result.findings) findings[f.id] = f;
    const { result, ...meta } = s;
    return { ...meta, counts: counts(shown(result)), state: result.state, findings: result.findings.map((f) => f.id) };
  });
  return { report: 'history', spec: h.spec, range: h.range, omitted: h.omitted, steps, findings, links: h.links, net: h.net };
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

const CSS = `
:root { --bg:#fff; --fg:#1f2328; --muted:#59636e; --line:#d1d9e0; --card:#f6f8fa; --error:#cf222e; --warn:#9a6700; --info:#0969da; --error-bg:#ffebe9; --warn-bg:#fff8c5; --info-bg:#ddf4ff; }
@media (prefers-color-scheme: dark) { :root { --bg:#0d1117; --fg:#e6edf3; --muted:#9198a1; --line:#3d444d; --card:#151b23; --error:#ff7b72; --warn:#d29922; --info:#58a6ff; --error-bg:#3c1618; --warn-bg:#3a2d0a; --info-bg:#0c2d4a; } }
* { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
header { padding:16px; border-bottom:1px solid var(--line); } h1 { font-size:20px; margin:0 0 4px; } h2 { font-size:16px; margin:20px 0 8px; }
.muted { color:var(--muted); } code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px; }
.strip { display:flex; align-items:flex-end; gap:6px; padding:16px; overflow-x:auto; border-bottom:1px solid var(--line); min-height:70px; }
.mark { border:0; border-radius:50%; cursor:pointer; flex:none; padding:0; }
.mark.error { background:var(--error); } .mark.warn { background:var(--warn); } .mark.info { background:var(--info); } .mark.none { background:var(--line); }
.mark[aria-pressed=true] { outline:3px solid var(--fg); outline-offset:2px; }
.tag { flex:none; align-self:stretch; border-left:2px dashed var(--muted); padding-left:4px; font-size:11px; color:var(--muted); writing-mode:vertical-rl; }
.bar { position:sticky; top:0; background:var(--bg); padding:10px 16px; border-bottom:1px solid var(--line); display:flex; gap:12px; flex-wrap:wrap; align-items:center; z-index:1; }
.bar input[type=search] { flex:1; min-width:180px; padding:5px 8px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--fg); }
main { padding:0 16px 48px; max-width:1200px; }
.step { border:1px solid var(--line); border-radius:8px; margin:10px 0; background:var(--card); }
.step > .head { padding:8px 12px; display:flex; gap:10px; flex-wrap:wrap; align-items:baseline; border-bottom:1px solid var(--line); }
.step ul { list-style:none; margin:0; padding:4px 12px 8px; } .step li { padding:4px 0; display:grid; grid-template-columns:56px 1fr; gap:8px; }
.sev { justify-self:start; align-self:start; display:inline-block; min-width:48px; text-align:center; font-size:11.5px; font-weight:600; padding:1px 6px; border-radius:10px; }
.sev.error { color:var(--error); background:var(--error-bg); } .sev.warn { color:var(--warn); background:var(--warn-bg); } .sev.info { color:var(--info); background:var(--info-bg); }
.revert { color:var(--muted); font-size:12.5px; }
`;

const SCRIPT = `
const data = JSON.parse(document.getElementById('data').textContent);
const $ = (s) => document.querySelector(s);
const el = (tag, attrs, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); for (const k of kids) e.append(k); return e; };
const rank = { error: 0, warn: 1, info: 2 };
const ref = (i) => { const s = data.steps[i]; return s.pr ? '#' + s.pr : s.commit.slice(0, 7); };
function linkFor(id, i) {
  const a = data.links.find((l) => l.finding === id && l.step === i); if (a) return '↺ reverted in ' + ref(a.revertedIn);
  const b = data.links.find((l) => l.revertedBy === id && l.revertedIn === i); if (b) return '↺ reverts ' + ref(b.step);
  return '';
}
function card(title, meta, ids, stepIndex) {
  const box = el('section', { class: 'step' }, el('div', { class: 'head' }, el('strong', {}, title), el('span', { class: 'muted' }, meta)));
  const ul = el('ul');
  for (const id of ids.slice().sort((a, b) => rank[data.findings[a].severity] - rank[data.findings[b].severity])) {
    const f = data.findings[id];
    const extra = stepIndex === undefined ? '' : linkFor(id, stepIndex);
    const li = el('li', { 'data-text': (f.subject + ' ' + f.message + ' ' + f.rule).toLowerCase() }, el('span', { class: 'sev ' + f.severity }, f.severity), el('div', {}, el('strong', {}, f.subject), ' ', f.message, extra ? el('div', { class: 'revert' }, extra) : ''));
    ul.append(li);
  }
  if (!ids.length) ul.append(el('li', {}, el('span'), el('span', { class: 'muted' }, 'No API changes (only notices or nothing).')));
  box.append(ul);
  return box;
}
for (const f of data.net.findings) data.findings[f.id] = f;
const strip = $('#strip');
data.steps.forEach((s, i) => {
  const worst = s.counts.error ? 'error' : s.counts.warn ? 'warn' : s.counts.info ? 'info' : 'none';
  const total = s.counts.error + s.counts.warn + s.counts.info;
  const size = Math.min(36, 10 + Math.round(Math.sqrt(total) * 6));
  const b = el('button', { class: 'mark ' + worst, title: s.date + ' ' + (s.pr ? '#' + s.pr + ' ' : '') + s.subject + ' · ' + s.counts.error + ' error, ' + s.counts.warn + ' warn, ' + s.counts.info + ' info', style: 'width:' + size + 'px;height:' + size + 'px', 'aria-pressed': 'false', 'data-step': String(i) });
  b.addEventListener('click', () => { const on = b.getAttribute('aria-pressed') !== 'true'; document.querySelectorAll('.mark').forEach((m) => m.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', String(on)); show(on ? i : undefined); });
  strip.append(b);
  for (const t of s.tags) strip.append(el('span', { class: 'tag' }, t));
});
function show(only) {
  const list = $('#list'); list.replaceChildren();
  if ($('#net').checked) list.append(card('Net: ' + data.range.start.rev + ' → ' + data.range.end.rev, data.net.counts.total + ' findings', data.net.findings.map((f) => f.id)));
  else data.steps.forEach((s, i) => { if (only === undefined || only === i) list.append(card(s.date + '  ' + s.commit.slice(0, 7) + '  ' + (s.pr ? '#' + s.pr + ' ' + s.subject.replace(/\\s*\\(#\\d+\\)\\s*$/, '') : s.subject), s.author + (s.versions.base !== s.versions.revision ? ' · ' + s.versions.base + ' → ' + s.versions.revision : '') + (s.tags.length ? ' · tag ' + s.tags.join(', ') : ''), s.findings, i)); });
  filter();
}
function filter() {
  const q = $('#q').value.trim().toLowerCase();
  document.querySelectorAll('#list li[data-text]').forEach((li) => { li.hidden = !!q && !li.dataset.text.includes(q); });
  document.querySelectorAll('#list section').forEach((s) => { s.hidden = !!q && !s.querySelector('li[data-text]:not([hidden])'); });
}
$('#q').addEventListener('input', filter);
$('#net').addEventListener('change', () => show());
show();
`;

export function renderTimelineHtml(h: History): string {
  const data = timelineData(h) as Record<string, unknown>;
  const net = counts(shown(h.net));
  const title = `${h.spec}: ${h.range.start.rev} → ${h.range.end.rev}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`History of ${title}`)}</title>
<style>${CSS}</style>
</head>
<body>
<header>
<h1>History of <code>${esc(h.spec)}</code></h1>
<div class="muted">${esc(h.range.start.rev)} (${esc(h.range.start.commit.slice(0, 7))}) → ${esc(h.range.end.rev)} (${esc(h.range.end.commit.slice(0, 7))}) · ${h.steps.length} steps${h.omitted ? ` (${h.omitted} earlier left out)` : ''} · net ${esc(countText(net))} · ${h.links.length} reverted</div>
</header>
<div id="strip" class="strip" aria-label="Steps; click one to show only it"></div>
<div class="bar">
<label><input type="checkbox" id="net"> net result only</label>
<input id="q" type="search" placeholder="Element history: filter by operation, component, property or rule" aria-label="Filter">
</div>
<main><div id="list"></div>
<noscript><p>This page needs JavaScript; the JSON output has the same data.</p></noscript></main>
<script type="application/json" id="data">${scriptJson(data)}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

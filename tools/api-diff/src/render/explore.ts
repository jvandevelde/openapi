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
import { adviceLine, asciiHtml, isNotice, isVersion, mergeDirections } from './common.ts';
import { explorerLink } from './config.ts';
import { DIFF_CSS, DIFF_SCRIPT } from './explore-diff.ts';
import { CHEVRON, THEME_CSS, THEME_INPUT, THEME_SCRIPT, topbar } from './theme.ts';

const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** JSON that is safe inside <script>: no `<`, and no U+2028/2029 line breaks. */
export function scriptJson(v: unknown): string {
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  return JSON.stringify(v).replace(/</g, '\\u003c').split(LS).join('\\u2028').split(PS).join('\\u2029');
}

const CSS = `${THEME_CSS}
.hero { padding:22px 24px 18px; border-bottom:1px solid var(--border); }
.hero-top { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
h1 { font-size:22px; line-height:1.25; letter-spacing:-.02em; margin:0; font-weight:700; }
.state { display:inline-flex; align-items:center; height:24px; padding:0 10px; border-radius:999px; font-size:12px; font-weight:600; color:var(--muted); background:var(--surface-2); box-shadow:inset 0 0 0 1px var(--border); }
.state.breaking { color:var(--error); background:var(--error-bg); } .state.compatible { color:var(--ok); background:var(--ok-bg); }
.sub { margin-top:4px; font-size:13px; }
.meta { margin-top:14px; display:grid; grid-template-columns:auto minmax(0,1fr); gap:4px 14px; font-size:13.5px; }
.meta > .muted { font-size:11px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; padding-top:2px; }
.bar { position:sticky; top:0; z-index:5; background:color-mix(in srgb, var(--bg) 86%, transparent); backdrop-filter:saturate(1.4) blur(10px); -webkit-backdrop-filter:saturate(1.4) blur(10px); border-bottom:1px solid var(--border); padding:10px 24px; display:flex; flex-wrap:wrap; gap:8px 10px; align-items:center; }
.bar .grp { display:inline-flex; gap:4px; padding:3px; border:1px solid var(--border); border-radius:10px; background:var(--surface); }
.bar .field { display:inline-flex; align-items:center; gap:6px; color:var(--muted); font-size:12.5px; white-space:nowrap; }
.bar select { max-width:190px; }
.bar #path { width:130px; }
.search { position:relative; flex:1; min-width:200px; display:flex; }
.search input { flex:1; min-width:0; width:100%; padding-left:32px; padding-right:34px; }
.search svg { position:absolute; left:10px; top:9px; color:var(--muted); pointer-events:none; }
.search kbd { position:absolute; right:8px; top:7px; pointer-events:none; }
.chip { display:inline-flex; align-items:center; gap:6px; height:24px; padding:0 9px; border-radius:7px; font-size:12.5px; color:var(--muted); cursor:pointer; user-select:none; }
.chip input { appearance:none; -webkit-appearance:none; margin:0; width:8px; height:8px; border-radius:50%; background:var(--border-strong); }
.chip:hover { color:var(--fg); }
.chip:has(input:checked) { background:var(--surface-3); color:var(--fg); }
.chip:has(input:focus-visible) { outline:2px solid var(--accent); outline-offset:1px; }
.chip.error input:checked { background:var(--error); } .chip.warn input:checked { background:var(--warn); } .chip.info input:checked { background:var(--info); }
.chip input:checked { background:var(--accent); }
main { padding:12px 24px 64px; max-width:1400px; }
.toolbar { display:flex; align-items:center; gap:8px; margin:6px 0 4px; }
.count { color:var(--muted); font-size:13px; margin-right:auto; }
.empty { margin:24px 0; padding:40px 20px; text-align:center; border:1px dashed var(--border-strong); border-radius:12px; color:var(--muted); }
.empty p { margin:0 0 12px; }
.sev { justify-self:start; align-self:start; min-width:0; width:68px; }
details.f { border:1px solid var(--border); border-radius:10px; margin:6px 0; background:var(--surface); transition:border-color .15s; }
details.f:hover { border-color:var(--border-strong); }
details.f[open] { box-shadow:var(--shadow); border-color:var(--border-strong); }
details.f > summary { padding:10px 12px; display:grid; grid-template-columns:16px 68px minmax(0,1fr); gap:10px; align-items:start; border-radius:10px; }
details.f > summary .chev, details.g > summary .chev { margin-top:3px; }
.subj { font-weight:600; overflow-wrap:anywhere; } .msg { overflow-wrap:anywhere; }
.body { padding:2px 14px 14px 106px; }
.body dl { display:grid; grid-template-columns:max-content minmax(0,1fr); gap:4px 16px; margin:8px 0; font-size:13px; }
.body dt { color:var(--muted); } .body dd { margin:0; overflow-wrap:anywhere; }
.sec h2 { font-size:15px; margin:24px 0 8px; font-weight:650; letter-spacing:-.01em; } .sec h2 .muted { font-weight:450; }
details.g { border:1px solid var(--border); border-left:3px solid var(--sevc, var(--border-strong)); border-radius:12px; margin:10px 0; background:var(--bg-elev); }
details.g:has(> summary .sev.error) { --sevc:var(--error); } details.g:has(> summary .sev.warn) { --sevc:var(--warn); } details.g:has(> summary .sev.info) { --sevc:var(--info); }
details.g > summary { padding:11px 12px; display:grid; grid-template-columns:16px 68px minmax(0,1fr); gap:10px; align-items:start; border-radius:12px; }
details.g > summary:hover, details.f > summary:hover { background:var(--surface-2); }
details.g > .rows { padding:0 10px 6px; } .rows.in-place .subj { display:none; }
.dirs { color:var(--muted); font-size:12px; white-space:nowrap; }
.part { margin:10px 0 0; padding-top:8px; border-top:1px solid var(--border); } .part h4 { margin:0; font-size:13px; font-weight:600; display:flex; align-items:center; gap:8px; } .part h4 .sev { width:auto; }
.note { margin:8px 0; padding:8px 12px; border-left:3px solid var(--accent); background:var(--accent-bg); border-radius:0 8px 8px 0; color:var(--fg-2); }
pre { margin:0; padding:6px 0; line-height:1.6; } .ln { display:inline-block; width:44px; padding-right:4px; text-align:right; color:var(--muted); opacity:.7; user-select:none; }
.fg { display:inline-block; width:16px; padding:0; margin-right:4px; border:0; background:none; color:var(--muted); font:inherit; cursor:pointer; user-select:none; } .fg[aria-hidden=true] { cursor:default; }
.more { border:1px solid var(--border); border-radius:6px; padding:0 6px; background:var(--surface-2); color:var(--muted); font:inherit; font-size:11px; cursor:pointer; }
.more:hover, .fg:hover { color:var(--accent); }
.tag { margin-left:10px; padding:0 6px; border-radius:6px; background:var(--accent-bg); color:var(--accent); font-size:11px; }
.crumbs { padding:6px 12px; font:12px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace; border-bottom:1px solid var(--border); overflow-wrap:anywhere; background:var(--surface); }
button.link { background:none; border:0; padding:0; font:inherit; color:var(--accent); cursor:pointer; text-decoration:underline; text-decoration-color:color-mix(in srgb, currentColor 35%, transparent); text-underline-offset:2px; }
details.ops > summary { color:var(--accent); width:max-content; display:inline-flex; align-items:center; gap:4px; }
details.ops > summary::before { content:""; width:5px; height:5px; margin:0 3px 0 1px; border-right:1.5px solid currentColor; border-bottom:1.5px solid currentColor; transform:rotate(-45deg); transition:transform .15s ease; }
details.ops[open] > summary::before { transform:rotate(45deg); }
details.ops ul { margin:6px 0 0; padding:6px 10px; list-style:none; width:max-content; max-width:100%; max-height:16em; overflow:auto; border:1px solid var(--border); border-radius:8px; background:var(--surface); }
details.ops li { white-space:nowrap; }
.g-ops { display:flex; gap:8px; align-items:baseline; margin:0 12px 8px 40px; font-size:13px; }
@media (max-width:760px) {
  .hero, .bar, main { padding-left:16px; padding-right:16px; } .bar { position:static; }
  .body { padding-left:14px; } details.f > summary, details.g > summary { grid-template-columns:16px minmax(0,1fr); } details.f > summary > div, details.g > summary > div { grid-column:1 / -1; }
  .g-ops { margin-left:12px; }
}
.facts { margin:12px 0 0; padding-top:8px; border-top:1px solid var(--border); font-size:12.5px; color:var(--muted); display:grid; gap:3px; }
.facts code { font-size:12px; color:var(--fg-2); } .facts .sev { width:auto; margin-right:6px; }
.rel { margin:6px 0; font-size:13px; } .rel .muted { margin-right:6px; }
${DIFF_CSS}`;

const SCRIPT = `
const data = JSON.parse(document.getElementById('data').textContent);
const $ = (s) => document.querySelector(s);
const el = (tag, attrs, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); for (const k of kids) e.append(k); return e; };
const chev = () => document.getElementById('chev').content.firstElementChild.cloneNode(true);
const opsOf = (f) => (/^[A-Z]+ \\//.test(f.subject) ? [f.subject] : []).concat(f.impact || []);
const tagsOf = (f) => [...new Set(opsOf(f).flatMap((o) => (data.operations[o] || {}).tags || []))];
const tags = [...new Set(data.findings.flatMap(tagsOf))].sort();
for (const t of tags) $('#tag').append(el('option', { value: t }, t));
${DIFF_SCRIPT}
// An inline schema that became a $ref (or the reverse) and the changes found inside it point at each other.
const REF_RULES = /^ref-(extracted|inlined)$/;
const hopKey = (name, l) => name + '|' + l.file + '|' + l.pointer;
const refFinding = new Map(), inside = new Map();
for (const f of data.findings) for (const name of ['base', 'revision']) {
  const l = f[name]; if (!l) continue;
  if (REF_RULES.test(f.rule)) refFinding.set(hopKey(name, l), f);
  for (const v of l.via || []) { const k = hopKey(name, v); (inside.get(k) || inside.set(k, []).get(k)).push(f); }
}
const rowNode = new Map(); // finding ID -> its row
const goTo = (id) => { const d = rowNode.get(id); if (!d) return; for (let p = d.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true; d.open = true; d.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
const findingLink = (f) => { const a = el('button', { type: 'button', class: 'link' }, f.subject + ': ' + f.message); a.addEventListener('click', () => goTo(f.id)); return a; };
// "via" on a change inside an extracted schema; "changes inside" on the extraction itself.
function refLinks(body, parts) {
  const f = parts[0];
  const line = (label, list) => { const d = el('div', { class: 'rel' }, el('span', { class: 'muted' }, label)); list.forEach((g, i) => { if (i) d.append(' · '); d.append(findingLink(g)); }); body.append(d); };
  const vias = [];
  for (const name of ['base', 'revision']) for (const v of (f[name] && f[name].via) || []) { const g = refFinding.get(hopKey(name, v)); if (g && !vias.includes(g)) vias.push(g); }
  if (vias.length) line('via', vias);
  if (REF_RULES.test(f.rule)) {
    const seen = new Set(), list = [];
    for (const name of ['base', 'revision']) if (f[name]) for (const g of inside.get(hopKey(name, f[name])) || []) { const key = g.rule.replace(/-in-(request|response)$/, '') + '|' + g.message; if (!seen.has(key)) { seen.add(key); list.push(g); } }
    if (list.length) line('changes inside', list);
  }
}
const RANK = { error: 0, warn: 1, info: 2 };
const worst = (fs) => fs.reduce((a, b) => (RANK[b.severity] < RANK[a.severity] ? b : a));
const dirOf = (f) => (/-in-request$/.test(f.rule) ? 'request' : /-in-response$/.test(f.rule) ? 'response' : '');
const noteEl = (note) => el('div', { class: 'note' }, ...note.split(String.fromCharCode(96)).map((part, i) => (i % 2 ? el('code', {}, part) : part)));
// A list of operations: up to 3 inline; more fold into a count that expands to one per line.
function opsList(ops) {
  if (ops.length <= 3) return el('span', { class: 'mono' }, ops.join(', '));
  const d = el('details', { class: 'ops' }, el('summary', {}, ops.length + ' operations'));
  const ul = el('ul', { class: 'mono' });
  for (const o of ops) ul.append(el('li', {}, o));
  d.append(ul);
  return d;
}
// The bookkeeping, after the evidence: rule, kind, severity source, ID and affected operations (one
// line per direction for a merged row), then acknowledgement, exclusion sets and spec explorer links.
function facts(parts) {
  const box = el('div', { class: 'facts' });
  const f = parts[0];
  const line = (p, lead) => {
    const d = el('div');
    if (lead) d.append(el('span', { class: 'sev ' + p.severity }, p.severity), 'in ' + dirOf(p) + 's · ');
    d.append(el('code', {}, p.rule), ' · ' + (lead ? '' : p.kind + ' · ') + 'severity from ' + p.severitySource + ' · id ', el('code', {}, p.id));
    if ((p.impact || []).length) d.append(' · affects ', opsList(p.impact));
    box.append(d);
  };
  if (parts.length === 1) line(f, false);
  else { box.append(el('div', {}, el('code', {}, f.rule.replace(/-in-(request|response)$/, '')), ' · ' + f.kind)); for (const p of parts) line(p, true); }
  for (const p of parts) {
    if (p.acknowledged) box.append(el('div', {}, 'acknowledged until ' + p.acknowledged.expires + (p.acknowledged.owner ? ' by ' + p.acknowledged.owner : '') + ': ' + p.acknowledged.reason));
    if (p.exclusions) box.append(el('div', {}, 'exclusion sets: ' + p.exclusions.join(', ')));
  }
  if (f.details.recursive) box.append(el('div', {}, '↻ this schema refers to itself'));
  if (f.links) {
    const dd = el('div', {}, 'spec explorer: ');
    let n = 0;
    for (const side of ['base', 'revision']) if (f.links[side]) { if (n++) dd.append(' · '); dd.append(el('a', { href: f.links[side], target: '_blank', rel: 'noopener' }, side)); }
    box.append(dd);
  }
  return box;
}
// One row: a finding, or a schema change's request and response findings merged (worst severity on the badge).
function item(parts) {
  const f = worst(parts);
  const d = el('details', { class: 'f' });
  for (const p of parts) rowNode.set(p.id, d);
  const badge = el('span', { class: 'sev ' + f.severity }, f.severity);
  const head = el('div', {}, el('span', { class: 'subj' }, f.subject), f.details.recursive ? ' ↻' : '', ' ', el('span', { class: 'msg' }, f.message));
  if (parts.length > 1) head.append(' ', el('span', { class: 'dirs' }, parts.map((p) => dirOf(p) + ' ' + p.severity).join(' · ')));
  d.append(el('summary', {}, chev(), badge, head));
  d.addEventListener('toggle', () => {
    if (!d.open || d.dataset.built) return;
    d.dataset.built = '1';
    const body = el('div', { class: 'body' });
    // What changed and what to do, then the evidence, then the bookkeeping.
    const notes = [...new Set(parts.map((p) => p.note).filter(Boolean))];
    if (notes.length === 1) body.append(noteEl(notes[0]));
    else for (const p of parts) if (p.note) body.append(noteEl('In ' + dirOf(p) + 's: ' + p.note));
    refLinks(body, parts);
    const snip = parts.map((p) => (data.snippets || {})[p.id]).find((x) => x && (x.base || x.revision));
    if (snip) body.append(diffView(snip, parts));
    body.append(facts(parts));
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
  // The header gives only the count (a toggle can't sit inside a summary); the list is at the top of the group.
  const showOps = section === 'changes' && ops.length > 0;
  if (showOps) head.append(el('span', { class: 'muted' }, ' · affects ' + ops.length + ' operation' + (ops.length === 1 ? '' : 's')));
  const d = el('details', { class: 'g' }, el('summary', {}, chev(), badge, head));
  if (showOps) d.append(el('div', { class: 'g-ops' }, el('span', { class: 'muted' }, 'affects'), opsList(ops)));
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
  $('#empty').hidden = shown > 0 || items.length === 0;
  $('#count').textContent = items.length === data.findings.length ? shown + ' of ' + items.length + ' findings' : shown + ' of ' + items.length + ' changes (' + shownFindings + ' of ' + data.findings.length + ' findings)';
}
document.querySelectorAll('.bar input, .bar select:not(#group)').forEach((x) => x.addEventListener('input', apply));
// Expand or collapse every group; reset the filters; '/' focuses the search box.
$('#expand').addEventListener('click', () => document.querySelectorAll('#list details.g').forEach((d) => { if (!d.hidden) d.open = true; }));
$('#collapse').addEventListener('click', () => document.querySelectorAll('#list details').forEach((d) => { d.open = false; }));
$('#reset').addEventListener('click', () => { document.querySelectorAll('.bar input[type=checkbox]').forEach((x) => { x.checked = true; }); $('#tag').value = ''; $('#path').value = ''; $('#q').value = ''; apply(); });
document.addEventListener('keydown', (e) => { if (e.key === '/' && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); $('#q').focus(); } });
apply();
${THEME_SCRIPT}`;

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
  const check = (name: string, value: string, label: string): string => `<label class="chip ${value}"><input type="checkbox" name="${name}" value="${value}" checked> ${label}</label>`;
  const STATE: Record<Result['state'], string> = { breaking: 'Breaking', compatible: 'Compatible', 'no-changes': 'No changes' };
  const searchIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
  return asciiHtml(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`${title}: explore changes`)}</title>
<style>${CSS}</style>
</head>
<body>
${THEME_INPUT}
${topbar('explore')}
<div class="hero">
<div class="hero-top"><h1>${esc(title)}: all changes</h1><span class="state ${r.state}">${STATE[r.state]}</span></div>
<div class="sub muted">api-diff ${esc(r.tool.version)} · profile ${esc(r.profile)} · ${n.total} findings: ${n.bySeverity.error} error, ${n.bySeverity.warn} warn, ${n.bySeverity.info} info · state ${esc(r.state)}</div>
<div class="meta"><span class="muted">base</span><span>${side(r.compared.base)}</span><span class="muted">revision</span><span>${side(r.compared.revision)}</span>${advice ? `<span class="muted">advice</span><span>${esc(advice)}</span>` : ''}</div>
</div>
<div class="bar">
<span class="grp" role="group" aria-label="Severity">${check('sev', 'error', 'error')}${check('sev', 'warn', 'warn')}${check('sev', 'info', 'info')}</span>
<span class="grp" role="group" aria-label="Kind">${check('kind', 'wire', 'wire')}${check('kind', 'sdk', 'sdk')}${check('kind', 'docs', 'docs')}</span>
<label class="field">tag <select id="tag"><option value="">all</option></select></label>
<label class="field">path <input id="path" type="search" placeholder="/pets"></label>
<span class="search">${searchIcon}<input id="q" type="search" placeholder="Search findings, rules and notes" aria-label="Search"><kbd>/</kbd></span>
<label class="field">group by <select id="group"><option value="place">schema or operation</option><option value="none">none</option></select></label>
</div>
<main>
<div class="toolbar"><div id="count" class="count"></div><button type="button" class="btn" id="expand">Expand groups</button><button type="button" class="btn" id="collapse">Collapse all</button></div>
<div id="list"></div>
<div id="empty" class="empty" hidden><p>No findings match these filters.</p><button type="button" class="btn" id="reset">Reset filters</button></div>
<noscript><p>This report needs JavaScript to show the findings. The JSON report has the same data.</p></noscript>
</main>
<template id="chev">${CHEVRON}</template>
<script type="application/json" id="data">${scriptJson(data)}</script>
<script>${SCRIPT}</script>
</body>
</html>
`);
}

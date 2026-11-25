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
.sides { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:10px; margin-top:12px; }
.side { border:1px solid var(--border); border-radius:10px; overflow:auto; background:var(--code-bg); max-height:70vh; }
.side h4 { margin:0; padding:7px 12px; font-size:12px; font-weight:600; border-bottom:1px solid var(--border); color:var(--fg-2); position:sticky; top:0; background:var(--surface-2); z-index:1; }
pre { margin:0; padding:6px 0; line-height:1.6; } .ln { display:inline-block; width:44px; padding-right:4px; text-align:right; color:var(--muted); opacity:.7; user-select:none; }
.fg { display:inline-block; width:16px; padding:0; margin-right:4px; border:0; background:none; color:var(--muted); font:inherit; cursor:pointer; user-select:none; } .fg[aria-hidden=true] { cursor:default; }
.more { border:1px solid var(--border); border-radius:6px; padding:0 6px; background:var(--surface-2); color:var(--muted); font:inherit; font-size:11px; cursor:pointer; }
.more:hover, .fg:hover { color:var(--accent); }
.mark { display:block; box-shadow:inset 2px 0 0 var(--muted); background:color-mix(in srgb, var(--muted) 8%, transparent); }
.tag { margin-left:10px; padding:0 6px; border-radius:6px; background:var(--accent-bg); color:var(--accent); font-size:11px; }
.blk + .blk { border-top:1px dashed var(--border-strong); }
.blk-h { padding:6px 12px 0; font:600 12px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace; color:var(--accent); }
.hit { background:var(--hl); display:block; box-shadow:inset 2px 0 0 var(--warn); } .at { outline:2px solid var(--accent); outline-offset:-2px; display:block; }
.crumbs { padding:6px 12px; font:12px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace; border-bottom:1px solid var(--border); overflow-wrap:anywhere; background:var(--surface); }
button.link { background:none; border:0; padding:0; font:inherit; color:var(--accent); cursor:pointer; text-decoration:underline; text-decoration-color:color-mix(in srgb, currentColor 35%, transparent); text-underline-offset:2px; }
.side h4 button.link { font-weight:400; } button.link.ref { margin-left:6px; }
details.ops > summary { color:var(--accent); width:max-content; display:inline-flex; align-items:center; gap:4px; }
details.ops > summary::before { content:""; width:5px; height:5px; margin:0 3px 0 1px; border-right:1.5px solid currentColor; border-bottom:1.5px solid currentColor; transform:rotate(-45deg); transition:transform .15s ease; }
details.ops[open] > summary::before { transform:rotate(45deg); }
details.ops ul { margin:6px 0 0; padding:6px 10px; list-style:none; width:max-content; max-width:100%; max-height:16em; overflow:auto; border:1px solid var(--border); border-radius:8px; background:var(--surface); }
details.ops li { white-space:nowrap; }
.g-ops { display:flex; gap:8px; align-items:baseline; margin:0 12px 8px 40px; font-size:13px; }
@media (max-width:760px) {
  .hero, .bar, main { padding-left:16px; padding-right:16px; } .bar { position:static; }
  .sides { grid-template-columns:minmax(0,1fr); } .body { padding-left:14px; }
  details.f > summary, details.g > summary { grid-template-columns:16px minmax(0,1fr); } details.f > summary > div, details.g > summary > div { grid-column:1 / -1; }
  .g-ops { margin-left:12px; }
}
`;

const SCRIPT = `
const data = JSON.parse(document.getElementById('data').textContent);
const $ = (s) => document.querySelector(s);
const el = (tag, attrs, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); for (const k of kids) e.append(k); return e; };
const chev = () => document.getElementById('chev').content.firstElementChild.cloneNode(true);
const opsOf = (f) => (/^[A-Z]+ \\//.test(f.subject) ? [f.subject] : []).concat(f.impact || []);
const tagsOf = (f) => [...new Set(opsOf(f).flatMap((o) => (data.operations[o] || {}).tags || []))];
const tags = [...new Set(data.findings.flatMap(tagsOf))].sort();
for (const t of tags) $('#tag').append(el('option', { value: t }, t));
// Lines other findings point at, by side and file, so a pane can mark them ("3 things changed in Order").
const marks = { base: {}, revision: {} };
const byId = new Map(data.findings.map((f) => [f.id, f]));
for (const [id, sn] of Object.entries(data.snippets || {})) for (const name of ['base', 'revision']) {
  const s = sn[name]; if (!s) continue;
  const m = (marks[name][s.file] = marks[name][s.file] || {});
  (m[s.line] = m[s.line] || new Set()).add(id);
}
// Short name of a $ref or pointer: its last step ("#/components/schemas/Address" -> "Address").
const unesc = (k) => k.replace(/~1/g, '/').replace(/~0/g, '~');
const tail = (p) => { const segs = String(p).replace(/^[^#]*#?/, '').split('/').filter(Boolean).map(unesc); const op = /^(paths|webhooks)$/.test(segs[0]) && segs.length === 3; return op ? segs[2].toUpperCase() + ' ' + segs[1] : segs.length ? segs[segs.length - 1] : String(p); };
// Schemas shorter than this show whole; in longer ones, unchanged parts of more than FOLD_MIN lines fold to one line.
const SHOW_WHOLE = 40, FOLD_MIN = 3, OPEN_SUBTREE = 30;
// One block of source lines: the enclosing schema (or operation), with the changed line highlighted, its
// ancestors and other findings' lines kept open, and the rest folded by indentation, as an editor folds.
function sourceBlock(o) {
  const lines = o.lines;
  const n0 = o.start, n1 = o.start + lines.length - 1;
  const ind = (n) => { const t = lines[n - n0] || ''; return t.trim() ? t.length - t.trimStart().length : -1; };
  // foldEnd[n]: the last line of the node that starts on line n, when the lines after it are indented deeper.
  const foldEnd = {};
  for (let n = n0; n <= n1; n++) {
    const i = ind(n); if (i < 0) continue;
    let e = n;
    for (let k = n + 1; k <= n1; k++) { const j = ind(k); if (j < 0) continue; if (j <= i) break; e = k; }
    if (e > n) foldEnd[n] = e;
  }
  const keep = new Set([o.hit, ...(o.marks ? Object.keys(o.marks).map(Number) : [])].filter((n) => n >= n0 && n <= n1));
  const folded = new Set();
  const foldDefault = () => {
    folded.clear();
    if (lines.length <= SHOW_WHOLE) return;
    const hitEnd = foldEnd[o.hit] || o.hit;
    const hitOpen = hitEnd - o.hit <= OPEN_SUBTREE;
    for (const k of Object.keys(foldEnd)) {
      const n = Number(k), e = foldEnd[n];
      if (e - n < FOLD_MIN) continue;
      if ([...keep].some((x) => x > n && x <= e)) continue; // an ancestor of the change or of a marked line
      if (hitOpen && n > o.hit && e <= hitEnd) continue; // inside the changed node, when it's short
      folded.add(n);
    }
  };
  foldDefault();
  const pre = el('pre');
  let rows = {};
  const render = () => {
    pre.textContent = ''; rows = {};
    for (let n = n0; n <= n1; n++) {
      const cls = n === o.hit ? 'hit' : o.marks && o.marks[n] ? 'mark' : '';
      const row = el('span', cls ? { class: cls } : {});
      if (o.marks && o.marks[n] && n !== o.hit) row.title = [...o.marks[n]].map((id) => (byId.get(id) || {}).message).filter(Boolean).join('\\n');
      const fold = foldEnd[n] !== undefined && foldEnd[n] - n >= FOLD_MIN;
      const g = el('button', { type: 'button', class: 'fg', tabindex: fold ? '0' : '-1', 'aria-hidden': fold ? 'false' : 'true' }, fold ? (folded.has(n) ? '▸' : '▾') : '');
      if (fold) { g.title = folded.has(n) ? 'show these lines' : 'fold'; g.addEventListener('click', () => { if (folded.has(n)) folded.delete(n); else folded.add(n); render(); }); }
      row.append(el('span', { class: 'ln' }, String(n)), g, lines[n - n0]);
      if (n === o.hit && o.label) row.append(el('span', { class: 'tag' }, o.label));
      if (fold && folded.has(n)) {
        const more = el('button', { type: 'button', class: 'more' }, '… ' + (foldEnd[n] - n) + ' lines');
        more.addEventListener('click', () => { folded.delete(n); render(); });
        row.append(' ', more);
        rows[n] = row; row.append('\\n'); pre.append(row);
        for (let k = n + 1; k <= foldEnd[n]; k++) rows[k] = row; // a jump into a folded part lands on its header until opened
        n = foldEnd[n];
        continue;
      }
      rows[n] = row; row.append('\\n'); pre.append(row);
    }
  };
  render();
  const node = el('div', { class: 'blk' });
  if (o.title) node.append(el('div', { class: 'blk-h' }, o.title));
  node.append(pre);
  return {
    node,
    folds: () => folded.size > 0,
    foldable: () => Object.keys(foldEnd).some((k) => foldEnd[k] - Number(k) >= FOLD_MIN) && lines.length > SHOW_WHOLE,
    all: (open) => { if (open) folded.clear(); else foldDefault(); render(); },
    // Opens the folds around line n and returns its row.
    reveal: (n) => { let changed = false; for (const h of [...folded]) if (h < n && foldEnd[h] >= n) { folded.delete(h); changed = true; } if (changed) render(); return rows[n]; },
    has: (n) => n >= n0 && n <= n1,
  };
}
// One side of a finding. When this side went through $refs the other didn't (an inline schema became a
// $ref), it shows the schema both sides have in common with the $ref line first, then the component the
// change is in. A $ref node also shows the node it points at below it. Each block is the whole enclosing
// schema or operation, folded around the change; a breadcrumb jumps to each step.
function side(name, s) {
  const box = el('div', { class: 'side' });
  const head = el('h4', {}, el('span', {}, name + (s ? ' · ' + s.file + ':' + s.line : '')));
  box.append(head);
  if (!s) { box.append(el('pre', {}, el('span', { class: 'muted' }, '  (not in this version)'))); return box; }
  const src = ((data.sourceLines || {})[name] || {});
  const linesOf = (file, b) => { const f = src[file] || {}; const out = []; for (let n = b.start; n <= b.end; n++) out.push(f[n] === undefined ? '' : f[n]); return out; };
  const other = name === 'base' ? 'revision' : 'base';
  const isNew = (yes) => (yes ? (name === 'revision' ? ' (new)' : ' (not in ' + other + ')') : '');
  const blocks = [];
  const add = (file, b, hit, path, extra) => { const blk = sourceBlock(Object.assign({ lines: linesOf(file, b), start: b.start, hit, marks: (marks[name] || {})[file] }, extra)); blk.file = file; blk.path = path; blk.scope = b; blocks.push(blk); return blk; };
  const via = s.via || [];
  via.forEach((v, i) => add(v.file, v.scope || { start: v.line, end: v.line }, v.line, v.path, { label: '↓ ' + tail(v.name), title: i ? '→ ' + tail(via[i - 1].name) : '' }));
  const ownTitle = via.length ? '→ ' + tail(via[via.length - 1].name) + isNew(s.scopeIsNew) : '';
  if (s.scope) add(s.file, s.scope, s.line, s.path, { title: ownTitle, label: s.ref ? '↓ ' + tail(s.ref.name) : '' });
  else { const blk = sourceBlock({ lines: s.lines, start: s.start, hit: s.line, title: ownTitle, marks: (marks[name] || {})[s.file] }); blk.file = s.file; blk.path = s.path; blk.scope = { start: s.start, end: s.start + s.lines.length - 1 }; blocks.push(blk); }
  if (s.ref) add(s.ref.file, s.ref, s.ref.line, undefined, { title: '→ ' + tail(s.ref.name) + isNew(s.ref.isNew) });
  const jump = (blk, n) => { const row = blk.reveal(n); if (!row) return; box.querySelectorAll('.at').forEach((x) => x.classList.remove('at')); row.classList.add('at'); box.scrollTop += row.getBoundingClientRect().top - box.getBoundingClientRect().top - 70; };
  // Breadcrumb: the first block's path from the root, then each later block's path from its scope's name.
  const crumbs = el('div', { class: 'crumbs' });
  let any = false;
  blocks.forEach((blk, bi) => {
    if (!blk.path || !blk.path.length) return;
    const from = bi === 0 ? 0 : Math.max(0, blk.scope.pointer ? blk.scope.pointer.split('/').length - 2 : 0);
    if (any) crumbs.append(el('span', { class: 'muted' }, ' ⇢ '));
    blk.path.slice(from).forEach((p, i) => {
      if (i) crumbs.append(el('span', { class: 'muted' }, ' › '));
      if (!blk.has(p.line)) { crumbs.append(el('span', { title: 'line ' + p.line }, p.key)); return; }
      const b = el('button', { type: 'button', class: 'link', title: 'line ' + p.line }, p.key);
      b.addEventListener('click', () => jump(blk, p.line));
      crumbs.append(b);
    });
    any = true;
  });
  if (any) box.append(crumbs);
  for (const blk of blocks) box.append(blk.node);
  // Show everything / fold again, for the whole side.
  if (blocks.some((b) => b.foldable())) {
    let open = false;
    const t = el('button', { type: 'button', class: 'link' }, 'show all lines');
    t.addEventListener('click', () => { open = !open; for (const b of blocks) b.all(open); t.textContent = open ? 'fold unchanged' : 'show all lines'; });
    head.append(' ', t);
  }
  // Start with the change in view.
  const own = blocks[via.length] || blocks[0];
  // Scroll only if the change is below the fold, so a $ref line above it stays in view when both fit.
  requestAnimationFrame(() => { const row = own.reveal(s.line); if (!row) return; const r = row.getBoundingClientRect(), bx = box.getBoundingClientRect(); if (r.bottom > bx.bottom) box.scrollTop += r.top - bx.top - 90; });
  return box;
}
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
function refLinks(dl, parts) {
  const f = parts[0];
  const vias = [];
  for (const name of ['base', 'revision']) for (const v of (f[name] && f[name].via) || []) { const g = refFinding.get(hopKey(name, v)); if (g && !vias.includes(g)) vias.push(g); }
  if (vias.length) { const dd = el('dd'); vias.forEach((g, i) => { if (i) dd.append(el('br')); dd.append(findingLink(g)); }); dl.append(el('dt', {}, 'via'), dd); }
  if (REF_RULES.test(f.rule)) {
    const seen = new Set(), list = [];
    for (const name of ['base', 'revision']) if (f[name]) for (const g of inside.get(hopKey(name, f[name])) || []) { const key = g.rule.replace(/-in-(request|response)$/, '') + '|' + g.message; if (!seen.has(key)) { seen.add(key); list.push(g); } }
    if (list.length) { const dd = el('dd'); list.forEach((g, i) => { if (i) dd.append(el('br')); dd.append(findingLink(g)); }); dl.append(el('dt', {}, 'changes inside'), dd); }
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
// The per-finding facts: rule (and kind), severity source, ID, affected operations, acknowledgement, exclusions, links.
function facts(dl, f, withKind) {
  const row = (k, v) => { if (v) dl.append(el('dt', {}, k), el('dd', {}, v)); };
  row('rule', f.rule); if (withKind) row('kind', f.kind); row('severity from', f.severitySource); row('finding id', f.id);
  if ((f.impact || []).length) row('affects', opsList(f.impact));
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
  for (const p of parts) rowNode.set(p.id, d);
  const badge = el('span', { class: 'sev ' + f.severity }, f.severity);
  const head = el('div', {}, el('span', { class: 'subj' }, f.subject), f.details.recursive ? ' ↻' : '', ' ', el('span', { class: 'msg' }, f.message));
  if (parts.length > 1) head.append(' ', el('span', { class: 'dirs' }, parts.map((p) => dirOf(p) + ' ' + p.severity).join(' · ')));
  d.append(el('summary', {}, chev(), badge, head));
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
    refLinks(dl, parts);
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

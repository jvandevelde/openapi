// The explore page's evidence view: a finding's base and revision source side by side, aligned
// row by row. A line diff of the two scopes tints removed, added and changed lines (changed
// characters marked within the line), leaves a gap where an item was added or removed instead of
// highlighting its parent, and folds runs of unchanged lines. Long lines wrap with a hanging indent.
// See decision record 2026-11-25T0136-explore-panes-show-ref-site-and-fold and the UX pass record.
//
// Plain browser JavaScript, inlined into the page; written as String.raw so regexes need no double
// escaping. It must not contain backticks or a dollar sign followed by an opening brace.

export const DIFF_CSS = `
.dv { border:1px solid var(--border); border-radius:10px; background:var(--code-bg); margin-top:12px; max-height:75vh; overflow:auto; font:12.5px/1.6 "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
.dv-top { position:sticky; top:0; z-index:2; background:var(--surface-2); border-bottom:1px solid var(--border); }
.dv-bar { display:flex; justify-content:flex-end; gap:12px; padding:4px 12px 0; font-family:Inter, system-ui, sans-serif; font-size:12px; }
.dv-g { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); }
.dv-g > * { min-width:0; }
.dv-h { padding:4px 12px 6px; font-family:Inter, system-ui, sans-serif; font-size:12px; color:var(--fg-2); }
.dv-h b { font-weight:600; } .dv-h + .dv-h, .c + .c, .bt + .bt { border-left:1px solid var(--border); }
.dv-h .crumbs { padding:2px 0 0; border:0; background:none; font:12px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
.bt { padding:6px 12px 2px; font-weight:600; color:var(--accent); }
.pg + .pg { border-top:1px dashed var(--border-strong); }
.c { display:grid; grid-template-columns:44px 16px minmax(0,1fr); }
.c .ln { width:auto; padding-right:4px; }
.c .t { white-space:pre-wrap; overflow-wrap:anywhere; padding-left:calc(var(--i, 0) * 1ch + 2ch); text-indent:calc(var(--i, 0) * -1ch - 2ch); padding-right:10px; }
.c.del { background:var(--diff-del); } .c.ins { background:var(--diff-ins); }
.c.fill { background:repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--muted) 10%, transparent) 6px 7px); }
.c.gap { background:repeating-linear-gradient(135deg, var(--diff-gap) 0 6px, color-mix(in srgb, var(--warn) 25%, transparent) 6px 7px); }
.c.gap .t { color:var(--warn); font-style:italic; text-indent:0; padding-left:2ch; }
.c.hit { box-shadow:inset 3px 0 0 var(--warn); } .c.hit:not(.del):not(.ins) { background:var(--hl); }
.c.at { outline:2px solid var(--accent); outline-offset:-2px; }
.dx-del { background:var(--diff-del-x); border-radius:3px; } .dx-ins { background:var(--diff-ins-x); border-radius:3px; }
.c .fg { width:16px; }
.dot { display:inline-block; width:7px; height:7px; border-radius:50%; margin-left:4px; vertical-align:middle; background:var(--muted); border:0; padding:0; cursor:pointer; }
.fold-row { grid-column:1 / -1; padding:1px 0 1px 60px; }
.dv-legend { display:flex; flex-wrap:wrap; gap:4px 14px; padding:6px 2px 0; font-size:12px; color:var(--muted); }
.dv-legend i { display:inline-block; width:12px; height:10px; border-radius:2px; vertical-align:-1px; margin-right:4px; }
.also { margin:8px 0 0; font-size:13px; } .also .muted { margin-right:6px; }
`;

export const DIFF_SCRIPT = String.raw`
// Lines other findings point at, by side and file, for the gutter dots and "also on this line".
const byId = new Map(data.findings.map((f) => [f.id, f]));
const marks = { base: {}, revision: {} };
for (const [id, sn] of Object.entries(data.snippets || {})) for (const name of ['base', 'revision']) {
  const s = sn[name]; if (!s || s.absent) continue;
  const m = (marks[name][s.file] = marks[name][s.file] || {});
  (m[s.line] = m[s.line] || new Set()).add(id);
}
const unesc = (k) => k.replace(/~1/g, '/').replace(/~0/g, '~');
const tail = (p) => { const segs = String(p).replace(/^[^#]*#?/, '').split('/').filter(Boolean).map(unesc); const op = /^(paths|webhooks)$/.test(segs[0]) && segs.length === 3; return op ? segs[2].toUpperCase() + ' ' + segs[1] : segs.length ? segs[segs.length - 1] : String(p); };
const baseName = (p) => String(p).split(/[\\/]/).pop();
const ptrSegs = (p) => (p === '' ? [] : String(p).split('/').slice(1));
const isAncestor = (a, b) => { const x = ptrSegs(a), y = ptrSegs(b); return x.length < y.length && x.every((s, i) => s === y[i]); };
// Blocks over this many rows fold their unchanged parts; parts of fewer than FOLD_MIN lines never fold.
const SHOW_WHOLE = 40, FOLD_MIN = 3, OPEN_SUBTREE = 30;

// Longest common subsequence alignment of two lists: [i, j] pairs in order, -1 for a gap.
function lcsAlign(a, b, eq) {
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = eq(a[i], b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) { if (eq(a[i], b[j])) out.push([i++, j++]); else if (L[i + 1][j] >= L[i][j + 1]) out.push([i++, -1]); else out.push([-1, j++]); }
  while (i < n) out.push([i++, -1]);
  while (j < m) out.push([-1, j++]);
  return out;
}
// Rows of a side-by-side diff: { b, r } line numbers (null for a gap) and kind same, chg, del or ins.
// Within a run of differences, removed and added lines are paired in order as changed lines.
function alignRows(bb, rb) {
  if (!bb || !rb) {
    const blk = bb || rb, k = bb ? 'b' : 'r';
    return blk.lines.map((_, i) => ({ b: k === 'b' ? blk.start + i : null, r: k === 'r' ? blk.start + i : null, kind: blk.tint ? (k === 'b' ? 'del' : 'ins') : 'one' }));
  }
  const rows = [];
  let dels = [], inss = [];
  const flush = () => {
    const n = Math.max(dels.length, inss.length);
    for (let k = 0; k < n; k++) {
      const b = k < dels.length ? dels[k] : null, r = k < inss.length ? inss[k] : null;
      rows.push({ b, r, kind: b !== null && r !== null ? 'chg' : b !== null ? 'del' : 'ins' });
    }
    dels = []; inss = [];
  };
  for (const [i, j] of lcsAlign(bb.lines, rb.lines, (x, y) => x === y)) {
    if (i >= 0 && j >= 0) { flush(); rows.push({ b: bb.start + i, r: rb.start + j, kind: 'same' }); }
    else if (i >= 0) dels.push(bb.start + i);
    else inss.push(rb.start + j);
  }
  flush();
  return rows;
}
// Marks the characters that differ between two versions of a line: [text, changed] runs for each.
const tokens = (s) => s.match(/\s+|[A-Za-z0-9_.$@-]+|[^\sA-Za-z0-9_.$@-]/g) || [];
function wordDiff(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (ta.length * tb.length > 40000) return [[[a, true]], [[b, true]]];
  const outA = [], outB = [];
  for (const [i, j] of lcsAlign(ta, tb, (x, y) => x === y)) {
    if (i >= 0) outA.push([ta[i], j < 0]);
    if (j >= 0) outB.push([tb[j], i < 0]);
  }
  return [outA, outB];
}
const indentOf = (t) => (t && t.trim() ? t.length - t.trimStart().length : -1);
// For each line that starts a nested part, the last line of that part, by indentation (as editors fold).
function foldEnds(blk) {
  const ends = {}, n0 = blk.start, n1 = blk.start + blk.lines.length - 1;
  const ind = (n) => indentOf(blk.lines[n - n0]);
  for (let n = n0; n <= n1; n++) {
    const i = ind(n); if (i < 0) continue;
    let e = n;
    for (let k = n + 1; k <= n1; k++) { const j = ind(k); if (j < 0) continue; if (j <= i) break; e = k; }
    if (e > n) ends[n] = e;
  }
  return ends;
}

// One side's blocks: the $ref sites it went through (see Snippet.via), the scope the change is in,
// and a $ref node's target. Each has the lines to show, the line to highlight and a title.
function blocksOf(name, s, absent) {
  const src = ((data.sourceLines || {})[name] || {});
  const linesOf = (file, b) => { const f = src[file] || {}; const out = []; for (let n = b.start; n <= b.end; n++) out.push(f[n] === undefined ? '' : f[n]); return out; };
  const other = name === 'base' ? 'revision' : 'base';
  const isNew = (yes) => (yes ? (name === 'revision' ? ' (new)' : ' (not in ' + other + ')') : '');
  const out = [];
  const via = s.via || [];
  via.forEach((v, i) => {
    const b = v.scope || { pointer: null, start: v.line, end: v.line };
    out.push({ file: v.file, pointer: b.pointer, start: b.start, lines: linesOf(v.file, b), hit: v.line, label: '↓ ' + tail(v.name), title: i ? '→ ' + tail(via[i - 1].name) : '', path: v.path });
  });
  const ownTitle = via.length ? '→ ' + tail(via[via.length - 1].name) + isNew(s.scopeIsNew) : '';
  const hit = absent ? null : s.line;
  if (s.scope) out.push({ file: s.file, pointer: s.scope.pointer, start: s.scope.start, lines: linesOf(s.file, s.scope), hit, path: s.path, title: ownTitle, label: s.ref && !absent ? '↓ ' + tail(s.ref.name) : '', tint: !!(via.length && s.scopeIsNew), own: true });
  else out.push({ file: s.file, pointer: null, start: s.start, lines: s.lines, hit, path: s.path, title: ownTitle, own: true });
  if (s.ref && !absent) out.push({ file: s.ref.file, pointer: s.ref.pointer, start: s.ref.start, lines: linesOf(s.ref.file, s.ref), hit: s.ref.line, title: '→ ' + tail(s.ref.name) + isNew(s.ref.isNew), tint: !!s.ref.isNew });
  for (const b of out) b.marks = (marks[name] || {})[b.file] || {};
  return out;
}
// Pairs base and revision blocks: the same node first, then the rest in order.
function pairBlocks(B, R) {
  const used = new Set(), pairs = [];
  for (const b of B) {
    const j = b.pointer === null ? -1 : R.findIndex((r, k) => !used.has(k) && r.pointer === b.pointer);
    if (j >= 0) { used.add(j); pairs.push([b, R[j]]); } else pairs.push([b, null]);
  }
  const rest = R.filter((_, k) => !used.has(k));
  for (const p of pairs) if (!p[1] && rest.length) p[1] = rest.shift();
  for (const r of rest) pairs.push([null, r]);
  return pairs;
}

// The evidence for one row: both sides aligned, with breadcrumbs, a fold toggle, a legend and
// "also on this line" links. 'parts' are the row's findings (request and response merged).
function diffView(snip, parts) {
  const f = parts[0];
  const own = new Set(parts.map((p) => p.id));
  // A side whose location is the parent of the other's (the item was added or removed) has nothing
  // to highlight; the gap next to the other side's item shows where it would be.
  let absent = null;
  const bp = f.base && f.base.pointer, rp = f.revision && f.revision.pointer;
  if (snip.base && snip.base.absent) absent = 'base';
  else if (snip.revision && snip.revision.absent) absent = 'revision';
  else if (bp !== undefined && rp !== undefined) absent = isAncestor(rp, bp) ? 'revision' : isAncestor(bp, rp) ? 'base' : null;
  const B = snip.base ? blocksOf('base', snip.base, absent === 'base') : [];
  const R = snip.revision ? blocksOf('revision', snip.revision, absent === 'revision') : [];
  // A side missing altogether: what the other side shows is all removed (or all added).
  if (!snip.revision) for (const b of B) b.tint = true;
  if (!snip.base) for (const r of R) r.tint = true;
  const pairs = pairBlocks(B, R).map(([b, r]) => ({ b, r, rows: alignRows(b, r), folded: new Set(), el: el('div', { class: 'pg' }) }));

  const box = el('div', { class: 'dv' });
  const top = el('div', { class: 'dv-top' });
  const bar = el('div', { class: 'dv-bar' });
  const heads = el('div', { class: 'dv-g' });
  top.append(bar, heads);
  box.append(top);
  for (const p of pairs) box.append(p.el);

  // Folding works on rows, so both sides fold together. By default, parts of a block whose rows are
  // all unchanged fold, except around the highlighted lines and other findings' lines.
  for (const p of pairs) {
    p.ends = { b: p.b ? foldEnds(p.b) : {}, r: p.r ? foldEnds(p.r) : {} };
    p.rowOf = { b: {}, r: {} };
    p.rows.forEach((row, i) => { if (row.b !== null) p.rowOf.b[row.b] = i; if (row.r !== null) p.rowOf.r[row.r] = i; });
    // rangeEnd[i]: the last row of the part that starts on row i.
    p.rangeEnd = {};
    p.rows.forEach((row, i) => {
      let e = -1;
      for (const k of ['b', 'r']) { const n = row[k]; if (n !== null && p.ends[k][n] !== undefined) e = Math.max(e, p.rowOf[k][p.ends[k][n]]); }
      if (e > i) p.rangeEnd[i] = e;
    });
    const keep = new Set();
    p.rows.forEach((row, i) => {
      for (const k of ['b', 'r']) { const blk = p[k], n = row[k]; if (blk && n !== null && (n === blk.hit || blk.marks[n])) keep.add(i); }
    });
    const hitRows = [...keep].filter((i) => (p.b && p.rows[i].b === p.b.hit) || (p.r && p.rows[i].r === p.r.hit));
    p.hitOpen = hitRows.map((i) => [i, p.rangeEnd[i] || i]).filter(([i, e]) => e - i <= OPEN_SUBTREE);
    p.foldable = (i) => {
      const e = p.rangeEnd[i]; if (e === undefined || e - i < FOLD_MIN) return false;
      for (let k = i + 1; k <= e; k++) if (p.rows[k].kind !== 'same' && p.rows[k].kind !== 'one' || keep.has(k)) return false;
      return !p.hitOpen.some(([h, he]) => i > h && e <= he);
    };
    p.foldDefault = () => {
      p.folded.clear();
      if (p.rows.length <= SHOW_WHOLE) return;
      for (let i = 0; i < p.rows.length; i++) if (p.foldable(i)) { p.folded.add(i); i = p.rangeEnd[i]; }
    };
    p.foldDefault();
  }

  const name = { b: 'base', r: 'revision' };
  const gapLabel = { b: 'not in base', r: 'not in revision' };
  // Rows next to the present side's highlighted item, where the absent side has no line: the gap.
  const gapRows = (p) => {
    const g = new Set();
    if (!absent) return g;
    const k = absent === 'base' ? 'b' : 'r', o = k === 'b' ? 'r' : 'b';
    const blk = p[o]; if (!blk || blk.hit === null || p.rowOf[o][blk.hit] === undefined) return g;
    const i0 = p.rowOf[o][blk.hit], i1 = p.rangeEnd[i0] || i0;
    for (let i = i0; i <= i1; i++) if (p.rows[i][k] === null) g.add(i);
    return g;
  };
  const cell = (p, row, i, k, gaps) => {
    const blk = p[k], n = row[k];
    if (n === null || !blk) {
      const c = el('div', { class: 'c ' + (gaps.has(i) ? 'gap' : 'fill') }, el('span', { class: 'ln' }), el('span'), el('span', { class: 't' }));
      if (gaps.has(i) && !gaps.has(i - 1)) c.lastChild.textContent = '← ' + gapLabel[k];
      return c;
    }
    const text = blk.lines[n - blk.start] || '';
    const kind = row.kind === 'one' || row.kind === 'same' ? '' : k === 'b' ? 'del' : 'ins';
    const c = el('div', { class: 'c' + (kind ? ' ' + kind : '') + (n === blk.hit ? ' hit' : '') });
    c.dataset.side = k; c.dataset.line = String(n);
    const ln = el('span', { class: 'ln' }, String(n));
    const fold = p.rangeEnd[i] !== undefined && p.rangeEnd[i] - i >= 1;
    const g = el('button', { type: 'button', class: 'fg', tabindex: fold ? '0' : '-1', 'aria-hidden': fold ? 'false' : 'true' }, fold ? (p.folded.has(i) ? '▸' : '▾') : '');
    if (fold) { g.title = p.folded.has(i) ? 'show these lines' : 'fold'; g.addEventListener('click', () => { if (p.folded.has(i)) p.folded.delete(i); else p.folded.add(i); render(p); }); }
    const t = el('span', { class: 't' });
    t.style.setProperty('--i', String(Math.max(0, indentOf(text))));
    if (row.kind === 'chg' && blk === p[k] && p.b && p.r) {
      const [da, db] = wordDiff(p.b.lines[row.b - p.b.start] || '', p.r.lines[row.r - p.r.start] || '');
      for (const [tok, changed] of k === 'b' ? da : db) t.append(changed && tok.trim() ? el('span', { class: k === 'b' ? 'dx-del' : 'dx-ins' }, tok) : tok);
    } else t.append(text);
    if (n === blk.hit && blk.label) t.append(el('span', { class: 'tag' }, blk.label));
    const others = [], rowsSeen = new Set();
    for (const id of blk.marks[n] || []) { const node = rowNode.get(id); if (own.has(id) || !node || rowsSeen.has(node)) continue; rowsSeen.add(node); others.push(id); }
    for (const id of others.slice(0, 3)) {
      const o = byId.get(id); if (!o) continue;
      const dot = el('button', { type: 'button', class: 'dot', title: o.subject + ': ' + o.message, 'aria-label': 'other finding: ' + o.message });
      dot.addEventListener('click', () => goTo(id));
      t.append(dot);
    }
    c.append(ln, g, t);
    return c;
  };
  const render = (p) => {
    p.el.textContent = '';
    const g = el('div', { class: 'dv-g' });
    if ((p.b && p.b.title) || (p.r && p.r.title) || !p.b || !p.r) {
      g.append(el('div', { class: 'bt' }, p.b ? p.b.title || '' : p.r && p.r.tint ? '(not in base)' : ''), el('div', { class: 'bt' }, p.r ? p.r.title || '' : p.b && p.b.tint ? '(not in revision)' : ''));
    }
    const gaps = gapRows(p);
    for (let i = 0; i < p.rows.length; i++) {
      const row = p.rows[i];
      g.append(cell(p, row, i, 'b', gaps), cell(p, row, i, 'r', gaps));
      if (p.folded.has(i)) {
        const e = p.rangeEnd[i];
        const more = el('button', { type: 'button', class: 'more' }, '… ' + (e - i) + ' unchanged line' + (e - i === 1 ? '' : 's'));
        more.addEventListener('click', () => { p.folded.delete(i); render(p); });
        g.append(el('div', { class: 'fold-row' }, more));
        i = e;
      }
    }
    p.el.append(g);
  };
  pairs.forEach(render);

  // Scrolls to a line of one side, opening the folds around it.
  const jump = (k, blk, n) => {
    const p = pairs.find((q) => q[k] === blk); if (!p) return;
    const i = p.rowOf[k][n]; if (i === undefined) return;
    let changed = false;
    for (const h of [...p.folded]) if (h < i && p.rangeEnd[h] >= i) { p.folded.delete(h); changed = true; }
    if (changed) render(p);
    const c = p.el.querySelector('.c[data-side="' + k + '"][data-line="' + n + '"]'); if (!c) return;
    box.querySelectorAll('.at').forEach((x) => x.classList.remove('at'));
    c.classList.add('at');
    box.scrollTop += c.getBoundingClientRect().top - box.getBoundingClientRect().top - top.offsetHeight - 30;
  };
  // Headers: side, short file name and line (full path as a tooltip), and the breadcrumb through the blocks.
  for (const k of ['b', 'r']) {
    const s = snip[name[k]], blocks = k === 'b' ? B : R;
    const h = el('div', { class: 'dv-h' });
    const label = el('b', {}, name[k]);
    h.append(label);
    if (!s) { h.append(el('span', { class: 'muted' }, ' · not in this version')); heads.append(h); continue; }
    const where = el('span', { title: s.file }, ' · ' + baseName(s.file) + (absent === name[k] ? '' : ':' + s.line));
    h.append(where);
    const crumbs = el('div', { class: 'crumbs' });
    let any = false;
    blocks.forEach((blk, bi) => {
      if (!blk.path || !blk.path.length) return;
      const from = bi === 0 ? 0 : Math.max(0, blk.pointer ? ptrSegs(blk.pointer).length - 1 : 0);
      if (any) crumbs.append(el('span', { class: 'muted' }, ' ⇢ '));
      blk.path.slice(from).forEach((step, i) => {
        if (i) crumbs.append(el('span', { class: 'muted' }, ' › '));
        const text = step.label || step.key;
        const inBlock = step.line >= blk.start && step.line < blk.start + blk.lines.length;
        if (!inBlock) { crumbs.append(el('span', { title: 'line ' + step.line }, text)); return; }
        const b = el('button', { type: 'button', class: 'link', title: 'line ' + step.line }, text);
        b.addEventListener('click', () => jump(k, blk, step.line));
        crumbs.append(b);
      });
      any = true;
    });
    if (any) h.append(crumbs);
    heads.append(h);
  }
  // Show every line / fold unchanged parts again, for the whole view.
  if (pairs.some((p) => p.rows.length > SHOW_WHOLE)) {
    let open = false;
    const t = el('button', { type: 'button', class: 'link' }, 'show all lines');
    t.addEventListener('click', () => { open = !open; for (const p of pairs) { if (open) p.folded.clear(); else p.foldDefault(); render(p); } t.textContent = open ? 'fold unchanged lines' : 'show all lines'; });
    bar.append(t);
  }
  const wrap = el('div', {}, box);
  // Legend: only the marks this view uses.
  const used = new Set();
  for (const p of pairs) for (const row of p.rows) used.add(row.kind);
  const legend = el('div', { class: 'dv-legend' });
  const key = (cls, text) => legend.append(el('span', {}, el('i', { style: 'background:var(' + cls + ')' }), text));
  legend.append(el('span', {}, el('i', { style: 'background:var(--hl);box-shadow:inset 3px 0 0 var(--warn)' }), 'this finding'));
  if (used.has('del') || used.has('chg')) key('--diff-del', 'removed or changed in base' + (used.has('chg') ? ' (changed text marked)' : ''));
  if (used.has('ins') || used.has('chg')) key('--diff-ins', 'added or changed in revision');
  if (absent) legend.append(el('span', {}, el('i', { style: 'background:var(--diff-gap)' }), absent === 'base' ? 'where it is missing in base' : 'where it was, missing in revision'));
  if (box.querySelector('.dot')) legend.append(el('span', {}, el('span', { class: 'dot', style: 'cursor:default' }), ' another finding (click to open)'));
  wrap.append(legend);
  // Other findings on the highlighted lines.
  const also = [], seen = new Set();
  for (const blocks of [B, R]) for (const blk of blocks) if (blk.hit !== null && blk.hit !== undefined) for (const id of blk.marks[blk.hit] || []) {
    if (own.has(id)) continue;
    const node = rowNode.get(id); if (!node || seen.has(node)) continue;
    seen.add(node); also.push(byId.get(id));
  }
  if (also.length) {
    const a = el('div', { class: 'also' }, el('span', { class: 'muted' }, 'Also on this line:'));
    also.forEach((o, i) => { if (i) a.append(' · '); a.append(findingLink(o, true)); });
    wrap.append(a);
  }
  // Start with the change in view.
  requestAnimationFrame(() => {
    const c = box.querySelector('.c.hit') || box.querySelector('.c.gap'); if (!c) return;
    const r = c.getBoundingClientRect(), bx = box.getBoundingClientRect();
    if (r.bottom > bx.bottom - 10) box.scrollTop += r.top - bx.top - top.offsetHeight - 60;
  });
  return wrap;
}
`;

// The look shared by every HTML report (review, summary, changelog, audit,
// explore and the history timeline): colour tokens, type, the top bar, the
// theme switch, severity pills, cards, tables and form controls.
//
// Dark is the default. The switch in the top bar is a checkbox, so it works
// with CSS alone (`:root:has(#theme-light:checked)`) in the static reports,
// which have no scripts; the explore and timeline pages also remember the
// choice in the browser (THEME_SCRIPT). See the decision record
// "HTML reports: shared theme, dark by default".

/** Light and dark colour tokens. Dark applies unless the theme switch is on. */
const TOKENS = `
:root { color-scheme: dark;
  --bg:#0b0d12; --bg-elev:#10131a; --surface:#141821; --surface-2:#1a1f2a; --surface-3:#222836;
  --border:#252b37; --border-strong:#343c4c; --fg:#e8eaf0; --fg-2:#b9c0cd; --muted:#8a92a3;
  --accent:#8fa2ff; --accent-bg:rgba(143,162,255,.13); --accent-line:rgba(143,162,255,.45);
  --error:#ff7b7b; --error-bg:rgba(255,99,99,.12); --warn:#f4c152; --warn-bg:rgba(244,193,82,.12);
  --info:#6db7ff; --info-bg:rgba(109,183,255,.12); --ok:#4fd88a; --ok-bg:rgba(79,216,138,.12);
  --hl:rgba(244,193,82,.13); --code-bg:#0d1016;
  --diff-del:rgba(255,99,99,.10); --diff-ins:rgba(79,216,138,.09); --diff-del-x:rgba(255,99,99,.34); --diff-ins-x:rgba(79,216,138,.32); --diff-gap:rgba(244,193,82,.07);
  --shadow:0 1px 2px rgba(0,0,0,.35), 0 10px 28px -16px rgba(0,0,0,.6); }
:root:has(#theme-light:checked) { color-scheme: light;
  --bg:#f5f6f9; --bg-elev:#ffffff; --surface:#ffffff; --surface-2:#f3f5f8; --surface-3:#e9ecf1;
  --border:#e1e5ec; --border-strong:#cbd1db; --fg:#151821; --fg-2:#3c4351; --muted:#5f6878;
  --accent:#4357d6; --accent-bg:rgba(67,87,214,.09); --accent-line:rgba(67,87,214,.4);
  --error:#c22f2a; --error-bg:#fdeceb; --warn:#8a5a00; --warn-bg:#fcf2d6;
  --info:#1b67c4; --info-bg:#e5effb; --ok:#17784a; --ok-bg:#e1f4e9;
  --hl:#fff1bd; --code-bg:#fafbfc;
  --diff-del:#fdeeee; --diff-ins:#e8f6ee; --diff-del-x:#f5c0be; --diff-ins-x:#b3e3c5; --diff-gap:#fdf6e1;
  --shadow:0 1px 2px rgba(20,24,33,.05), 0 8px 24px -14px rgba(20,24,33,.18); }
`;

/** Tokens, base type and the components every report uses. */
export const THEME_CSS = `${TOKENS}
* { box-sizing:border-box; }
html { -webkit-text-size-adjust:100%; }
body { margin:0; background:var(--bg); color:var(--fg); font:14.5px/1.55 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing:antialiased; }
a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
code, pre, kbd, .mono { font-family:"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:12.5px; }
:not(pre) > code { background:var(--surface-2); border:1px solid var(--border); border-radius:5px; padding:0 5px; overflow-wrap:anywhere; }
kbd { border:1px solid var(--border-strong); border-bottom-width:2px; border-radius:4px; padding:0 5px; font-size:11px; color:var(--muted); }
.muted { color:var(--muted); }
::selection { background:var(--accent-bg); }
:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }

/* Top bar: brand, report name, theme switch */
.topbar { display:flex; align-items:center; gap:10px; height:52px; padding:0 20px; border-bottom:1px solid var(--border); background:var(--bg-elev); }
.brand { display:flex; align-items:center; gap:8px; font-weight:650; letter-spacing:-.01em; }
.brand svg { color:var(--accent); }
.crumb { color:var(--muted); font-weight:500; } .crumb::before { content:"/"; margin:0 8px 0 2px; color:var(--border-strong); }
.spacer { flex:1; }
.theme-toggle { display:inline-flex; align-items:center; gap:6px; height:30px; padding:0 10px; border:1px solid var(--border); border-radius:8px; background:var(--surface); color:var(--fg-2); font-size:12.5px; cursor:pointer; user-select:none; }
.theme-toggle:hover { border-color:var(--border-strong); color:var(--fg); }
:root:has(#theme-light:focus-visible) .theme-toggle { outline:2px solid var(--accent); outline-offset:2px; }
.theme-toggle .to-dark, :root:has(#theme-light:checked) .theme-toggle .to-light { display:none; }
:root:has(#theme-light:checked) .theme-toggle .to-dark { display:inline-flex; }
.theme-toggle span { display:inline-flex; align-items:center; gap:6px; }

/* Severity pills */
.sev { --c:var(--muted); --cbg:var(--surface-2); display:inline-flex; align-items:center; justify-content:center; gap:6px; min-width:66px; height:22px; padding:0 9px 0 8px; border-radius:999px; font-size:11px; font-weight:650; letter-spacing:.05em; text-transform:uppercase; color:var(--c); background:var(--cbg); box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--c) 28%, transparent); white-space:nowrap; }
.sev::before { content:""; width:6px; height:6px; border-radius:50%; background:currentColor; flex:none; }
.sev.error { --c:var(--error); --cbg:var(--error-bg); } .sev.warn { --c:var(--warn); --cbg:var(--warn-bg); } .sev.info { --c:var(--info); --cbg:var(--info-bg); } .sev.ok { --c:var(--ok); --cbg:var(--ok-bg); }

/* Disclosure cards */
details > summary { list-style:none; cursor:pointer; }
details > summary::-webkit-details-marker { display:none; }
.chev { flex:none; width:16px; height:16px; color:var(--muted); transition:transform .15s ease; }
details[open] > summary .chev { transform:rotate(90deg); }

/* Form controls */
input[type=search], input[type=text], select { height:32px; padding:0 10px; border:1px solid var(--border); border-radius:8px; background:var(--surface); color:var(--fg); font:inherit; font-size:13px; }
input[type=search]:hover, select:hover { border-color:var(--border-strong); }
input[type=search]:focus, select:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-bg); }
button.btn { height:30px; padding:0 10px; border:1px solid var(--border); border-radius:8px; background:var(--surface); color:var(--fg-2); font:inherit; font-size:12.5px; cursor:pointer; }
button.btn:hover { border-color:var(--border-strong); color:var(--fg); }
@media (prefers-reduced-motion: reduce) { * { transition:none !important; } }
`;

/** The hidden checkbox behind the theme switch; the first thing in <body>. */
export const THEME_INPUT = '<input type="checkbox" id="theme-light" class="sr-only" aria-label="Light theme">';

const LOGO = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v14"/><path d="M5 10h14"/><path d="M5 21h14"/></svg>';
const SUN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

/** A chevron for <summary>, turned when its <details> is open. */
export const CHEVRON = '<svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>';

/** The bar at the top of every report. `report` is static text (the report's name). */
export function topbar(report: string): string {
  return `<header class="topbar"><div class="brand">${LOGO}api-diff</div><span class="crumb">${report}</span><span class="spacer"></span><label for="theme-light" class="theme-toggle" title="Switch between dark and light"><span class="to-light">${SUN}Light</span><span class="to-dark">${MOON}Dark</span></label></header>`;
}

/** For pages with a script: remembers the theme switch in the browser (storage can throw, so every use is guarded). */
export const THEME_SCRIPT = `
(() => {
  const t = document.getElementById('theme-light');
  try { t.checked = localStorage.getItem('api-diff-theme') === 'light'; } catch (e) {}
  t.addEventListener('change', () => { try { localStorage.setItem('api-diff-theme', t.checked ? 'light' : 'dark'); } catch (e) {} });
})();
`;

# HTML reports: shared theme, dark by default

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-24 05:37 UTC |
| **Summary** | Every HTML report (review, summary, changelog, audit, explore, history timeline) uses one theme from `src/render/theme.ts`: dark by default, with a light switch in a top bar that works without scripts; static reports gain a hero header, count tiles and a section nav, and explore gains filter chips, expand/collapse, an empty state and a `/` shortcut. |
| **Milestone** | — |

## Background

The HTML reports each had their own copy of a GitHub-like stylesheet that followed the viewer's light or dark setting. They looked plain, the headers were dense lines of text, and a reader had no way to choose the theme. We were asked for a more modern design, better UX and a dark theme.

The static reports (review, summary, changelog, audit) must stay one file with no scripts or network ([report settings](2026-11-22T0701-report-settings.md)); explore and the timeline have one inline script each.

## Alternatives considered

- **Keep following the OS setting (`prefers-color-scheme`) and only restyle**: no visible choice for the reader, and "a dark theme" was asked for explicitly.
- **Theme switch in JavaScript**: would break the no-scripts rule for the static reports.
- **Dark by default with a CSS-only switch (chosen)**: a hidden checkbox and `:root:has(#theme-light:checked)` swap the colour tokens. Explore and the timeline also remember the choice in `localStorage` (guarded, as their other storage use). In browsers without `:has()` the page stays dark.
- **A web font (Inter, JetBrains Mono) from a CDN**: no network allowed; the font stacks name them first and fall back to system fonts.

## Decision

- `src/render/theme.ts` holds the colour tokens (dark default, light override), base type, the top bar (`api-diff / <report>` and the Light/Dark switch), severity pills, disclosure chevrons and form controls. Every HTML renderer builds on `THEME_CSS`.
- Static reports: a hero with the title and a state badge (Breaking / Compatible / No changes), base and revision as two cards, version advice as a callout, count tiles (findings, error, warn, info, acknowledged), a section nav with counts when there is more than one section, cards with a severity edge, and tables in rounded containers. Text and markup the tests and readers rely on (headings, counts line, finding IDs) are unchanged.
- Changelog entries are coloured by kind (added, changed, deprecated, removed; breaking stays red).
- Explore: severity and kind filters as chips, a search box with a `/` shortcut, Expand groups / Collapse all buttons, an empty state with Reset filters, and code panes with a highlighted changed line. The filter bar stops being sticky on narrow screens.
- Timeline: steps on a line in a card, tags as accent markers, step cards like the other reports, and the `/` shortcut.

## Impacts

- `src/render/html.ts`, `explore.ts`, `timeline.ts` and the new `theme.ts`; the HTML test checks for the theme switch instead of `prefers-color-scheme`.
- Supersedes the "light and dark themes" wording in [report settings](2026-11-22T0701-report-settings.md): themes are now dark by default with a switch.
- Custom HTML templates (POLICY.md section 10) are unaffected.

## References

- PLAN.md section 5 (reports by audience)
- [Report settings](2026-11-22T0701-report-settings.md)

// Report templates (POLICY.md section 10): Mustache templates over a
// report's JSON data (what `--report <name>:json` prints), plus the policy's
// per-rule message and migration-note wording (rules.<id>.message / note).
//
// Mustache renders a missing name as an empty string, so a typo would
// silently drop text. Before rendering, every name in a template is checked
// against the shape of the data it will see (below), including names inside
// sections that happen to be empty in this run, and partials (`{{> x}}`)
// are refused. HTML templates are escaped; txt templates aren't.

import Mustache from 'mustache';
import { suggest } from '../policy/policy.ts';

/** A data shape: `1` a value, `2` anything (any value, list or object), `[shape]` a list, `{ key: shape }` an object, `{ '*': shape }` any keys. */
export type Shape = 1 | 2 | Shape[] | { [key: string]: Shape };

export class TemplateError extends Error {}

const LOCATION: Shape = { file: 1, pointer: 1, line: 1, column: 1, via: [{ file: 1, pointer: 1, line: 1, column: 1 }] };
const SIDE: Shape = { input: 1, file: 1, openapi: 1, version: 1, sha256: 1, commit: 1, title: 1, versionSource: 1, labels: { '*': 1 }, unreadable: 1 };
const BY_SEVERITY: Shape = { error: 1, warn: 1, info: 1 };
export const FINDING: Shape = {
  id: 1, rule: 1, baseRule: 1, direction: 1, kind: 1, severity: 1, severitySource: 1, subject: 1, message: 1, note: 1,
  base: LOCATION, revision: LOCATION, details: { '*': 2 }, impact: [1], owners: [1], exclusions: [1],
  acknowledged: { reason: 1, owner: 1, expires: 1, file: 1 },
};
const COUNTS: Shape = { total: 1, bySeverity: BY_SEVERITY, byKind: { wire: 1, sdk: 1, docs: 1 }, byRule: { '*': 1 }, acknowledged: 1 };
const COMPARED: Shape = { base: SIDE, revision: SIDE };
const BLOCK = { pointer: 1, start: 1, end: 1, line: 1 } as const;
const SNIPPET: Shape = { file: 1, start: 1, line: 1, lines: [1], path: [{ key: 1, line: 1, label: 1 }], scope: BLOCK, ref: { ...BLOCK, file: 1, name: 1, isNew: 1 }, via: [{ file: 1, line: 1, name: 1, path: [{ key: 1, line: 1, label: 1 }], scope: BLOCK }], scopeIsNew: 1, absent: 1 };
const SOURCE_LINES: Shape = { '*': { '*': 1 } };
const RESULT: Shape = {
  schemaVersion: 1, tool: { name: 1, version: 1 }, profile: 1, compared: COMPARED, state: 1, counts: COUNTS,
  advice: { needed: 1, actual: 1, ok: 1, because: 1, breaking: 1 }, policy: { file: 1, sha256: 1 },
  snippets: { '*': { base: SNIPPET, revision: SNIPPET } }, sourceLines: { base: SOURCE_LINES, revision: SOURCE_LINES }, operations: { '*': { operationId: 1, tags: [1], summary: 1, owners: [1] } },
  uses: { file: 1, operations: [1], unmatched: [1] }, findings: [FINDING],
};
const ENTRY: Shape = { kind: 1, breaking: 1, text: 1, note: 1, rule: 1, id: 1 };
const SDK_GROUP: Shape = { name: 1, operation: 1, changes: [{ severity: 1, text: 1, rule: 1, id: 1, directions: [{ direction: 1, severity: 1, rule: 1, id: 1 }] }] };

/** The data each built-in report's template sees, by report. */
export const SHAPES: Record<string, Shape> = {
  review: RESULT,
  ci: RESULT,
  summary: {
    report: 1, compared: COMPARED, state: 1, advice: (RESULT as Record<string, Shape>).advice!, byKindAndSeverity: { wire: BY_SEVERITY, sdk: BY_SEVERITY, docs: BY_SEVERITY },
    places: { total: 1, breaking: 1 }, operationsAffected: 1, acknowledged: 1, notices: 1, top: [FINDING],
  },
  changelog: {
    report: 1, title: 1, from: 1, to: 1, advice: 1, breaking: 1, uses: { file: 1, changes: 1 },
    tags: [{ tag: 1, operations: [{ operation: 1, summary: 1, entries: [ENTRY] }] }], components: [{ component: 1, operations: [1], entries: [ENTRY] }],
  },
  sdk: { report: 1, title: 1, from: 1, to: 1, bump: 1, breaking: 1, renames: [{ what: 1, from: 1, to: 1, where: 1 }], methods: [SDK_GROUP], types: [SDK_GROUP] },
  audit: {
    report: 1, tool: { name: 1, version: 1 }, profile: 1, compared: COMPARED, policy: { file: 1, sha256: 1 }, state: 1, advice: 1, counts: COUNTS, groupBy: 1,
    groups: [{ key: 1, severity: 1, count: 1, findings: [1] }], severitySources: [{ source: 1, count: 1 }],
    acknowledgements: { active: [{ finding: 1, rule: 1, subject: 1, severity: 1, owner: 1, reason: 1, expires: 1 }], expired: [1], stale: [1], notOwner: [1] },
    unclassified: [1], notCompared: [1], exclusions: [{ set: 1, findings: 1, hiddenBy: [1] }], owners: [{ owner: 1, findings: 1, error: 1, warn: 1, info: 1 }], findings: [FINDING],
  },
};

type Token = [string, string, number, number, Token[]?, ...unknown[]];

const keysOf = (s: Shape): string[] => (typeof s === 'object' && !Array.isArray(s) ? Object.keys(s) : []);

/** The shape a (possibly dotted) name resolves to in one context, or undefined. */
function resolveIn(s: Shape, parts: string[]): Shape | undefined {
  let cur: Shape | undefined = s;
  for (const p of parts) {
    if (cur === 2) return 2;
    if (cur === undefined || cur === 1) return undefined;
    if (Array.isArray(cur)) {
      if (p !== 'length') return undefined;
      cur = 1;
    } else cur = p in cur ? cur[p] : '*' in cur ? cur['*'] : undefined;
  }
  return cur;
}

const lineOf = (text: string, at: number): number => text.slice(0, at).split('\n').length;

/**
 * Checks every name in a template against `shape`, as Mustache looks names
 * up: innermost section first, then outwards. Throws a TemplateError naming
 * the line and the closest known name.
 */
export function checkTemplate(text: string, shape: Shape, what: string): void {
  let tokens: Token[];
  try {
    tokens = Mustache.parse(text) as Token[];
  } catch (e) {
    throw new TemplateError(`${what}: ${(e as Error).message}`);
  }
  const walk = (ts: Token[], stack: Shape[]): void => {
    for (const t of ts) {
      const [type, name, start] = t;
      if (type === '>') throw new TemplateError(`${what} line ${lineOf(text, start)}: partials ({{> ${name}}}) aren't supported; put everything in one template`);
      if (type !== 'name' && type !== '&' && type !== '#' && type !== '^') continue;
      let found: Shape | undefined = name === '.' ? stack[stack.length - 1] : undefined;
      if (name !== '.') for (let i = stack.length - 1; i >= 0 && found === undefined; i--) found = resolveIn(stack[i]!, name.split('.'));
      if (found === undefined) {
        const known = [...new Set(stack.flatMap(keysOf))].filter((k) => k !== '*');
        throw new TemplateError(`${what} line ${lineOf(text, start)}: '${name}' is not in the data here${suggest(name.split('.').pop()!, known)}; available: ${known.join(', ')}`);
      }
      if (type === '#') walk(t[4] ?? [], [...stack, Array.isArray(found) ? found[0]! : found]);
      else if (type === '^') walk(t[4] ?? [], stack);
    }
  };
  walk(tokens, [shape]);
}

/** The same escaping as the built-in HTML reports (Mustache's own also escapes `/`, `=` and backticks). */
const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** Renders a checked template. HTML output escapes values; txt output doesn't. */
export function renderTemplate(text: string, data: unknown, format: 'html' | 'txt'): string {
  return Mustache.render(text, data, {}, { escape: format === 'html' ? escapeHtml : (s: string) => s });
}

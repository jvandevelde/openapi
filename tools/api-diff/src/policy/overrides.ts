// Policy `overrides` (POLICY.md section 5): severity changes for matching
// parts of the spec. Checked in order; the last match wins. They apply per
// operation: a finding that affects several operations (a shared component,
// or a bulk change) can get a different severity for each, and is split.

import { PolicyError } from './errors.ts';
import { componentName, type OperationInfo, type SpecContext } from './context.ts';
import type { RuleSetting, RuleSeverity } from './policy.ts';
import type { Direction, Kind } from '../types.ts';

export interface OverrideMatch {
  path?: RegExp[];
  method?: string[];
  operationId?: RegExp[];
  tag?: string[];
  stability?: string[];
  extension?: Record<string, unknown[]>;
  component?: RegExp[];
  direction?: Direction;
  kind?: Kind[];
  rule?: RegExp[];
}

export interface Override {
  /** 1-based position in the file, for severity provenance. */
  index: number;
  /** The `match` as written, for messages, e.g. `path /legacy/**`. */
  label: string;
  match: OverrideMatch;
  severity?: RuleSeverity;
  rules?: Map<string, RuleSetting>;
}

const MATCH_KEYS = ['path', 'method', 'operationId', 'tag', 'stability', 'extension', 'component', 'direction', 'kind', 'rule'] as const;
const OPERATION_KEYS = ['path', 'method', 'operationId', 'tag', 'stability'] as const;
const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query'];

/**
 * Glob to regular expression. In paths, `*` is one segment and a trailing
 * `/**` is zero or more segments; elsewhere `*` is any text.
 */
export function glob(pattern: string, path = false): RegExp {
  const esc = (s: string): string => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  if (!path) return new RegExp(`^${pattern.split('*').map(esc).join('.*')}$`);
  let re = '';
  for (let i = 0; i < pattern.length; ) {
    if (pattern.startsWith('/**', i) && i + 3 === pattern.length) {
      re += '(?:/.*)?';
      i += 3;
    } else if (pattern.startsWith('**', i)) {
      re += '.*';
      i += 2;
    } else if (pattern[i] === '*') {
      re += '[^/]*';
      i++;
    } else re += esc(pattern[i++]!);
  }
  return new RegExp(`^${re}$`);
}

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [v]);

function strings(v: unknown, where: string): string[] {
  const l = list(v);
  if (l.length === 0 || !l.every((s) => typeof s === 'string' && s !== '')) throw new PolicyError(`${where}: must be text or a list of text`);
  return l as string[];
}

function parseMatch(v: unknown, where: string, suggest: (w: string, c: readonly string[]) => string): { match: OverrideMatch; label: string } {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new PolicyError(`${where}: must be a mapping`);
  const m: OverrideMatch = {};
  const label: string[] = [];
  for (const [k, raw] of Object.entries(v)) {
    const at = `${where}.${k}`;
    switch (k) {
      case 'path':
        m.path = strings(raw, at).map((p) => {
          if (!p.startsWith('/')) throw new PolicyError(`${at}: '${p}' must start with /`);
          return glob(p, true);
        });
        break;
      case 'method':
        m.method = strings(raw, at).map((s) => s.toLowerCase());
        for (const s of m.method) if (!METHODS.includes(s)) throw new PolicyError(`${at}: '${s}' is not an HTTP method`);
        break;
      case 'operationId':
        m.operationId = strings(raw, at).map((s) => glob(s));
        break;
      case 'tag':
        m.tag = strings(raw, at);
        break;
      case 'stability':
        m.stability = strings(raw, at);
        break;
      case 'component':
        m.component = strings(raw, at).map((s) => glob(s));
        break;
      case 'rule':
        m.rule = strings(raw, at).map((s) => glob(s));
        break;
      case 'direction':
        if (raw !== 'in' && raw !== 'out') throw new PolicyError(`${at}: must be in or out`);
        m.direction = raw;
        break;
      case 'kind':
        m.kind = strings(raw, at) as Kind[];
        for (const s of m.kind) if (!['wire', 'sdk', 'docs'].includes(s)) throw new PolicyError(`${at}: must be wire, sdk or docs`);
        break;
      case 'extension': {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length === 0) throw new PolicyError(`${at}: must be a mapping of x- extensions to values`);
        m.extension = {};
        for (const [x, val] of Object.entries(raw)) {
          if (!x.startsWith('x-')) throw new PolicyError(`${at}.${x}: extension names start with x-`);
          m.extension[x] = list(val);
        }
        break;
      }
      default:
        throw new PolicyError(`${at}: unknown match key${suggest(k, MATCH_KEYS)}`);
    }
    label.push(`${k} ${typeof raw === 'object' ? JSON.stringify(raw) : String(raw)}`);
  }
  if (label.length === 0) throw new PolicyError(`${where}: must have at least one key`);
  return { match: m, label: label.join(', ') };
}

/** Validates the `overrides` list. `parseRules` parses an override's `rules` map like the top-level one. */
export function parseOverrides(raw: unknown[], file: string, parseRules: (v: unknown, where: string) => Map<string, RuleSetting>, suggest: (w: string, c: readonly string[]) => string): Override[] {
  return raw.map((entry, i) => {
    const where = `${file}: overrides[${i}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new PolicyError(`${where}: must be a mapping with match and severity or rules`);
    const e = entry as Record<string, unknown>;
    for (const k of Object.keys(e)) if (!['match', 'severity', 'rules'].includes(k)) throw new PolicyError(`${where}.${k}: unknown key${suggest(k, ['match', 'severity', 'rules'])}`);
    if (e.match === undefined) throw new PolicyError(`${where}: needs match`);
    if ((e.severity === undefined) === (e.rules === undefined)) throw new PolicyError(`${where}: set either severity or rules, not both`);
    const { match, label } = parseMatch(e.match, `${where}.match`, suggest);
    const o: Override = { index: i + 1, label, match };
    if (e.severity !== undefined) {
      if (typeof e.severity !== 'string' || !['error', 'warn', 'info', 'off'].includes(e.severity)) throw new PolicyError(`${where}.severity: must be one of error, warn, info, off`);
      o.severity = e.severity as RuleSeverity;
    } else o.rules = parseRules(e.rules, `${where}.rules`);
    return o;
  });
}

/** What a finding is about, for matching. `op` is one affected operation, if any. */
export interface MatchTarget {
  rule: string;
  baseRule: string;
  kind: Kind;
  direction: Direction | undefined;
  subject: string;
  op: OperationInfo | undefined;
}

function hasExtension(want: Record<string, unknown[]>, ...sources: Record<string, unknown>[]): boolean {
  return Object.entries(want).every(([x, values]) => sources.some((s) => x in s && values.some((v) => JSON.stringify(v) === JSON.stringify(s[x]))));
}

export function matches(m: OverrideMatch, t: MatchTarget, ctx: SpecContext): boolean {
  const usesOperation = OPERATION_KEYS.some((k) => m[k] !== undefined);
  if (usesOperation && !t.op) return false;
  const op = t.op;
  if (m.path && !m.path.some((r) => r.test(op!.path))) return false;
  if (m.method && !m.method.includes(op!.method.toLowerCase())) return false;
  if (m.operationId && !(op!.operationId !== undefined && m.operationId.some((r) => r.test(op!.operationId!)))) return false;
  if (m.tag && !op!.tags.some((t) => m.tag!.includes(t))) return false;
  if (m.stability && !m.stability.includes(op!.stability)) return false;
  const component = componentName(t.subject);
  if (m.component && !(component !== undefined && m.component.some((r) => r.test(component)))) return false;
  if (m.direction && t.direction !== m.direction) return false;
  if (m.kind && !m.kind.includes(t.kind)) return false;
  if (m.rule && !m.rule.some((r) => r.test(t.rule) || r.test(t.baseRule))) return false;
  if (m.extension) {
    const sources = [op?.extensions ?? {}, (component !== undefined && ctx.components.get(component)) || {}, ctx.document];
    if (!hasExtension(m.extension, ...sources)) return false;
  }
  return true;
}

// Policy `reports` (POLICY.md section 10): settings for the built-in report
// presets, and custom reports. Every documented key is validated now; the
// reports and keys that arrive later (changelog, sdk, audit, explore,
// custom reports, templates, grouping other than the preset's, and
// include.extensions) are accepted in the file but refused when such a
// report is produced, so configuring them early is harmless.

import { componentName, type SpecContext } from '../policy/context.ts';
import { PolicyError } from '../policy/errors.ts';
import type { OwnerIndex } from '../policy/owners.ts';
import type { Finding, Kind, Result, Severity } from '../types.ts';
import { isChange } from './common.ts';

export const BUILT_IN = ['ci', 'review', 'changelog', 'sdk', 'summary', 'audit', 'explore'] as const;
const KEYS = ['exclude', 'include', 'group-by', 'format', 'template', 'extends', 'explorer-url'] as const;
const INCLUDE_KEYS = ['kinds', 'min-severity', 'extensions', 'owners'] as const;
const GROUP_BY = ['severity', 'root-cause', 'tag', 'operation', 'rule', 'owner'] as const;

export interface ReportConfig {
  exclude?: string[];
  include?: { kinds?: Kind[]; minSeverity?: Severity; extensions?: Record<string, unknown[]>; owners?: string[] };
  groupBy?: (typeof GROUP_BY)[number];
  format?: 'json' | 'txt' | 'html';
  template?: string;
  extends?: string;
  /** explore and the history timeline: link each finding into the spec explorer. `{pointer}` (required), `{file}` and `{side}` are filled in. */
  explorerUrl?: string;
}

const RANK: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

function strings(v: unknown, where: string): string[] {
  if (!Array.isArray(v) || !v.every((s) => typeof s === 'string' && s !== '')) throw new PolicyError(`${where}: must be a list of text`);
  return v as string[];
}

export function parseReports(raw: Record<string, unknown>, where: string, exclusionSets: readonly string[], suggest: (w: string, c: readonly string[]) => string): Map<string, ReportConfig> {
  const out = new Map<string, ReportConfig>();
  for (const [name, v] of Object.entries(raw)) {
    const at = `${where}.${name}`;
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new PolicyError(`${at}: must be a mapping`);
    const cfg: ReportConfig = {};
    for (const [k, val] of Object.entries(v)) {
      const w = `${at}.${k}`;
      switch (k) {
        case 'exclude':
          cfg.exclude = strings(val, w);
          for (const s of cfg.exclude) if (!exclusionSets.includes(s)) throw new PolicyError(`${w}: '${s}' is not an exclusion set${suggest(s, exclusionSets)}`);
          break;
        case 'include': {
          if (val === null || typeof val !== 'object' || Array.isArray(val)) throw new PolicyError(`${w}: must be a mapping with kinds, min-severity or extensions`);
          cfg.include = {};
          for (const [ik, iv] of Object.entries(val)) {
            if (ik === 'kinds') {
              cfg.include.kinds = strings(iv, `${w}.kinds`) as Kind[];
              for (const kd of cfg.include.kinds) if (!['wire', 'sdk', 'docs'].includes(kd)) throw new PolicyError(`${w}.kinds: must be wire, sdk or docs`);
            } else if (ik === 'min-severity') {
              if (iv !== 'error' && iv !== 'warn' && iv !== 'info') throw new PolicyError(`${w}.min-severity: must be error, warn or info`);
              cfg.include.minSeverity = iv;
            } else if (ik === 'extensions') {
              if (iv === null || typeof iv !== 'object' || Array.isArray(iv) || Object.keys(iv).length === 0 || !Object.keys(iv).every((x) => x.startsWith('x-'))) throw new PolicyError(`${w}.extensions: must be a mapping of x- extensions to values`);
              cfg.include.extensions = Object.fromEntries(Object.entries(iv).map(([x, vs]) => [x, Array.isArray(vs) ? vs : [vs]]));
            } else if (ik === 'owners') {
              cfg.include.owners = typeof iv === 'string' ? [iv] : strings(iv, `${w}.owners`);
            } else throw new PolicyError(`${w}.${ik}: unknown key${suggest(ik, INCLUDE_KEYS)}`);
          }
          break;
        }
        case 'group-by':
          if (!(GROUP_BY as readonly unknown[]).includes(val)) throw new PolicyError(`${w}: must be one of ${GROUP_BY.join(', ')}`);
          cfg.groupBy = val as ReportConfig['groupBy'];
          break;
        case 'format':
          if (val !== 'json' && val !== 'txt' && val !== 'html') throw new PolicyError(`${w}: must be json, txt or html`);
          cfg.format = val;
          break;
        case 'template':
          if (typeof val !== 'string' || val === '') throw new PolicyError(`${w}: must be a file path`);
          cfg.template = val;
          break;
        case 'explorer-url':
          cfg.explorerUrl = explorerUrl(val, w);
          break;
        case 'extends':
          if (typeof val !== 'string') throw new PolicyError(`${w}: must name a report`);
          cfg.extends = val;
          break;
        default:
          throw new PolicyError(`${w}: unknown key${suggest(k, KEYS)}`);
      }
    }
    out.set(name, cfg);
  }
  for (const [name, cfg] of out) {
    if (cfg.extends !== undefined && !(BUILT_IN as readonly string[]).includes(cfg.extends) && !out.has(cfg.extends)) throw new PolicyError(`${where}.${name}.extends: '${cfg.extends}' is not a report${suggest(cfg.extends, [...BUILT_IN, ...out.keys()])}`);
    if ((BUILT_IN as readonly string[]).includes(name) && cfg.extends !== undefined) throw new PolicyError(`${where}.${name}.extends: built-in reports can't extend others; make a custom report instead`);
    if (!(BUILT_IN as readonly string[]).includes(name) && cfg.extends === undefined) throw new PolicyError(`${where}.${name}: a custom report needs extends: the report it starts from (${BUILT_IN.join(', ')}, or another custom report)`);
    if (cfg.template !== undefined && cfg.format !== 'html' && cfg.format !== 'txt') throw new PolicyError(`${where}.${name}.template: set format: html or txt as well, the format the template writes`);
    const seen = new Set([name]);
    for (let c = cfg; c.extends !== undefined; c = out.get(c.extends) ?? {}) {
      if (seen.has(c.extends)) throw new PolicyError(`${where}.${name}.extends: reports extend each other in a loop (${[...seen, c.extends].join(' → ')})`);
      seen.add(c.extends);
    }
  }
  return out;
}

/**
 * A report's effective settings: a custom report starts from the report it
 * extends (and that one's settings), then overrides them key by key;
 * `include` is merged key by key too. Returns the built-in report it is
 * based on.
 */
export function resolveReport(name: string, reports: Map<string, ReportConfig>): { base: (typeof BUILT_IN)[number]; cfg: ReportConfig | undefined } {
  const chain: ReportConfig[] = [];
  let at = name;
  while (!(BUILT_IN as readonly string[]).includes(at)) {
    const c = reports.get(at);
    if (!c?.extends) throw new PolicyError(`report '${name}' is not a built-in report or a custom report in the policy`);
    chain.unshift(c);
    at = c.extends;
  }
  const own = reports.get(at);
  if (own) chain.unshift(own);
  if (!chain.length) return { base: at as (typeof BUILT_IN)[number], cfg: undefined };
  const cfg = chain.reduce<ReportConfig>((acc, c) => {
    const out: ReportConfig = { ...acc, ...c };
    if (acc.include || c.include) out.include = { ...acc.include, ...c.include };
    return out;
  }, {});
  delete cfg.extends;
  return { base: at as (typeof BUILT_IN)[number], cfg };
}

/** Validates an explorer URL template: http(s), with a {pointer} placeholder. */
export function explorerUrl(v: unknown, where: string): string {
  if (typeof v !== 'string' || !/^https?:\/\//.test(v) || !v.includes('{pointer}')) throw new PolicyError(`${where}: must be an http(s) URL template containing {pointer}, e.g. https://explorer.example.com/#{pointer}`);
  return v;
}

/** A link for one side of a finding, or undefined. Placeholders are URL-encoded. */
export function explorerLink(template: string | undefined, side: 'base' | 'revision', loc: { file: string; pointer: string } | undefined): string | undefined {
  if (!template || !loc) return undefined;
  return template.replaceAll('{pointer}', encodeURIComponent(loc.pointer)).replaceAll('{file}', encodeURIComponent(loc.file)).replaceAll('{side}', side);
}

/** The grouping each preset uses. `review` and `audit` can be grouped any way; the others keep theirs. */
export const PRESET_GROUP: Record<string, ReportConfig['groupBy']> = { review: 'root-cause', ci: 'severity', summary: undefined, changelog: 'tag', sdk: 'operation', explore: undefined, audit: 'rule' };
const REGROUPABLE = new Set(['review', 'audit']);

/** Refuses settings a report can't apply, for a report that is being produced. `name` is the built-in report it is or extends. */
export function checkSupported(name: string, cfg: ReportConfig | undefined, label = name): void {
  if (!cfg) return;
  const where = `policy reports.${label}`;
  if (cfg.template && name === 'explore') throw new PolicyError(`${where}.template: the explore report is an interactive page and can't use a template`);
  if (cfg.groupBy !== undefined && cfg.groupBy !== PRESET_GROUP[name] && !REGROUPABLE.has(name)) throw new PolicyError(`${where}.group-by: the ${name} report always groups by ${PRESET_GROUP[name] ?? 'nothing'}; review and audit can be grouped by ${GROUP_BY.join(', ')}`);
  if (name === 'audit' && (cfg.exclude?.length || cfg.include)) throw new PolicyError(`${where}: the audit report always shows everything, so it takes no exclude or include`);
}

/** What the reach filters need about the spec: the engine's context and owners (see `placesOf` in the engine). */
export interface Places {
  ctx: SpecContext;
  owners: OwnerIndex;
}

export interface ViewOptions {
  /** --uses: the operations a consumer calls. */
  uses?: Set<string>;
  places?: Places;
}

interface Reach {
  op(key: string): boolean;
  component(name: string): boolean;
}

/**
 * Keeps a finding if it reaches the places `reach` accepts: its operation;
 * its component; or, through its impact list, one of the operations it
 * affects (the impact list is narrowed to those). Findings about the whole
 * API (no operation, component or impact) reach everyone.
 */
function reachOf(f: Finding, reach: Reach): Finding | undefined {
  if (!isChange(f)) return f;
  if (/^[A-Z]+ \//.test(f.subject) && !f.impact?.length) return reach.op(f.subject) ? f : undefined;
  const c = componentName(f.subject);
  if (c !== undefined && reach.component(c)) return f;
  if (!f.impact?.length) return c === undefined ? f : undefined;
  const impact = f.impact.filter((o) => reach.op(o));
  if (!impact.length) return undefined;
  return impact.length === f.impact.length ? f : { ...f, impact };
}

function extensionsMatch(want: Record<string, unknown[]>, ...sources: Record<string, unknown>[]): boolean {
  return Object.entries(want).every(([x, values]) => sources.some((s) => x in s && values.some((v) => JSON.stringify(v) === JSON.stringify(s[x]))));
}

/**
 * The result as one report sees it: findings in an excluded set, or outside
 * `include`, are left out, and counts and state are recomputed. With
 * `include.extensions`, `include.owners` or --uses, only changes that reach
 * matching operations are kept. Notices and version checks are always kept.
 */
export function viewFor(r: Result, cfg: ReportConfig | undefined, recount: (fs: Finding[]) => Pick<Result, 'counts' | 'state'>, v: ViewOptions = {}): Result {
  const inc = cfg?.include;
  if (!cfg?.exclude?.length && !inc?.kinds && !inc?.minSeverity && !inc?.extensions && !inc?.owners && !v.uses) return r;
  const keep = (f: Finding): boolean => {
    if (!isChange(f)) return true;
    if (cfg?.exclude?.some((s) => f.exclusions?.includes(s))) return false;
    if (inc?.kinds && !inc.kinds.includes(f.kind)) return false;
    if (inc?.minSeverity && RANK[f.severity] > RANK[inc.minSeverity]) return false;
    return true;
  };
  const reaches: Reach[] = [];
  if (v.uses) reaches.push({ op: (o) => v.uses!.has(o), component: () => false });
  const p = v.places;
  if (inc?.extensions) {
    const want = inc.extensions;
    const doc = p?.ctx.document ?? {};
    reaches.push({ op: (o) => extensionsMatch(want, p?.ctx.operations.get(o)?.extensions ?? {}, doc), component: (c) => extensionsMatch(want, p?.ctx.components.get(c) ?? {}, doc) });
  }
  if (inc?.owners) {
    const want = new Set(inc.owners);
    reaches.push({ op: (o) => (p?.owners.operation(o) ?? r.operations?.[o]?.owners ?? []).some((x) => want.has(x)), component: (c) => (p?.owners.component(c) ?? []).some((x) => want.has(x)) });
  }
  const findings: Finding[] = [];
  for (const f of r.findings) {
    if (!keep(f)) continue;
    let g: Finding | undefined = f;
    for (const reach of reaches) if (g) g = reachOf(g, reach);
    if (g) findings.push(g);
  }
  return { ...r, ...recount(findings), findings };
}

/** A --uses entry: `GET /orders/{id}` (any parameter names) or an operationId. */
const opKey = (method: string, path: string): string => `${method.toUpperCase()} ${path.replace(/\{[^}]*\}/g, '{}')}`;

/**
 * Reads a --uses file: one operation per line, as `METHOD /path` or an
 * operationId; blank lines and `#` comments are skipped. Returns the
 * matching operation keys and the entries that matched nothing.
 */
export function resolveUses(text: string, ctx: SpecContext | undefined): { operations: string[]; unmatched: string[] } {
  const byKey = new Map<string, string[]>();
  const byId = new Map<string, string[]>();
  for (const [key, op] of ctx?.operations ?? []) {
    const k = opKey(op.method, op.path);
    byKey.set(k, [...(byKey.get(k) ?? []), key]);
    if (op.operationId) byId.set(op.operationId, [...(byId.get(op.operationId) ?? []), key]);
  }
  const found = new Set<string>();
  const unmatched: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z]+)\s+(\/\S*)$/.exec(line);
    const keys = m ? byKey.get(opKey(m[1]!, m[2]!.replace(/\?.*$/, ''))) : byId.get(line);
    if (keys) for (const k of keys) found.add(k);
    else unmatched.push(line);
  }
  return { operations: [...found].sort(), unmatched };
}

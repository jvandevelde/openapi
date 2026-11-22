// Policy `reports` (POLICY.md section 10): settings for the built-in report
// presets, and custom reports. Every documented key is validated now; the
// reports and keys that arrive later (changelog, sdk, audit, explore,
// custom reports, templates, grouping other than the preset's, and
// include.extensions) are accepted in the file but refused when such a
// report is produced, so configuring them early is harmless.

import { PolicyError } from '../policy/errors.ts';
import type { Finding, Kind, Result, Severity } from '../types.ts';
import { isChange } from './common.ts';

export const BUILT_IN = ['ci', 'review', 'changelog', 'sdk', 'summary', 'audit', 'explore'] as const;
const KEYS = ['exclude', 'include', 'group-by', 'format', 'template', 'extends', 'explorer-url'] as const;
const INCLUDE_KEYS = ['kinds', 'min-severity', 'extensions'] as const;
const GROUP_BY = ['severity', 'root-cause', 'tag', 'operation', 'rule', 'owner'] as const;

export interface ReportConfig {
  exclude?: string[];
  include?: { kinds?: Kind[]; minSeverity?: Severity; extensions?: Record<string, unknown> };
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
              if (iv === null || typeof iv !== 'object' || Array.isArray(iv) || !Object.keys(iv).every((x) => x.startsWith('x-'))) throw new PolicyError(`${w}.extensions: must be a mapping of x- extensions to values`);
              cfg.include.extensions = iv as Record<string, unknown>;
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
    const seen = new Set([name]);
    for (let c = cfg; c.extends !== undefined; c = out.get(c.extends) ?? {}) {
      if (seen.has(c.extends)) throw new PolicyError(`${where}.${name}.extends: reports extend each other in a loop (${[...seen, c.extends].join(' → ')})`);
      seen.add(c.extends);
    }
  }
  return out;
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

/** The grouping each preset uses; another value arrives with custom grouping in M9. */
const PRESET_GROUP: Record<string, ReportConfig['groupBy']> = { review: 'root-cause', ci: 'severity', summary: undefined, changelog: 'tag', sdk: 'operation', explore: undefined };

/** Refuses settings this version can't apply yet, for a report that is being produced. */
export function checkSupported(name: string, cfg: ReportConfig | undefined): void {
  if (!cfg) return;
  const where = `policy reports.${name}`;
  if (cfg.template) throw new PolicyError(`${where}.template: report templates arrive in M9`);
  if (cfg.include?.extensions) throw new PolicyError(`${where}.include.extensions: filtering reports by extension arrives in M9`);
  if (cfg.groupBy !== undefined && cfg.groupBy !== PRESET_GROUP[name]) throw new PolicyError(`${where}.group-by: the ${name} report groups by ${PRESET_GROUP[name] ?? 'nothing'}; other grouping arrives in M9`);
}

/**
 * The result as one report sees it: findings in an excluded set, or outside
 * `include`, are left out, and counts and state are recomputed. Notices and
 * version checks are always kept.
 */
export function viewFor(r: Result, cfg: ReportConfig | undefined, recount: (fs: Finding[]) => Pick<Result, 'counts' | 'state'>): Result {
  if (!cfg?.exclude?.length && !cfg?.include?.kinds && !cfg?.include?.minSeverity) return r;
  const keep = (f: Finding): boolean => {
    if (!isChange(f)) return true;
    if (cfg.exclude?.some((s) => f.exclusions?.includes(s))) return false;
    if (cfg.include?.kinds && !cfg.include.kinds.includes(f.kind)) return false;
    if (cfg.include?.minSeverity && RANK[f.severity] > RANK[cfg.include.minSeverity]) return false;
    return true;
  };
  const findings = r.findings.filter(keep);
  return { ...r, ...recount(findings), findings };
}

// Rule metadata: the single source of truth for rule IDs, kinds, default
// severities and messages. RULES.md documents the same rules; `api-diff rules`
// prints them from here.

import type { Change, Kind, Severity } from '../types.ts';

/** Milestone in which a rule is implemented (see PLAN.md section 6). */
export type Milestone = 3 | 4 | 5 | 6 | 8;

/** The milestone the code currently implements. */
export const CURRENT_MILESTONE = 4;

export interface RuleMeta {
  id: string;
  /** RULES.md section number. */
  section: number;
  kind: Kind;
  title: string;
  /**
   * Default severity. For rules with direction variants, `in` and `out`
   * give the request and response defaults.
   */
  severity: Severity | { in: Severity; out: Severity };
  /** Severity under `--profile sdk`, when it differs from the default. */
  sdkProfile?: Severity;
  /** `location`: has query-/header-/cookie- variants. `direction`: has -in-request/-in-response variants. */
  variants?: 'location' | 'direction';
  milestone: Milestone;
  /** A severity that depends on the change's details, e.g. a removed required header. */
  conditional?: (c: Change) => Severity | undefined;
  /** One-line message for a change. */
  message: (c: Change) => string;
}

const d = (c: Change, k: string): string => String(c.details[k] ?? '');
const loc = (c: Change): string => (c.location ? `${c.location} ` : '');
const list = (v: unknown): string => (Array.isArray(v) ? v.map((x) => `'${x}'`).join(', ') : `'${String(v)}'`);

const R: RuleMeta[] = [];
const rule = (m: RuleMeta): void => {
  R.push(m);
};

// 1. Core variance rules
rule({ id: 'schema-narrowed', section: 1, kind: 'wire', title: 'The schema accepts fewer values', severity: { in: 'error', out: 'info' }, variants: 'direction', milestone: 5, message: () => 'schema accepts fewer values' });
rule({ id: 'schema-widened', section: 1, kind: 'wire', title: 'The schema accepts more values', severity: { in: 'info', out: 'warn' }, variants: 'direction', milestone: 5, message: () => 'schema accepts more values' });
rule({ id: 'schema-incompatible', section: 1, kind: 'wire', title: 'The schema is neither a subset nor a superset', severity: { in: 'error', out: 'error' }, variants: 'direction', milestone: 5, message: () => 'schema changed incompatibly' });
rule({ id: 'unclassified-change', section: 1, kind: 'wire', title: 'The shape changed but no rule matched', severity: 'warn', milestone: 4, message: (c) => {
  const changed = Array.isArray(c.details.changed) ? (c.details.changed as string[]) : [];
  const shown = changed.slice(0, 4).join(', ') + (changed.length > 4 ? `, … (${changed.length} in all)` : '');
  const where = d(c, 'where') === c.subject ? 'schema' : `${d(c, 'where')} schema`;
  return `${where} changed at ${shown || '/'} (no rule classifies this change yet)`;
} });

// 2. Paths and operations
rule({ id: 'operation-added', section: 2, kind: 'wire', title: 'New operation', severity: 'info', milestone: 3, message: () => 'operation added' });
rule({ id: 'operation-removed', section: 2, kind: 'wire', title: "Operation removed without enough deprecation", severity: 'error', milestone: 3, message: () => 'operation removed' });
rule({ id: 'operation-removed-after-deprecation', section: 2, kind: 'wire', title: 'Operation removed after the deprecation period', severity: 'info', milestone: 6, message: () => 'operation removed after its deprecation period' });
rule({ id: 'operation-id-changed', section: 2, kind: 'sdk', title: 'operationId changed', severity: 'info', sdkProfile: 'error', milestone: 3, message: (c) => `operationId changed from '${d(c, 'from') || '(none)'}' to '${d(c, 'to') || '(none)'}'` });
rule({ id: 'path-param-renamed', section: 2, kind: 'sdk', title: 'Path parameter renamed (same endpoint)', severity: 'info', sdkProfile: 'warn', milestone: 3, message: (c) => `path parameter '${d(c, 'from')}' renamed to '${d(c, 'to')}'` });
rule({ id: 'operation-path-changed', section: 2, kind: 'wire', title: 'Path changed for the same operationId', severity: 'error', milestone: 3, message: (c) => `path changed from ${d(c, 'from')} to ${d(c, 'to')}` });
rule({ id: 'operation-tags-changed', section: 2, kind: 'sdk', title: 'Operation tags changed', severity: 'info', sdkProfile: 'warn', milestone: 3, message: (c) => `tags changed from [${list(c.details.from)}] to [${list(c.details.to)}]` });
rule({ id: 'server-url-changed', section: 2, kind: 'wire', title: 'A servers URL changed or was removed', severity: 'warn', milestone: 3, message: (c) => `server URL ${list(c.details.removed)} removed` });

// 3. Security
rule({ id: 'security-requirement-added', section: 3, kind: 'wire', title: 'Auth now required, or an additional scheme', severity: 'error', milestone: 3, message: (c) => `security requirement added: ${d(c, 'schemes')}` });
rule({ id: 'security-requirement-removed', section: 3, kind: 'wire', title: 'Less auth required', severity: 'info', milestone: 3, message: (c) => `security requirement removed: ${d(c, 'schemes')}` });
rule({ id: 'security-alternative-added', section: 3, kind: 'wire', title: 'New alternative in the security OR list', severity: 'info', milestone: 3, message: (c) => `security alternative added: ${d(c, 'schemes')}` });
rule({ id: 'security-alternative-removed', section: 3, kind: 'wire', title: 'Security alternative removed', severity: 'error', milestone: 3, message: (c) => `security alternative removed: ${d(c, 'schemes')}` });
rule({ id: 'security-scope-added', section: 3, kind: 'wire', title: 'Required OAuth scope added', severity: 'error', milestone: 3, message: (c) => `scope ${list(c.details.scopes)} now required for '${d(c, 'scheme')}'` });
rule({ id: 'security-scope-removed', section: 3, kind: 'wire', title: 'Required scope removed', severity: 'info', milestone: 3, message: (c) => `scope ${list(c.details.scopes)} no longer required for '${d(c, 'scheme')}'` });
rule({ id: 'security-scheme-changed', section: 3, kind: 'wire', title: "Security scheme's type, location, name or URLs changed", severity: 'error', milestone: 3, message: (c) => `security scheme '${d(c, 'scheme')}' changed: ${d(c, 'fields')}` });

// 4. Parameters
rule({ id: 'parameter-added-required', section: 4, kind: 'wire', title: 'New required parameter', severity: 'error', variants: 'location', milestone: 3, message: (c) => `required ${loc(c)}parameter '${d(c, 'name')}' added` });
rule({ id: 'parameter-added-optional', section: 4, kind: 'wire', title: 'New optional parameter', severity: 'info', variants: 'location', milestone: 3, message: (c) => `optional ${loc(c)}parameter '${d(c, 'name')}' added` });
rule({ id: 'parameter-removed', section: 4, kind: 'wire', title: 'Parameter removed', severity: 'warn', sdkProfile: 'error', variants: 'location', milestone: 3, message: (c) => `${loc(c)}parameter '${d(c, 'name')}' removed` });
rule({ id: 'parameter-became-required', section: 4, kind: 'wire', title: 'Parameter became required', severity: 'error', variants: 'location', milestone: 3, message: (c) => `${loc(c)}parameter '${d(c, 'name')}' became required` });
rule({ id: 'parameter-became-optional', section: 4, kind: 'wire', title: 'Parameter became optional', severity: 'info', variants: 'location', milestone: 3, message: (c) => `${loc(c)}parameter '${d(c, 'name')}' became optional` });
rule({ id: 'parameter-location-changed', section: 4, kind: 'wire', title: 'Parameter moved to another location', severity: 'error', variants: 'location', milestone: 3, message: (c) => `parameter '${d(c, 'name')}' moved from ${d(c, 'from')} to ${d(c, 'to')}` });
rule({ id: 'parameter-serialization-changed', section: 4, kind: 'wire', title: 'Parameter style, explode, allowReserved or content changed', severity: 'error', variants: 'location', milestone: 3, message: (c) => `${loc(c)}parameter '${d(c, 'name')}' serialization changed: ${d(c, 'fields')}` });
rule({ id: 'parameter-renamed', section: 4, kind: 'sdk', title: 'Parameter renamed (detected)', severity: 'info', sdkProfile: 'error', variants: 'location', milestone: 8, message: (c) => `${loc(c)}parameter '${d(c, 'from')}' renamed to '${d(c, 'to')}'` });

// 5. Request bodies
rule({ id: 'request-body-added-required', section: 5, kind: 'wire', title: 'Required request body added', severity: 'error', milestone: 3, message: () => 'required request body added' });
rule({ id: 'request-body-added-optional', section: 5, kind: 'wire', title: 'Optional request body added', severity: 'info', milestone: 3, message: () => 'optional request body added' });
rule({ id: 'request-body-became-required', section: 5, kind: 'wire', title: 'Request body became required', severity: 'error', milestone: 3, message: () => 'request body became required' });
rule({ id: 'request-body-became-optional', section: 5, kind: 'wire', title: 'Request body became optional', severity: 'info', milestone: 3, message: () => 'request body became optional' });
rule({ id: 'request-body-removed', section: 5, kind: 'wire', title: 'Request body removed', severity: 'warn', milestone: 3, message: () => 'request body removed' });
rule({ id: 'request-media-type-added', section: 5, kind: 'wire', title: 'Request media type added', severity: 'info', milestone: 3, message: (c) => `request media type '${d(c, 'mediaType')}' added` });
rule({ id: 'request-media-type-removed', section: 5, kind: 'wire', title: 'Request media type removed', severity: 'error', milestone: 3, message: (c) => `request media type '${d(c, 'mediaType')}' removed` });

// 6. Responses
rule({ id: 'response-success-status-added', section: 6, kind: 'wire', title: 'New 1xx/2xx/3xx response', severity: 'warn', milestone: 3, message: (c) => `success response ${d(c, 'status')} added` });
rule({ id: 'response-success-status-removed', section: 6, kind: 'wire', title: '1xx/2xx/3xx response removed', severity: 'error', milestone: 3, message: (c) => `success response ${d(c, 'status')} removed` });
rule({ id: 'response-error-status-added', section: 6, kind: 'wire', title: 'New 4xx/5xx response documented', severity: 'info', milestone: 3, message: (c) => `response ${d(c, 'status')} added` });
rule({ id: 'response-error-status-removed', section: 6, kind: 'wire', title: '4xx/5xx response removed', severity: 'info', milestone: 3, message: (c) => `response ${d(c, 'status')} removed` });
rule({ id: 'response-status-range-widened', section: 6, kind: 'wire', title: 'Specific status codes replaced by their range (e.g. 200 → 2XX)', severity: 'info', milestone: 3, message: (c) => `response ${list(c.details.from)} replaced by ${d(c, 'to')}` });
rule({ id: 'response-status-range-narrowed', section: 6, kind: 'wire', title: 'A status range replaced by specific codes (e.g. 2XX → 200)', severity: 'info', milestone: 3, message: (c) => `response ${d(c, 'from')} narrowed to ${list(c.details.to)}` });
rule({ id: 'response-default-removed', section: 6, kind: 'wire', title: 'default response removed', severity: 'warn', milestone: 3, message: () => 'default response removed' });
rule({ id: 'response-media-type-added', section: 6, kind: 'wire', title: 'Response media type added', severity: 'info', milestone: 3, message: (c) => `response ${d(c, 'status')} media type '${d(c, 'mediaType')}' added` });
rule({ id: 'response-media-type-removed', section: 6, kind: 'wire', title: 'Response media type removed', severity: 'error', milestone: 3, message: (c) => `response ${d(c, 'status')} media type '${d(c, 'mediaType')}' removed` });
rule({ id: 'response-body-removed', section: 6, kind: 'wire', title: 'Response body removed', severity: 'error', milestone: 3, message: (c) => `response ${d(c, 'status')} no longer has a body` });
rule({ id: 'response-header-added', section: 6, kind: 'wire', title: 'Response header added', severity: 'info', milestone: 3, message: (c) => `response ${d(c, 'status')} header '${d(c, 'name')}' added` });
rule({ id: 'response-header-removed', section: 6, kind: 'wire', title: 'Response header removed (error if it was required)', severity: 'warn', milestone: 3, conditional: (c) => (c.details.required === true ? 'error' : undefined), message: (c) => `${c.details.required === true ? 'required ' : ''}response ${d(c, 'status')} header '${d(c, 'name')}' removed` });
rule({ id: 'response-header-became-optional', section: 6, kind: 'wire', title: 'Response header became optional', severity: 'error', milestone: 3, message: (c) => `response ${d(c, 'status')} header '${d(c, 'name')}' became optional` });

// 7. Schemas (all have request/response variants)
const schemaRule = (id: string, title: string, inS: Severity, outS: Severity, extra: Partial<RuleMeta> = {}): void =>
  rule({ id, section: 7, kind: 'wire', title, severity: { in: inS, out: outS }, variants: 'direction', milestone: 5, message: () => title.charAt(0).toLowerCase() + title.slice(1), ...extra });
schemaRule('property-added-required', 'New required property', 'error', 'info');
schemaRule('property-added-optional', 'New optional property', 'info', 'info');
schemaRule('property-removed', 'Property removed', 'warn', 'error');
schemaRule('property-became-required', 'Property became required', 'error', 'info');
schemaRule('property-became-optional', 'Property became optional', 'info', 'error');
schemaRule('property-became-read-only', 'Property became readOnly', 'warn', 'info');
schemaRule('property-became-write-only', 'Property became writeOnly', 'info', 'error');
schemaRule('additional-properties-restricted', 'additionalProperties restricted', 'error', 'info');
schemaRule('additional-properties-allowed', 'additionalProperties allowed', 'info', 'warn');
schemaRule('min-properties-increased', 'minProperties increased', 'error', 'info');
schemaRule('max-properties-decreased', 'maxProperties decreased', 'error', 'info');
schemaRule('min-properties-decreased', 'minProperties decreased', 'info', 'warn');
schemaRule('max-properties-increased', 'maxProperties increased', 'info', 'warn');
schemaRule('type-changed', 'Type changed incompatibly', 'error', 'error');
schemaRule('type-widened', 'Type widened', 'info', 'error');
schemaRule('type-narrowed', 'Type narrowed', 'error', 'info');
schemaRule('nullable-added', 'null now allowed', 'info', 'error');
schemaRule('nullable-removed', 'null no longer allowed', 'error', 'info');
schemaRule('format-added', 'Format added', 'error', 'info');
schemaRule('format-removed', 'Format removed', 'info', 'warn');
schemaRule('format-changed', 'Format changed', 'error', 'error');
schemaRule('const-changed', 'const changed', 'error', 'error');
schemaRule('default-changed', 'default changed', 'warn', 'warn');
schemaRule('enum-value-added', 'Enum value added', 'info', 'warn');
schemaRule('enum-value-removed', 'Enum value removed', 'error', 'info');
schemaRule('enum-added', 'Enum added to a free value', 'error', 'info');
schemaRule('enum-removed', 'Enum removed', 'info', 'warn');
schemaRule('max-length-decreased', 'maxLength decreased', 'error', 'info');
schemaRule('min-length-increased', 'minLength increased', 'error', 'info');
schemaRule('max-length-increased', 'maxLength increased', 'info', 'warn');
schemaRule('min-length-decreased', 'minLength decreased', 'info', 'warn');
schemaRule('maximum-decreased', 'maximum decreased', 'error', 'info');
schemaRule('minimum-increased', 'minimum increased', 'error', 'info');
schemaRule('maximum-increased', 'maximum increased', 'info', 'warn');
schemaRule('minimum-decreased', 'minimum decreased', 'info', 'warn');
schemaRule('multiple-of-changed', 'multipleOf changed', 'error', 'warn');
schemaRule('max-items-decreased', 'maxItems decreased', 'error', 'info');
schemaRule('min-items-increased', 'minItems increased', 'error', 'info');
schemaRule('max-items-increased', 'maxItems increased', 'info', 'warn');
schemaRule('min-items-decreased', 'minItems decreased', 'info', 'warn');
schemaRule('unique-items-added', 'uniqueItems added', 'error', 'info');
schemaRule('unique-items-removed', 'uniqueItems removed', 'info', 'warn');
schemaRule('pattern-added', 'Pattern added', 'error', 'info');
schemaRule('pattern-removed', 'Pattern removed', 'info', 'warn');
schemaRule('pattern-changed', 'Pattern changed', 'warn', 'warn');
schemaRule('union-branch-added', 'oneOf/anyOf branch added', 'info', 'warn');
schemaRule('union-branch-removed', 'oneOf/anyOf branch removed', 'error', 'info');
schemaRule('union-kind-changed', 'anyOf/oneOf kind changed', 'warn', 'warn', { sdkProfile: 'error' });
schemaRule('discriminator-property-changed', 'Discriminator property changed', 'error', 'error');
schemaRule('discriminator-mapping-added', 'Discriminator mapping added', 'info', 'warn');
schemaRule('discriminator-mapping-removed', 'Discriminator mapping removed', 'error', 'info');
schemaRule('discriminator-mapping-changed', 'Discriminator mapping changed', 'error', 'error');

// 8. References and components
rule({ id: 'ref-target-changed', section: 8, kind: 'sdk', title: '$ref points at a different component', severity: 'info', sdkProfile: 'error', milestone: 5, message: (c) => `$ref changed from ${d(c, 'from')} to ${d(c, 'to')}` });
rule({ id: 'ref-inlined', section: 8, kind: 'sdk', title: '$ref replaced by an inline schema', severity: 'info', sdkProfile: 'error', milestone: 5, message: (c) => `$ref ${d(c, 'from')} inlined` });
rule({ id: 'ref-extracted', section: 8, kind: 'sdk', title: 'Inline schema became a $ref', severity: 'info', sdkProfile: 'warn', milestone: 5, message: (c) => `inline schema extracted to ${d(c, 'to')}` });
rule({ id: 'component-renamed', section: 8, kind: 'sdk', title: 'Component renamed (same structure)', severity: 'info', sdkProfile: 'error', milestone: 8, message: (c) => `component ${d(c, 'from')} renamed to ${d(c, 'to')}` });
rule({ id: 'schema-title-changed', section: 8, kind: 'sdk', title: 'Schema title changed', severity: 'info', sdkProfile: 'warn', milestone: 5, message: () => 'schema title changed' });
rule({ id: 'component-added', section: 8, kind: 'wire', title: 'Unused component added', severity: 'info', milestone: 5, message: () => 'component added' });
rule({ id: 'component-removed', section: 8, kind: 'wire', title: 'Unused component removed', severity: 'info', milestone: 5, message: () => 'component removed' });
rule({ id: 'component-unused', section: 8, kind: 'wire', title: 'Changed component has no usages', severity: 'info', milestone: 5, message: () => 'changed component is not used' });

// 9. Lifecycle and versions
rule({ id: 'deprecated-added', section: 9, kind: 'wire', title: 'Marked deprecated', severity: 'info', milestone: 6, message: () => 'marked deprecated' });
rule({ id: 'deprecated-removed', section: 9, kind: 'wire', title: 'Deprecation withdrawn', severity: 'info', milestone: 6, message: () => 'no longer deprecated' });
rule({ id: 'sunset-moved-earlier', section: 9, kind: 'wire', title: 'Sunset date moved earlier', severity: 'warn', milestone: 6, message: () => 'sunset date moved earlier' });
rule({ id: 'stability-decreased', section: 9, kind: 'wire', title: 'Stability level decreased', severity: 'error', milestone: 6, message: () => 'stability level decreased' });
rule({ id: 'version-bump-too-small', section: 9, kind: 'wire', title: 'Version bump smaller than the changes need', severity: 'warn', milestone: 6, message: () => 'version bump too small' });
rule({ id: 'version-unchanged', section: 9, kind: 'wire', title: "Spec changed but the version didn't", severity: 'warn', milestone: 6, message: () => 'version unchanged' });

// 10. Docs
for (const [id, title] of [
  ['description-changed', 'Description changed'],
  ['summary-changed', 'Summary changed'],
  ['title-changed', 'Title changed'],
  ['example-changed', 'Example changed'],
  ['external-docs-changed', 'externalDocs changed'],
  ['tag-added', 'Tag added'],
  ['tag-removed', 'Tag removed'],
  ['tag-description-changed', 'Tag description changed'],
  ['info-changed', 'info (contact, license, terms) changed'],
  ['extension-changed', 'Unclassified x- extension changed'],
] as const) {
  rule({ id, section: 10, kind: 'docs', title, severity: 'info', milestone: 5, message: () => title.toLowerCase() });
}

// 11. Spec and engine notices
rule({ id: 'spec-invalid', section: 11, kind: 'wire', title: 'Document failed to load or validate', severity: 'error', milestone: 3, message: (c) => d(c, 'reason') });
rule({ id: 'ref-unresolved', section: 11, kind: 'wire', title: '$ref points nowhere', severity: 'error', milestone: 3, message: (c) => `$ref '${d(c, 'ref')}' can't be resolved${c.details.reason ? `: ${d(c, 'reason')}` : ''}` });
rule({ id: 'cycle-not-productive', section: 11, kind: 'wire', title: 'Cycle with no property or items step', severity: 'error', milestone: 4, message: (c) => `schema cycle ${(c.details.cycle as string[]).join(' → ')} has no property or items step, so it describes no valid value` });
rule({ id: 'not-compared', section: 11, kind: 'wire', title: "Parts of the spec that weren't compared", severity: 'info', milestone: 3, message: (c) => `${d(c, 'what')} not compared` });

export const RULES: readonly RuleMeta[] = R;
const BY_ID = new Map(R.map((r) => [r.id, r]));

export function getRule(id: string): RuleMeta {
  const r = BY_ID.get(id);
  if (!r) throw new Error(`unknown rule '${id}'`);
  return r;
}

export function isImplemented(r: RuleMeta): boolean {
  return r.milestone <= CURRENT_MILESTONE;
}

/** Location-specific rule ID, e.g. `query-parameter-removed`. Path locations use the base ID. */
export function specificRuleId(base: RuleMeta, c: Pick<Change, 'location' | 'direction'>): string {
  if (base.variants === 'location' && c.location && c.location !== 'path') return `${c.location}-${base.id}`;
  if (base.variants === 'direction' && c.direction) return `${base.id}-in-${c.direction === 'in' ? 'request' : 'response'}`;
  return base.id;
}

/** Every rule ID a policy may name, including variants. */
export function allRuleIds(): string[] {
  const ids: string[] = [];
  for (const r of R) {
    ids.push(r.id);
    if (r.variants === 'location') for (const l of ['query', 'header', 'cookie']) ids.push(`${l}-${r.id}`);
    if (r.variants === 'direction') ids.push(`${r.id}-in-request`, `${r.id}-in-response`);
  }
  return ids;
}

/** Base rule ID for a specific ID, e.g. `query-parameter-removed` → `parameter-removed`. */
export function baseRuleId(id: string): string | undefined {
  if (BY_ID.has(id)) return id;
  const loc = /^(query|header|cookie)-(.+)$/.exec(id);
  if (loc && BY_ID.get(loc[2]!)?.variants === 'location') return loc[2];
  const dir = /^(.+)-in-(request|response)$/.exec(id);
  if (dir && BY_ID.get(dir[1]!)?.variants === 'direction') return dir[1];
  return undefined;
}

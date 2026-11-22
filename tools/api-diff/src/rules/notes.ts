// Migration notes for clients: for each change a client may have to act on,
// one plain sentence saying what to do ("Stop sending the query parameter
// `limit`."). Used by the changelog and explore reports. Breaking changes are
// often intended, so these are written for API consumers, not as fix advice
// for spec authors (which stays on the rule pages).
//
// Each note is keyed by base rule ID and gets the finding plus its
// direction: `request` (data the client sends) or `response` (data it
// receives). Returning undefined means the client has nothing to do.

import type { Finding } from '../types.ts';

type Dir = 'request' | 'response' | undefined;
type Note = (f: Finding, dir: Dir, x: Helpers) => string | undefined;

interface Helpers {
  /** Detail as text, e.g. a name or a value. */
  d(key: string): string;
  /** Detail values as a list: `'a', 'b'`. */
  list(key: string): string;
  /** The field the change is in, from the schema path: `status`, `items of tags`, or the schema's name. */
  field: string;
  /** The parameter's location word: `query`, `header`, `cookie`. */
  loc: string;
}

const show = (v: unknown): string => (v === undefined || v === null ? 'none' : typeof v === 'string' ? v : Array.isArray(v) && v.every((x) => typeof x === 'string') ? v.join(' or ') : JSON.stringify(v));
const code = (s: string): string => `\`${s}\``;

/** `/properties/a/properties/b/items/maxLength` → `a.b[]`; empty if the path names no property. */
export function fieldOf(path: unknown): string {
  if (typeof path !== 'string') return '';
  const segs = path.split('/').slice(1).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let out = '';
  for (let i = 0; i < segs.length; i++) {
    if (segs[i] === 'properties' && segs[i + 1] !== undefined) out += (out ? '.' : '') + segs[++i];
    else if (segs[i] === 'items' && out) out += '[]';
  }
  return out;
}

const shortSchema = (subject: string): string => subject.replace(/^#\/components\/schemas\//, '');
/** `query parameter 'limit'` → the query parameter `limit`; `request body (application/json)` → the request body. */
const usageText = (u: string): string => `the ${u.replace(/ \([^)]*\)$/, '').replace(/'([^']+)'/g, '`$1`')}`;

const was = (x: Helpers): string => (x.d('from') === 'none' || x.d('from') === '' ? 'there was no limit before' : `was ${x.d('from')}`);
const narrowedLimit: Note = (f, dir, x) => (dir === 'request' ? `Send ${x.field} within the new limit: ${code(lastKeyword(f))} is now ${x.d('to')} (${was(x)}).` : undefined);
const widenedLimit: Note = (f, dir, x) => (dir === 'response' ? `Handle ${x.field} values beyond the old limit: ${code(lastKeyword(f))} is now ${x.d('to') === 'none' ? 'gone' : x.d('to')} (${was(x)}).` : undefined);
const lastKeyword = (f: Finding): string => String(f.details.path ?? '').split('/').pop() || String(f.details.keyword ?? '');
const sdkType: Note = (_f, _dir, x) => `In generated SDKs the type used for ${x.field} changes (${x.d('from') ? code(shortSchema(x.d('from'))) : 'inline'} → ${x.d('to') ? code(shortSchema(x.d('to'))) : 'inline'}); update code that names it after regenerating.`;

const NOTES: Record<string, Note> = {
  // Core fallbacks
  'schema-narrowed': (_f, dir, x) => (dir === 'request' ? `Send only values the new schema accepts for ${x.field}.` : undefined),
  'schema-widened': (_f, dir, x) => (dir === 'response' ? `Handle the wider range of values for ${x.field} in responses.` : undefined),
  'schema-incompatible': (_f, dir, x) => `${dir === 'request' ? 'Update what you send for' : 'Update how you read'} ${x.field}: it changed (${x.d('from')} → ${x.d('to')}).`,
  'unclassified-change': (f) => `Check how your client uses ${code(shortSchema(f.subject))}; this change couldn't be classified automatically.`,

  // Paths and operations
  'operation-removed': (f) => `Stop calling ${code(f.subject)}; it no longer exists.`,
  'operation-removed-after-deprecation': (f) => `Stop calling ${code(f.subject)}; it was removed after its deprecation period.`,
  'operation-id-changed': (_f, _d, x) => `In generated SDKs this operation's method is renamed from ${code(x.d('from'))} to ${code(x.d('to'))}; update calls after regenerating.`,
  'path-param-renamed': (_f, _d, x) => `In generated SDKs the path argument is renamed from ${code(x.d('from'))} to ${code(x.d('to'))}.`,
  'operation-path-changed': (f, _d, x) => `Call ${code(`${f.subject.split(' ')[0]} ${x.d('to')}`)} instead of ${code(x.d('from'))}.`,
  'operation-tags-changed': (_f, _d, x) => `Generated SDKs may move this method to another class (tags ${x.list('from')} → ${x.list('to')}).`,
  'server-url-changed': (_f, _d, x) => `Update the base URL: ${x.list('removed')} is no longer listed${(x.d('added') && x.d('added') !== 'none') ? `; use ${x.list('added')}` : ''}.`,

  // Security
  'security-requirement-added': (_f, _d, x) => `Send credentials for ${code(x.d('schemes'))} with this call.`,
  'security-alternative-removed': (_f, _d, x) => `Authenticate with one of the remaining options; ${code(x.d('schemes'))} is no longer accepted.`,
  'security-scope-added': (_f, _d, x) => `Request the ${x.list('scopes')} scope for ${code(x.d('scheme'))} before calling this.`,
  'security-scheme-changed': (_f, _d, x) => `Update how you send ${code(x.d('scheme'))} credentials (changed: ${x.d('fields')}).`,

  // Parameters
  'parameter-added-required': (_f, _d, x) => `Send the ${x.loc} parameter ${code(x.d('name'))}; it's now required.`,
  'parameter-removed': (_f, _d, x) => `Stop sending the ${x.loc} parameter ${code(x.d('name'))}.`,
  'parameter-became-required': (_f, _d, x) => `Always send the ${x.loc} parameter ${code(x.d('name'))}.`,
  'parameter-location-changed': (_f, _d, x) => `Send ${code(x.d('name'))} as a ${x.d('to')} parameter instead of ${x.d('from')}.`,
  'parameter-serialization-changed': (_f, _d, x) => `Update how you encode the ${x.loc} parameter ${code(x.d('name'))} (${x.d('fields')}).`,
  'parameter-renamed': (_f, _d, x) => `Send ${code(x.d('to'))} instead of ${code(x.d('from'))}; in generated SDKs the argument is renamed.`,

  // Request bodies
  'request-body-added-required': () => 'Send a request body with this call.',
  'request-body-became-required': () => 'Always send a request body with this call.',
  'request-body-removed': () => 'Stop sending a request body.',
  'request-media-type-removed': (_f, _d, x) => `Send the body as one of the remaining media types; ${code(x.d('mediaType'))} is no longer accepted.`,

  // Responses
  'response-success-status-added': (_f, _d, x) => `Handle the new success response ${x.d('status')}.`,
  'response-success-status-removed': (_f, _d, x) => `Don't rely on response ${x.d('status')}; it's no longer returned.`,
  'response-default-removed': () => 'Handle error responses by their listed status codes; the default response was removed.',
  'response-media-type-removed': (_f, _d, x) => `Accept another media type for response ${x.d('status')}; ${code(x.d('mediaType'))} is no longer returned.`,
  'response-body-removed': (_f, _d, x) => `Don't read a body from response ${x.d('status')}; it no longer has one.`,
  'response-header-removed': (_f, _d, x) => `Don't rely on the ${code(x.d('name'))} header in response ${x.d('status')}.`,
  'response-header-became-optional': (_f, _d, x) => `Handle response ${x.d('status')} without the ${code(x.d('name'))} header.`,

  // Properties and objects
  'property-added-required': (_f, dir, x) => (dir === 'request' ? `Send ${code(x.d('name'))} in every request.` : undefined),
  'property-removed': (f, dir, x) => (dir === 'request' ? `Stop sending ${code(x.d('name'))}${f.details.closed ? '; it is now rejected' : ''}.` : `Don't rely on ${code(x.d('name'))} in responses; it's no longer returned.`),
  'property-became-required': (_f, dir, x) => (dir === 'request' ? `Always send ${code(x.d('name'))}.` : undefined),
  'property-became-optional': (_f, dir, x) => (dir === 'response' ? `Handle responses without ${code(x.d('name'))}.` : undefined),
  'property-became-read-only': (_f, dir, x) => (dir === 'request' ? `Stop sending ${code(x.d('name'))}; it's read-only now.` : undefined),
  'property-became-write-only': (_f, dir, x) => (dir === 'response' ? `Don't rely on ${code(x.d('name'))} in responses; it's no longer returned.` : undefined),
  'additional-properties-restricted': (_f, dir, x) => (dir === 'request' ? `Send only the listed properties in ${x.field}; others are rejected.` : undefined),
  'additional-properties-allowed': (_f, dir, x) => (dir === 'response' ? `Accept properties you don't know in ${x.field}.` : undefined),
  'min-properties-increased': narrowedLimit,
  'max-properties-decreased': narrowedLimit,
  'min-properties-decreased': widenedLimit,
  'max-properties-increased': widenedLimit,

  // Types, formats and nullability
  'type-changed': (_f, dir, x) => `${dir === 'request' ? 'Send' : 'Read'} ${x.field} as ${x.d('to')} (was ${x.d('from')}).`,
  'type-widened': (_f, dir, x) => (dir === 'response' ? `Handle ${x.field} values of type ${x.d('to')} (was ${x.d('from')}).` : undefined),
  'type-narrowed': (_f, dir, x) => (dir === 'request' ? `Send ${x.field} as ${x.d('to')} only (was ${x.d('from')}).` : undefined),
  'nullable-added': (_f, dir, x) => (dir === 'response' ? `Handle null for ${x.field}.` : undefined),
  'nullable-removed': (_f, dir, x) => (dir === 'request' ? `Don't send null for ${x.field}.` : undefined),
  'format-added': (_f, dir, x) => (dir === 'request' ? `Send ${x.field} in ${code(x.d('to'))} format.` : undefined),
  'format-removed': (_f, dir, x) => (dir === 'response' ? `Don't assume ${x.field} is in ${code(x.d('from'))} format.` : undefined),
  'format-changed': (f, dir, x) => (f.severity === 'info' ? undefined : `${dir === 'request' ? 'Send' : 'Parse'} ${x.field} in ${code(x.d('to'))} format (was ${code(x.d('from'))}).`),
  'const-changed': (_f, _dir, x) => `${x.field} must now be ${code(x.d('to'))} (was ${code(x.d('from'))}).`,
  'default-changed': (_f, dir, x) => (dir === 'request' ? `If you leave out ${x.field}, the server now uses ${code(x.d('to'))} (was ${code(x.d('from'))}); send it to keep the old behaviour.` : `Responses may now default ${x.field} to ${code(x.d('to'))} (was ${code(x.d('from'))}).`),

  // Enums
  'enum-value-added': (_f, dir, x) => (dir === 'response' ? `Handle the new ${x.field} value${x.list('values').includes(',') ? 's' : ''} ${x.list('values')}.` : undefined),
  'enum-value-removed': (_f, dir, x) => (dir === 'request' ? `Stop sending ${x.list('values')} for ${x.field}.` : undefined),
  'enum-added': (_f, dir, x) => (dir === 'request' ? `Send only ${x.list('values')} for ${x.field}.` : undefined),
  'enum-removed': (_f, dir, x) => (dir === 'response' ? `Handle any value of ${x.field}, not only ${x.list('values')}.` : undefined),

  // Limits
  'max-length-decreased': narrowedLimit,
  'min-length-increased': narrowedLimit,
  'max-length-increased': widenedLimit,
  'min-length-decreased': widenedLimit,
  'maximum-decreased': narrowedLimit,
  'minimum-increased': narrowedLimit,
  'maximum-increased': widenedLimit,
  'minimum-decreased': widenedLimit,
  'max-items-decreased': narrowedLimit,
  'min-items-increased': narrowedLimit,
  'max-items-increased': widenedLimit,
  'min-items-decreased': widenedLimit,
  'multiple-of-changed': (_f, dir, x) => `${dir === 'request' ? 'Send' : 'Handle'} ${x.field} as a multiple of ${x.d('to')} (was ${x.d('from')}).`,
  'unique-items-added': (_f, dir, x) => (dir === 'request' ? `Don't send duplicate items in ${x.field}.` : undefined),
  'unique-items-removed': (_f, dir, x) => (dir === 'response' ? `Handle duplicate items in ${x.field}.` : undefined),
  'pattern-added': (_f, dir, x) => (dir === 'request' ? `Make sure ${x.field} matches ${code(x.d('to'))}.` : undefined),
  'pattern-removed': (_f, dir, x) => (dir === 'response' ? `Don't assume ${x.field} matches ${code(x.d('from'))}.` : undefined),
  'pattern-changed': (_f, dir, x) => (dir === 'request' ? `Make sure ${x.field} matches ${code(x.d('to'))} (was ${code(x.d('from'))}).` : `Don't assume ${x.field} matches ${code(x.d('from'))}; it now follows ${code(x.d('to'))}.`),

  // Composition
  'union-branch-added': (_f, dir, x) => (dir === 'response' ? `Handle the new ${code(shortSchema(x.d('branch')))} variant of ${x.field}.` : undefined),
  'union-branch-removed': (_f, dir, x) => (dir === 'request' ? `Stop sending the ${code(shortSchema(x.d('branch')))} variant of ${x.field}.` : undefined),
  'union-kind-changed': (_f, _dir, x) => `Values of ${x.field} must now match ${x.d('to') === 'oneOf' ? 'exactly one variant' : 'at least one variant'} (${x.d('from')} → ${x.d('to')}); generated SDK types change.`,
  'discriminator-property-changed': (_f, _dir, x) => `Use ${code(x.d('to'))} instead of ${code(x.d('from'))} to tell the variants of ${x.field} apart.`,
  'discriminator-mapping-added': (_f, dir, x) => (dir === 'response' ? `Handle the new ${code(x.d('value'))} variant of ${x.field}.` : undefined),
  'discriminator-mapping-removed': (_f, dir, x) => (dir === 'request' ? `Stop sending the ${code(x.d('value'))} variant of ${x.field}.` : undefined),
  'discriminator-mapping-changed': (_f, _dir, x) => `The ${code(x.d('value'))} variant of ${x.field} now means ${code(shortSchema(x.d('to')))} (was ${code(shortSchema(x.d('from')))}); update the type you use for it.`,

  // References and components (SDK)
  'ref-target-changed': sdkType,
  'ref-inlined': sdkType,
  'ref-extracted': sdkType,
  'component-renamed': (_f, _d, x) => `In generated SDKs, the type ${code(shortSchema(x.d('from')))} is now ${code(shortSchema(x.d('to')))}; rename it in your code after regenerating.`,
  'schema-title-changed': (_f, _d, x) => `Some SDK generators name types after titles, so the type may be renamed from ${code(x.d('from'))} to ${code(x.d('to'))}.`,

  // Lifecycle
  'deprecated-added': (f, _d, x) => `Plan to stop using ${x.d('what') === 'operation' ? code(f.subject) : `${x.d('what') || 'this'}${x.d('name') ? ` ${code(x.d('name'))}` : f.subject.startsWith('#') ? ` ${code(shortSchema(f.subject))}` : ''}`}; it's deprecated.`,
  'sunset-moved-earlier': (f, _d, x) => `Move off ${code(f.subject)} by ${x.d('to')} (the sunset date was ${x.d('from')}).`,
  'stability-decreased': (f, _d, x) => `${code(f.subject)} is now ${x.d('to')} (was ${x.d('from')}); expect changes with less notice.`,

  // Extensions
  'extension-changed-sdk': (_f, _d, x) => `Regenerate SDKs: ${code(x.d('name'))} changed.`,
  'extension-changed-wire': (_f, _d, x) => `Check how your client depends on ${code(x.d('name'))}; it changed.`,
};

/** The migration note for a finding, or undefined when a client has nothing to do. */
export function clientNote(f: Finding): string | undefined {
  const note = NOTES[f.baseRule];
  if (!note) return undefined;
  const dir: Dir = f.rule.endsWith('-in-request') ? 'request' : f.rule.endsWith('-in-response') ? 'response' : undefined;
  const field = fieldOf(f.details.path);
  const x: Helpers = {
    d: (k) => (f.details[k] === undefined ? '' : show(f.details[k])),
    list: (k) => {
      const v = f.details[k];
      return (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((s) => code(show(s))).join(', ');
    },
    field: field ? code(field) : typeof f.details.usage === 'string' ? usageText(f.details.usage) : f.subject.startsWith('#') ? code(shortSchema(f.subject)) : 'the value',
    loc: String(f.rule.match(/^(query|header|cookie)-/)?.[1] ?? 'path'),
  };
  return note(f, dir, x);
}

/** Rule IDs with a note, for the coverage test. */
export const NOTED_RULES: ReadonlySet<string> = new Set(Object.keys(NOTES));

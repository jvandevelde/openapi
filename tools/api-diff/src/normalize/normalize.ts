// Normalises OpenAPI 3.0, 3.1 and 3.2 into one dialect, so cosmetic
// differences between versions don't show up as changes.

export type OasVersion = '3.0' | '3.1' | '3.2';

/** The `openapi` field's major.minor, or an error message. */
export function detectVersion(doc: unknown): OasVersion | { error: string } {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return { error: 'the document is not an object' };
  const d = doc as Record<string, unknown>;
  if (typeof d.swagger === 'string') return { error: `Swagger ${d.swagger} is not supported; convert it to OpenAPI 3 first` };
  const v = d.openapi;
  if (typeof v !== 'string') return { error: "missing the 'openapi' version field" };
  const m = /^3\.([0-2])(\.|$)/.exec(v);
  if (!m) return { error: `OpenAPI ${v} is not supported (3.0, 3.1 and 3.2 are)` };
  return `3.${m[1]}` as OasVersion;
}

/** `/users/{id}` and `/users/{userId}` share the key `/users/{}`. */
export function pathKey(template: string): string {
  return template.replace(/\{[^}/]*\}/g, '{}');
}

/** Names of the template parameters, in order. */
export function pathParamNames(template: string): string[] {
  return [...template.matchAll(/\{([^}/]*)\}/g)].map((m) => m[1]!);
}

/** Response status keys compare case-insensitively (`2xx` = `2XX`). */
export function statusKey(status: string): string {
  return status.toUpperCase() === 'DEFAULT' ? 'default' : status.toUpperCase();
}

export function isSuccessStatus(status: string): boolean {
  return /^2(\d\d|XX)$/.test(statusKey(status));
}

/** Media types compare case-insensitively and without parameters' whitespace. */
export function mediaTypeKey(mt: string): string {
  return mt
    .split(';')
    .map((p) => p.trim().toLowerCase())
    .join(';');
}

/**
 * Normalises one schema object's keywords (not its children) to 3.1/3.2
 * semantics. Returns a new object; the input is not changed.
 *
 * - 3.0 `nullable: true` becomes `null` in the `type` array.
 * - 3.0 boolean `exclusiveMinimum`/`exclusiveMaximum` become numbers.
 * - A single-value `type` array becomes a string; type arrays are sorted.
 * - 3.0 `example` becomes `examples: [example]`.
 */
export function normalizeSchemaKeywords(schema: Record<string, unknown>, version: OasVersion): Record<string, unknown> {
  const s: Record<string, unknown> = { ...schema };
  if (version === '3.0') {
    if (s.nullable === true) {
      if (typeof s.type === 'string') s.type = [s.type, 'null'];
      else if (s.type === undefined && Array.isArray(s.enum) && !s.enum.includes(null)) s.enum = [...s.enum, null];
    }
    delete s.nullable;
    for (const [flag, bound] of [
      ['exclusiveMinimum', 'minimum'],
      ['exclusiveMaximum', 'maximum'],
    ] as const) {
      if (s[flag] === true && typeof s[bound] === 'number') {
        s[flag] = s[bound];
        delete s[bound];
      } else if (s[flag] === false) delete s[flag];
    }
    if ('example' in s) {
      s.examples = [s.example];
      delete s.example;
    }
  }
  if (Array.isArray(s.type)) {
    const t = [...new Set(s.type as string[])].sort();
    s.type = t.length === 1 ? t[0] : t;
  }
  return s;
}

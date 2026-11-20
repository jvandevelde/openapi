/**
 * Word splitting, path parsing and identifier casing.
 * All words are kept lower-case internally; casing is applied at the very end.
 */

/** Split an arbitrary string into lower-case alphanumeric words. */
export function words(str) {
  return String(str)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // fooBar -> foo Bar
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // HTTPServer -> HTTP Server
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

const PARAM_RE = /\{([^{}]+)\}/g;

/**
 * Parse a path template into segments.
 *   static segment: { type: 'static', words: [...] }
 *   param segment:  { type: 'param' }
 * Params embedded in a static segment (e.g. "/files/{name}.{ext}") are still
 * collected into `params`, in path order.
 */
export function parsePath(path) {
  const segments = [];
  const params = [];
  for (const raw of String(path).split('/')) {
    if (!raw) continue;
    for (const m of raw.matchAll(PARAM_RE)) params.push(m[1]);
    const staticWords = words(raw.replace(PARAM_RE, ' '));
    if (staticWords.length === 0 && raw.includes('{')) segments.push({ type: 'param' });
    else if (staticWords.length > 0) segments.push({ type: 'static', words: staticWords });
  }
  return { segments, params };
}

export const CASES = ['camel', 'pascal', 'snake', 'kebab'];

const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1) : w);

/** Join lower-case words into an identifier in the requested case. */
export function formatCase(ws, style = 'camel') {
  switch (style) {
    case 'camel':
      return ws.map((w, i) => (i === 0 ? w : cap(w))).join('');
    case 'pascal':
      return ws.map(cap).join('');
    case 'snake':
      return ws.join('_');
    case 'kebab':
      return ws.join('-');
    default:
      throw new Error(`Unknown case "${style}" (expected one of: ${CASES.join(', ')})`);
  }
}

/** Separator used before the hash suffix in the last-resort fallback. */
export function hashSeparator(style) {
  return style === 'kebab' ? '-' : '_';
}

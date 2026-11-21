// Parses JSON or YAML into a plain value plus a position index.
// JSON: JSON.parse for values, jsonc-parser's visitor for offsets.
// YAML: js-yaml's event parser for both (one parse, exact offsets).

import { CORE_SCHEMA, EVENT_ALIAS, EVENT_MAPPING, EVENT_POP, EVENT_SCALAR, EVENT_SEQUENCE, SCALAR_STYLE_DOUBLE_QUOTED, SCALAR_STYLE_SINGLE_QUOTED, constructFromEvents, getScalarValue, mergeTag, parseEvents, YAMLException } from 'js-yaml';
import { visit } from 'jsonc-parser';
import { PositionBuilder, PositionIndex } from './positions.ts';

export type Format = 'json' | 'yaml';

/** YAML 1.2 core schema plus merge keys (`<<: *anchor`), which specs use for shared fragments. */
const SCHEMA = CORE_SCHEMA.withTags(mergeTag);

export interface Parsed {
  value: unknown;
  positions: PositionIndex;
  format: Format;
}

export class ParseError extends Error {
  readonly line: number | undefined;
  readonly column: number | undefined;
  constructor(message: string, line?: number, column?: number) {
    super(message);
    this.line = line;
    this.column = column;
  }
}

/** Detects the format from the file name, then from the content. */
export function detectFormat(name: string, text: string): Format {
  if (/\.json$/i.test(name)) return 'json';
  if (/\.ya?ml$/i.test(name)) return 'yaml';
  return /^\s*[{[]/.test(text) ? 'json' : 'yaml';
}

export function parse(text: string, name: string, format: Format = detectFormat(name, text)): Parsed {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    return format === 'json' ? parseJson(text) : parseYaml(text, name);
  } catch (e) {
    // The YAML and JSON parsers recurse, so very deep literal nesting overflows the stack
    // (about 1,600 levels for YAML, 3,600 for JSON). Recursive $ref schemas are not affected.
    // See decision record 2026-11-21T0619-deeply-nested-files.
    if (e instanceof RangeError && /call stack/i.test(e.message)) {
      throw new ParseError(`the ${format === 'json' ? 'JSON' : 'YAML'} is nested too deeply to parse (more than about ${format === 'json' ? '3,600' : '1,600'} levels)`);
    }
    throw e;
  }
}

function lineColAt(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let start = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++;
    start = i + 1;
  }
  return { line, column: offset - start + 1 };
}

function parseJson(text: string): Parsed {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    let first: number | undefined;
    visit(text, { onError: (_err, offset) => void (first ??= offset) }, { disallowComments: true });
    const at = first !== undefined ? lineColAt(text, first) : undefined;
    throw new ParseError(`invalid JSON: ${(e as Error).message}`, at?.line, at?.column);
  }
  const positions = new PositionIndex(value, text);
  const b = new PositionBuilder(positions);
  visit(
    text,
    {
      onObjectBegin: (offset) => b.open(false, offset),
      onObjectEnd: () => b.close(),
      onArrayBegin: (offset) => b.open(true, offset),
      onArrayEnd: () => b.close(),
      onObjectProperty: (name, offset) => b.key(name, offset),
      onLiteralValue: (_v, offset) => b.scalar(offset),
    },
    { disallowComments: true },
  );
  return { value, positions, format: 'json' };
}

function parseYaml(text: string, name: string): Parsed {
  let events;
  let docs: unknown[];
  try {
    events = parseEvents(text, { filename: name, maxDepth: 10_000 });
    docs = constructFromEvents(events, { source: text, filename: name, schema: SCHEMA });
  } catch (e) {
    if (e instanceof YAMLException) {
      const mark = (e as YAMLException & { mark?: { line: number; column: number } }).mark;
      throw new ParseError(`invalid YAML: ${e.reason ?? e.message}`, mark ? mark.line + 1 : undefined, mark ? mark.column + 1 : undefined);
    }
    throw e;
  }
  if (docs.length > 1) throw new ParseError('the file contains more than one YAML document');
  const value = docs[0] ?? null;
  const positions = new PositionIndex(value, text);
  const b = new PositionBuilder(positions);
  for (const ev of events) {
    switch (ev.type) {
      case EVENT_MAPPING:
      case EVENT_SEQUENCE: {
        const isArray = ev.type === EVENT_SEQUENCE;
        if (b.expectsKey()) b.openKey(isArray);
        else b.open(isArray, ev.start);
        break;
      }
      case EVENT_SCALAR: {
        // Point at the opening quote of quoted scalars, not their first character.
        const start = ev.style === SCALAR_STYLE_SINGLE_QUOTED || ev.style === SCALAR_STYLE_DOUBLE_QUOTED ? ev.valueStart - 1 : ev.valueStart;
        if (b.expectsKey()) b.key(getScalarValue(text, ev), start);
        else b.scalar(start);
        break;
      }
      case EVENT_ALIAS:
        if (b.expectsKey()) b.key('\u0000', ev.anchorStart);
        else b.scalar(ev.anchorStart);
        break;
      case EVENT_POP:
        b.close();
        break;
      default:
        break; // document start/end
    }
  }
  return { value, positions, format: 'yaml' };
}

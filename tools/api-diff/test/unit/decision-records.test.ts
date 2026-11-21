// Checks the format of decision-records/: file names, required sections,
// statuses, supersede links in both directions, and the README index.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../../decision-records/', import.meta.url));
const files = readdirSync(DIR).filter((f) => /^\d/.test(f)).sort();
const read = (f: string): string => readFileSync(DIR + f, 'utf8');
const SECTIONS = ['## Background', '## Alternatives considered', '## Decision', '## Impacts', '## References'];

function field(text: string, name: string): string | undefined {
  return new RegExp(`^\\| \\*\\*${name}\\*\\* \\| (.*) \\|$`, 'm').exec(text)?.[1];
}

test('decision records exist', () => assert.ok(files.length > 0));

for (const f of files) {
  test(`decision record ${f}`, () => {
    assert.match(f, /^\d{4}-\d{2}-\d{2}T\d{4}-[a-z0-9]+(-[a-z0-9]+)*\.md$/, 'file name: <YYYY-MM-DDTHHMM>-<slug>.md');
    const text = read(f);
    assert.match(text, /^# \S/, 'starts with a title');
    for (const s of SECTIONS) assert.ok(text.includes(`\n${s}\n`), `missing section ${s}`);
    const date = field(text, 'Date');
    const stamp = f.slice(0, 15);
    assert.equal(date, `${stamp.slice(0, 10)} ${stamp.slice(11, 13)}:${stamp.slice(13, 15)} UTC`, 'Date matches the file name');
    assert.ok(field(text, 'Summary'), 'has a Summary');
    const status = field(text, 'Status') ?? '';
    assert.match(status, /^(Proposed|Accepted|Superseded by \[[^\]]+\]\(([^)]+\.md)\))$/, 'Status is Proposed, Accepted or Superseded by [..](..)');
    const by = /\]\(([^)]+\.md)\)/.exec(status)?.[1];
    if (by) {
      assert.ok(files.includes(by), `superseding record ${by} exists`);
      assert.ok(by > f, 'a record is superseded by a later one');
      assert.match(field(read(by), 'Supersedes') ?? '', new RegExp(`\\(${f.replace(/\./g, '\\.')}\\)`), `${by} links back with Supersedes`);
    }
    const sup = /\]\(([^)]+\.md)\)/.exec(field(text, 'Supersedes') ?? '')?.[1];
    if (sup) assert.match(field(read(sup), 'Status') ?? '', new RegExp(`\\(${f.replace(/\./g, '\\.')}\\)`), `${sup} is marked superseded by this record`);
  });
}

test('README.md lists every record with its status', () => {
  const index = read('README.md');
  for (const f of files) {
    const row = index.split('\n').find((l) => l.split(' | ')[1]?.endsWith(`](${f})`));
    assert.ok(row, `README.md lists ${f}`);
    const status = (field(read(f), 'Status') ?? '').split(' ')[0]!;
    assert.ok(row.split(' | ')[2]?.startsWith(status), `README.md status for ${f} is ${status}`);
  }
});

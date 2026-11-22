// Posts an api-diff report as a pull request comment, updating its own
// earlier comment instead of adding a new one on every push. Used by the
// self-check in .github/workflows/api-diff.yml and by the workflow in
// docs/ci.md for API repos.
//
//   node ci/github-comment.ts --file review.txt --key openapi.yaml [--title "API changes: openapi.yaml"]
//
// Reads GITHUB_TOKEN, GITHUB_REPOSITORY and the pull request number from
// GITHUB_EVENT_PATH (or PR_NUMBER), and RUN_URL for a link to the run's
// artifacts. A comment is only created when the report has changes; an
// existing one is always updated, so it never goes stale. When the token
// can't write (pull requests from forks), it warns and exits 0: the report
// is still in the job log.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const MAX_BODY = 65_536;

export interface Env {
  GITHUB_TOKEN?: string;
  GITHUB_REPOSITORY?: string;
  GITHUB_EVENT_PATH?: string;
  GITHUB_API_URL?: string;
  PR_NUMBER?: string;
  RUN_URL?: string;
}

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export const marker = (key: string): string => `<!-- api-diff:review:${key} -->`;

/** The comment body: marker, title, the report in a code block, and a link to the run. */
export function commentBody(report: string, key: string, title: string, runUrl?: string): string {
  const fence = '````'; // the report never contains four backticks in a row
  const link = runUrl ? `\n[Full report (HTML and JSON) in the workflow run's artifacts](${runUrl})\n` : '';
  const head = `${marker(key)}\n### ${title}\n\n${fence}text\n`;
  const tail = `\n${fence}\n${link}`;
  const room = MAX_BODY - head.length - tail.length - 100;
  const body = report.length > room ? `${report.slice(0, room)}\n… (cut to fit a GitHub comment; see the full report)` : report;
  return `${head}${body.replace(/\n+$/, '')}${tail}`;
}

export const hasChanges = (report: string): boolean => !/^No changes found\.$/m.test(report);

export async function postComment(opts: { report: string; key: string; title: string }, env: Env, fetchImpl: Fetch, log: (s: string) => void = console.log): Promise<'created' | 'updated' | 'skipped' | 'no-permission'> {
  const repo = env.GITHUB_REPOSITORY;
  const pr = env.PR_NUMBER ?? (env.GITHUB_EVENT_PATH ? String((JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) as { pull_request?: { number?: number } }).pull_request?.number ?? '') : '');
  if (!env.GITHUB_TOKEN || !repo || !pr) throw new Error('needs GITHUB_TOKEN, GITHUB_REPOSITORY and a pull request (GITHUB_EVENT_PATH or PR_NUMBER)');
  const api = env.GITHUB_API_URL ?? 'https://api.github.com';
  const headers = { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'x-github-api-version': '2022-11-28' };

  let existing: { id: number } | undefined;
  for (let page = 1; !existing; page++) {
    const res = await fetchImpl(`${api}/repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`listing comments failed: ${res.status} ${await res.text()}`);
    const list = (await res.json()) as { id: number; body?: string }[];
    existing = list.find((c) => c.body?.includes(marker(opts.key)));
    if (list.length < 100) break;
  }
  if (!existing && !hasChanges(opts.report)) {
    log('api-diff: no changes, and no earlier comment to update; not commenting');
    return 'skipped';
  }
  const body = commentBody(opts.report, opts.key, opts.title, env.RUN_URL);
  const res = existing
    ? await fetchImpl(`${api}/repos/${repo}/issues/comments/${existing.id}`, { method: 'PATCH', headers, body: JSON.stringify({ body }) })
    : await fetchImpl(`${api}/repos/${repo}/issues/${pr}/comments`, { method: 'POST', headers, body: JSON.stringify({ body }) });
  if (res.status === 403 || res.status === 404) {
    log(`::warning::api-diff: can't write the PR comment (${res.status}); for pull requests from forks the token is read-only. The report is in this job's log.`);
    return 'no-permission';
  }
  if (!res.ok) throw new Error(`writing the comment failed: ${res.status} ${await res.text()}`);
  log(`api-diff: ${existing ? 'updated' : 'created'} the review comment`);
  return existing ? 'updated' : 'created';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { file: { type: 'string' }, key: { type: 'string' }, title: { type: 'string' } } });
  if (!values.file || !values.key) {
    console.error('usage: node ci/github-comment.ts --file <report.txt> --key <spec path> [--title <text>]');
    process.exit(2);
  }
  const report = readFileSync(values.file, 'utf8');
  try {
    await postComment({ report, key: values.key, title: values.title ?? `API changes: \`${values.key}\`` }, process.env as Env, fetch as unknown as Fetch);
  } catch (e) {
    console.error(`api-diff: ${(e as Error).message}`);
    process.exit(1);
  }
}

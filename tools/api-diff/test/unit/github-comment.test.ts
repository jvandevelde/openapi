// The PR comment script used by the CI workflows (ci/github-comment.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commentBody, marker, MAX_BODY, postComment } from '../../ci/github-comment.ts';

type Call = { url: string; method: string; body?: string };

function fakeGitHub(comments: { id: number; body: string }[], writeStatus = 200) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: { method?: string; body?: string } = {}) => {
    calls.push({ url, method: init.method ?? 'GET', ...(init.body ? { body: init.body } : {}) });
    const status = init.method ? writeStatus : 200;
    return { ok: status < 300, status, json: async () => (init.method ? {} : comments), text: async () => 'error' };
  };
  return { calls, fetch };
}

const env = { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', PR_NUMBER: '7', RUN_URL: 'https://example.test/run/1' };
const REPORT = 'api-diff 0.10.0\n\nChanges (1 place)\nERROR  GET /pets\n';
const quiet = (): void => {};

test('creates a comment when there are changes and none exists yet', async () => {
  const gh = fakeGitHub([{ id: 1, body: 'unrelated' }]);
  assert.equal(await postComment({ report: REPORT, key: 'openapi.yaml', title: 'API changes' }, env, gh.fetch, quiet), 'created');
  const post = gh.calls.find((c) => c.method === 'POST')!;
  assert.equal(post.url, 'https://api.github.com/repos/o/r/issues/7/comments');
  const body = JSON.parse(post.body!).body as string;
  assert.ok(body.startsWith(`${marker('openapi.yaml')}\n### API changes\n\n\`\`\`\`text\napi-diff 0.10.0`));
  assert.match(body, /\[Full report \(HTML and JSON\) in the workflow run's artifacts\]\(https:\/\/example\.test\/run\/1\)/);
});

test('updates its own earlier comment, even when the changes are gone', async () => {
  const gh = fakeGitHub([{ id: 42, body: `${marker('openapi.yaml')}\nold` }]);
  assert.equal(await postComment({ report: 'api-diff\n\nNo changes found.\n', key: 'openapi.yaml', title: 'API changes' }, env, gh.fetch, quiet), 'updated');
  assert.ok(gh.calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/issues/comments/42')));
});

test('skips when there are no changes and nothing to update', async () => {
  const gh = fakeGitHub([]);
  assert.equal(await postComment({ report: 'No changes found.\n', key: 'a', title: 't' }, env, gh.fetch, quiet), 'skipped');
  assert.ok(!gh.calls.some((c) => c.method !== 'GET'));
});

test('a read-only token (fork PRs) warns instead of failing', async () => {
  const logs: string[] = [];
  const gh = fakeGitHub([], 403);
  assert.equal(await postComment({ report: REPORT, key: 'a', title: 't' }, env, gh.fetch, (s) => logs.push(s)), 'no-permission');
  assert.match(logs[0]!, /^::warning::api-diff: can't write the PR comment \(403\)/);
});

test('one comment per spec, and bodies fit a GitHub comment', () => {
  assert.notEqual(marker('a.yaml'), marker('b.yaml'));
  const body = commentBody('x'.repeat(100_000), 'a.yaml', 'API changes');
  assert.ok(body.length <= MAX_BODY);
  assert.match(body, /cut to fit a GitHub comment/);
});

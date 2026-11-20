import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { fillOperationIds, fillOperationIdsInText, planOperationIds } from '../src/index.js';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const read = (name) => readFileSync(fixture(name), 'utf8');
const ok = { responses: { 200: { description: 'ok' } } };

/** Build a minimal spec from { "GET /path": {...op} } shorthand. */
function spec(ops, extra = {}) {
  const paths = {};
  for (const [k, op] of Object.entries(ops)) {
    const [method, path] = k.split(' ');
    paths[path] ??= {};
    paths[path][method.toLowerCase()] = { ...ok, ...op };
  }
  return { openapi: '3.1.0', info: { title: 't', version: '1' }, paths, ...extra };
}

const ids = (s, opts) => Object.fromEntries(planOperationIds(s, opts).added.map((a) => [a.key, a.operationId]));

test('generates the expected ids for the 3.1 fixture', () => {
  const { added, warnings } = fillOperationIdsInText(read('petstore-3.1.yaml'));
  assert.deepEqual(Object.fromEntries(added.map((a) => [a.key, a.operationId])), {
    'callback path POST /subscriptions > onEvent > POST {$request.body#/callbackUrl}': 'createSubscriptionOnEvent',
    'path DELETE /users/{userId}': 'deleteUser',
    'path GET /': 'getRoot',
    'path GET /health': 'getHealth',
    'path GET /orgs/{orgId}/members/{userId}': 'getOrgMember',
    'path GET /orgs/{orgId}/users': 'listOrgUsers',
    'path GET /reports/{year}': 'getReportByYear',
    'path GET /reports/{year}/{month}': 'getReportByYearAndMonth',
    'path GET /teams/{teamId}/members/{userId}': 'getTeamMember',
    'path GET /users': 'listUsers',
    'path GET /users/me': 'getMe',
    'path GET /users/{userId}': 'getUser',
    'path GET /{id}': 'getById',
    'path PATCH /users/{userId}': 'updateUser',
    'path POST /subscriptions': 'createSubscription',
    'path POST /users': 'createUser',
    'path POST /users/{userId}/activate': 'createActivate',
    'path PUT /users/{userId}': 'replaceUser',
    'webhook POST newPet': 'createNewPetWebhook',
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /\/shared.*\$ref/);
});

test('YAML output keeps comments and leaves existing ids alone', () => {
  const { text } = fillOperationIdsInText(read('petstore-3.1.yaml'));
  assert.match(text, /# Users/);
  const out = YAML.parse(text);
  assert.equal(out.paths['/search'].get.operationId, 'searchEverything');
  assert.equal(out.components.pathItems.Shared.get.operationId, undefined);
  // inserted after tags/summary, before responses
  assert.deepEqual(Object.keys(out.paths['/users/{userId}'].get), ['tags', 'summary', 'operationId', 'responses']);
});

test('running twice is a no-op (idempotent)', () => {
  const once = fillOperationIdsInText(read('petstore-3.1.yaml')).text;
  const twice = fillOperationIdsInText(once);
  assert.equal(twice.added.length, 0);
  assert.equal(twice.text, once);
});

test('result does not depend on key order in the document', () => {
  const original = YAML.parse(read('petstore-3.1.yaml'));
  const reversed = structuredClone(original);
  reversed.paths = Object.fromEntries(
    Object.entries(original.paths)
      .reverse()
      .map(([p, item]) => [p, Object.fromEntries(Object.entries(item).reverse())]),
  );
  const byKey = (s) => planOperationIds(s).added.map((a) => `${a.key}=${a.operationId}`);
  assert.deepEqual(byKey(reversed), byKey(original));
});

test('adding an endpoint to an already-processed spec never renames existing ids', () => {
  const first = fillOperationIds(spec({ 'GET /users': {}, 'GET /users/{id}': {} })).spec;
  first.paths['/admin/users'] = { get: { ...ok } };
  const second = fillOperationIds(first);
  assert.equal(second.spec.paths['/users'].get.operationId, 'listUsers');
  assert.equal(second.spec.paths['/admin/users'].get.operationId, 'listAdminUsers');
});

test('collisions widen symmetrically: parents, then path params, then required query', () => {
  assert.deepEqual(
    ids(
      spec({
        'GET /v1/items': {},
        'GET /v2/items': {},
        'GET /files/{a}': {},
        'GET /files/{a}/{b}': {},
      }),
    ),
    {
      'path GET /files/{a}': 'getFileByA',
      'path GET /files/{a}/{b}': 'getFileByAAndB',
      'path GET /v1/items': 'listV1Items',
      'path GET /v2/items': 'listV2Items',
    },
  );
  const q = (name) => ({ parameters: [{ name, in: 'query', required: true, schema: {} }] });
  assert.deepEqual(ids(spec({ 'GET /things': q('kind'), 'GET /things/': q('type') })), {
    'path GET /things': 'listThingsWithKind',
    'path GET /things/': 'listThingsWithType',
  });
});

test('generated ids widen around existing ids, compared case-insensitively', () => {
  const s = spec({ 'GET /users': {}, 'GET /people': { operationId: 'ListUsers' }, 'GET /admin/users': {} });
  const result = ids(s);
  assert.equal(result['path GET /admin/users'], 'listAdminUsers');
  // /users has no parents, params or required query to widen with -> hash suffix
  assert.match(result['path GET /users'], /^listUsers_[0-9a-f]{4}$/);
});

test('indistinguishable routes fall back to a stable hash suffix', () => {
  const a = ids(spec({ 'GET /users': {}, 'GET /users/': {} }));
  const b = ids(spec({ 'GET /users/': {}, 'GET /users': {} }));
  assert.deepEqual(a, b);
  assert.match(a['path GET /users'], /^listUsers_[0-9a-f]{4}$/);
  assert.notEqual(a['path GET /users'], a['path GET /users/']);
});

test('supports other identifier cases', () => {
  const s = spec({ 'GET /user-groups/{groupId}': {}, 'GET /user-groups': {} });
  assert.deepEqual(Object.values(ids(s, { case: 'snake' })).sort(), ['get_user_group', 'list_user_groups']);
  assert.deepEqual(Object.values(ids(s, { case: 'pascal' })).sort(), ['GetUserGroup', 'ListUserGroups']);
  assert.deepEqual(Object.values(ids(s, { case: 'kebab' })).sort(), ['get-user-group', 'list-user-groups']);
});

test('OpenAPI 3.0 JSON keeps its indentation', () => {
  const text = read('simple-3.0.json');
  const { text: out, added } = fillOperationIdsInText(text, { filename: 'simple-3.0.json' });
  assert.deepEqual(
    added.map((a) => a.operationId),
    ['listPets', 'getPet', 'createPet'],
  );
  assert.match(out, /^\{\n {4}"openapi"/);
  assert.ok(out.endsWith('}\n'));
});

test('OpenAPI 3.2 query method and additionalOperations', () => {
  const s = {
    openapi: '3.2.0',
    info: { title: 't', version: '1' },
    paths: {
      '/documents': {
        query: { ...ok },
        additionalOperations: { LINK: { ...ok }, COPY: { ...ok } },
      },
    },
  };
  const { spec: out } = fillOperationIds(s);
  assert.equal(out.paths['/documents'].query.operationId, 'queryDocuments');
  assert.equal(out.paths['/documents'].additionalOperations.LINK.operationId, 'linkDocuments');
  assert.equal(out.paths['/documents'].additionalOperations.COPY.operationId, 'copyDocuments');
  assert.equal(s.paths['/documents'].query.operationId, undefined, 'input is not mutated');
});

test('rejects unsupported documents', () => {
  assert.throws(() => planOperationIds({ swagger: '2.0' }), /Swagger 2.0 is not supported/);
  assert.throws(() => planOperationIds({ openapi: '4.0.0' }), /Unsupported OpenAPI version/);
});

test('CLI --check exits 1 when ids are missing and 0 when complete', () => {
  const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
  assert.throws(() => execFileSync('node', [cli, fixture('petstore-3.1.yaml'), '--check'], { stdio: 'pipe' }), (err) => err.status === 1);
  const filled = fillOperationIdsInText(read('petstore-3.1.yaml')).text;
  execFileSync('node', [cli, '-', '--check', '-q'], { input: filled, stdio: ['pipe', 'pipe', 'pipe'] });
});

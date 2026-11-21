import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectVersion, isSuccessStatus, mediaTypeKey, normalizeSchemaKeywords, pathKey, pathParamNames, statusKey } from '../../src/normalize/normalize.ts';

test('detectVersion', () => {
  assert.equal(detectVersion({ openapi: '3.0.3' }), '3.0');
  assert.equal(detectVersion({ openapi: '3.1.1' }), '3.1');
  assert.equal(detectVersion({ openapi: '3.2.0' }), '3.2');
  assert.match((detectVersion({ swagger: '2.0' }) as { error: string }).error, /Swagger 2.0 is not supported/);
  assert.match((detectVersion({ openapi: '4.0.0' }) as { error: string }).error, /not supported/);
  assert.match((detectVersion({}) as { error: string }).error, /missing/);
  assert.match((detectVersion([]) as { error: string }).error, /not an object/);
});

test('path templates', () => {
  assert.equal(pathKey('/users/{id}/posts/{postId}'), '/users/{}/posts/{}');
  assert.deepEqual(pathParamNames('/users/{id}/posts/{postId}'), ['id', 'postId']);
});

test('status and media type keys', () => {
  assert.equal(statusKey('2xx'), '2XX');
  assert.equal(statusKey('Default'), 'default');
  assert.ok(isSuccessStatus('204') && isSuccessStatus('2xx'));
  assert.ok(!isSuccessStatus('302') && !isSuccessStatus('default'));
  assert.equal(mediaTypeKey('Application/JSON; Charset=UTF-8'), 'application/json;charset=utf-8');
});

test('3.0 schema keywords normalise to 3.1 semantics', () => {
  assert.deepEqual(normalizeSchemaKeywords({ type: 'string', nullable: true }, '3.0'), { type: ['null', 'string'] });
  assert.deepEqual(normalizeSchemaKeywords({ type: 'number', minimum: 1, exclusiveMinimum: true }, '3.0'), { type: 'number', exclusiveMinimum: 1 });
  assert.deepEqual(normalizeSchemaKeywords({ type: 'number', maximum: 5, exclusiveMaximum: false }, '3.0'), { type: 'number', maximum: 5 });
  assert.deepEqual(normalizeSchemaKeywords({ enum: ['a'], nullable: true }, '3.0'), { enum: ['a', null] });
  assert.deepEqual(normalizeSchemaKeywords({ type: 'string', example: 'x' }, '3.0'), { type: 'string', examples: ['x'] });
  // 3.1 type arrays are sorted and deduplicated, so order doesn't matter.
  assert.deepEqual(normalizeSchemaKeywords({ type: ['string', 'null'] }, '3.1'), normalizeSchemaKeywords({ type: ['null', 'string', 'null'] }, '3.1'));
  assert.deepEqual(normalizeSchemaKeywords({ type: ['string'] }, '3.1'), { type: 'string' });
  // 3.0 nullable and 3.1 type arrays end up identical.
  assert.deepEqual(normalizeSchemaKeywords({ type: 'string', nullable: true }, '3.0'), normalizeSchemaKeywords({ type: ['string', 'null'] }, '3.1'));
});

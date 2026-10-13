import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { sanitizeRevision } = require('../models-guard.cjs');
test('模型配置修订拒绝失去整数精度的IPC值', () => {
  for (const value of [Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, -1, 1.5, '1']) {
    assert.throws(() => sanitizeRevision(value), /bad-model-revision/);
  }
  assert.equal(sanitizeRevision(0), 0);
  assert.equal(sanitizeRevision(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
});
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { saveModelConfiguration } = require('../models-save.cjs');
test('首次凭据保存绑定配置回执修订且不发送引用', async () => {
  const calls = [];
  const view = { revision: 9, providers: [{ id: 'p', credentialRef: 'CORE_REF' }] };
  await saveModelConfiguration(async (method, params) => { calls.push([method, params]); return view; }, { id: 'p' }, 'secret-fixture', 8);
  assert.deepEqual(calls[1], ['model/registry/save-credential', { providerId: 'p', expectedRevision: 9, key: 'secret-fixture' }]);
});
test('配置与凭据之间发生冲突时保留部分保存事实，不泄露错误', async () => {
  const view = { revision: 9, providers: [{ id: 'p', credentialRef: 'CORE_REF' }] };
  const result = await saveModelConfiguration(async method => { if (method === 'model/registry/update') return view; throw Error('settings-conflict secret-fixture'); }, { id: 'p' }, 'secret-fixture', 8);
  assert.equal(result.saveStatus.configuration, 'saved');
  assert.equal(result.saveStatus.credential, 'failed');
  assert.equal(result.revision, 9);
  assert.equal(JSON.stringify(result).includes('secret-fixture'), false);
});
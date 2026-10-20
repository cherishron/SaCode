import {test} from 'node:test';
import assert from 'node:assert/strict';
import {realProviderCredential} from '../support/real-provider-credential.mjs';
test('真实模型测试必须显式启用且凭据只来自进程环境',()=>{
  assert.equal(realProviderCredential({STEPFUN_API_KEY:'fixture-only'}),'');
  assert.equal(realProviderCredential({SACODE_RUN_REAL_PROVIDER_TESTS:'1'}),'');
  assert.equal(realProviderCredential({SACODE_RUN_REAL_PROVIDER_TESTS:'1',STEPFUN_API_KEY:'fixture-only'}),'fixture-only');
});

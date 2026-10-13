import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { registerModelCredentialIpc } = require('../model-credential-ipc.cjs');
const guard = require('../models-guard.cjs');
test('密钥重试只发送供应商绑定动作，拒绝任意引用与无修订', async () => {
  let handler;
  const calls = [];
  registerModelCredentialIpc({ handle(name, fn) { assert.equal(name, 'sacode:modelsSaveCredential'); handler = fn; } }, async (...args) => { calls.push(args); return { saved: true }; }, guard);
  for (const args of [{ providerId: 'gw', key: 'test' }, { providerId: 'gw', key: '', expectedRevision: 1 }, { providerId: 'gw', key: 'test', expectedRevision: 1, ref: 'OTHER' }, { providerId: 'gw', key: 'test', expectedRevision: 2 ** 53 }]) await assert.rejects(handler(null, args));
  assert.equal(calls.length, 0);
  assert.deepEqual(await handler(null, { providerId: 'gw', key: 'test', expectedRevision: 3 }), { saved: true });
  assert.deepEqual(calls, [['model/registry/save-credential', { providerId: 'gw', key: 'test', expectedRevision: 3 }]]);
});
test('preload提供固定密钥重试通道且打包清单包含其处理模块', async () => {
  let api;
  const calls=[];
  vm.runInNewContext(readFileSync(new URL('../preload.cjs',import.meta.url),'utf8'),{
    require:()=>({contextBridge:{exposeInMainWorld:(_,v)=>{api=v;}},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve({saved:true});}}}),
  });
  await api.modelsSaveCredential('gw','fixture-key',4);
  assert.equal(calls[0][0],'sacode:modelsSaveCredential');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])),{providerId:'gw',key:'fixture-key',expectedRevision:4});
  const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(manifest.build.files.filter(f=>f==='model-credential-ipc.cjs').length,1);
});
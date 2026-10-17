import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const {HostBridge}=createRequire(import.meta.url)('../host-bridge.cjs');

test('真实默认模型选择拒绝旧修订及未知模型并跨重启恢复',{timeout:30000},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'sacode-default-'));
  const bridge=new HostBridge(process.env.SACODE_HOST||fileURLToPath(new URL('../dist/host/bin/sacode-host.exe',import.meta.url)),{...process.env,SACODE_USER_SETTINGS_DIR:join(dir,'settings')});
  t.after(()=>bridge.stop());await bridge.start(dir);
  const empty=await bridge.request('model/registry/describe');
  const saved=await bridge.request('model/registry/update',{draft:{id:'p',name:'默认测试',baseUrl:'https://example.com/v1',protocol:'openai-completions',models:['a','b'].map(id=>({id,name:id,contextWindow:'',maxTokens:'',image:false}))},expectedRevision:empty.revision});
  const selected=await bridge.request('model/registry/set-default',{providerId:'p',model:'b',expectedRevision:saved.revision});
  assert.equal(selected.defaultProviderId,'p');assert.equal(selected.defaultModel,'b');assert.equal(selected.revision,saved.revision+1);
  await assert.rejects(bridge.request('model/registry/set-default',{providerId:'p',model:'a',expectedRevision:saved.revision}),/settings-conflict/);
  await assert.rejects(bridge.request('model/registry/set-default',{providerId:'p',model:'missing',expectedRevision:selected.revision}),/settings-rejected/);
  await assert.rejects(bridge.request('model/registry/set-default',{providerId:'missing',model:'a',expectedRevision:selected.revision}),/settings-rejected/);
  const after=await bridge.request('model/registry/describe');assert.equal(after.defaultModel,'b');assert.equal(after.revision,selected.revision);
  await bridge.stop();await bridge.start(dir);
  const replay=await bridge.request('model/registry/describe');assert.equal(replay.defaultProviderId,'p');assert.equal(replay.defaultModel,'b');assert.equal(replay.revision,selected.revision);
});

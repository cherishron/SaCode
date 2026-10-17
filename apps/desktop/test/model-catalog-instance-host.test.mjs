import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const {HostBridge}=createRequire(import.meta.url)('../host-bridge.cjs');

test('目录实例真实Host绑定修订且拒绝任意凭据引用',{timeout:30000},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'sacode-catalog-instance-'));
  const bridge=new HostBridge(process.env.SACODE_HOST||fileURLToPath(new URL('../dist/host/bin/sacode-host.exe',import.meta.url)),{...process.env,SACODE_USER_SETTINGS_DIR:join(dir,'settings')});
  t.after(()=>bridge.stop());await bridge.start(dir);
  assert.ok((await bridge.request('initialize')).capabilities.includes('model/registry/create-instance'));
  const first=await bridge.request('model/registry/create-instance',{catalogId:'stepfun',expectedRevision:0});
  assert.equal(first.providers.length,1);assert.equal(first.providers[0].declared,true);
  await assert.rejects(bridge.request('model/registry/create-instance',{catalogId:'stepfun',expectedRevision:0}),/settings-conflict/);
  for(const args of [{catalogId:'stepfun'},{catalogId:'stepfun',expectedRevision:-1},{catalogId:'stepfun',expectedRevision:first.revision,credentialRef:'ARBITRARY'}])await assert.rejects(bridge.request('model/registry/create-instance',args),/bad-model-catalog-request/);
  await assert.rejects(bridge.request('model/registry/create-instance',{catalogId:'missing',expectedRevision:first.revision}),/settings-rejected/);
  assert.equal((await bridge.request('model/registry/describe')).revision,first.revision);
  const second=await bridge.request('model/registry/create-instance',{catalogId:'stepfun',expectedRevision:first.revision});
  assert.equal(second.providers.length,2);assert.notEqual(second.providers[0].id,second.providers[1].id);assert.notEqual(second.providers[0].credentialRef,second.providers[1].credentialRef);
  await bridge.stop();await bridge.start(dir);assert.equal((await bridge.request('model/registry/describe')).providers.length,2);
});

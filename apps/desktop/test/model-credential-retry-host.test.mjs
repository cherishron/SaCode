import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const {HostBridge}=createRequire(import.meta.url)('../host-bridge.cjs');
const host=process.env.SACODE_HOST||fileURLToPath(new URL('../dist/host/bin/sacode-host.exe',import.meta.url));
test('真实Host凭据重试绑定修订并拒绝陈旧写入', {timeout:30000}, async t=>{
  assert.ok(existsSync(host),'需要本批源码构建的Host');
  const dir=mkdtempSync(join(tmpdir(),'sacode-key-retry-'));
  const settings=join(dir,'settings');
  const bridge=new HostBridge(host,{...process.env,SACODE_USER_SETTINGS_DIR:settings});t.after(()=>bridge.stop());
  await bridge.start(dir);
  const init=await bridge.request('initialize');assert.ok(init.capabilities.includes('model/registry/save-credential'));
  const empty=await bridge.request('model/registry/describe');
  const saved=await bridge.request('model/registry/update',{draft:{id:'mine',name:'测试',baseUrl:'https://example.com/v1',protocol:'openai-completions',models:[{id:'m',name:'模型',contextWindow:'',maxTokens:'',image:false}]},expectedRevision:empty.revision});
  const params={providerId:'mine',expectedRevision:saved.revision,key:'fixture-first-key'};
  assert.deepEqual(await bridge.request('model/registry/save-credential',params),{saved:true});
  const after=await bridge.request('model/registry/describe');assert.equal(after.revision,saved.revision);assert.equal(after.providers[0].keyConfigured,true);assert.equal(JSON.stringify(after).includes(params.key),false);
  const file=join(settings,'credentials.env');const before=readFileSync(file,'utf8');
  const next=await bridge.request('model/registry/set-enabled',{providerId:'mine',expectedRevision:saved.revision,enabled:'false'});
  await assert.rejects(bridge.request('model/registry/save-credential',{...params,key:'fixture-stale-key'}),/settings-conflict/);
  await assert.rejects(bridge.request('model/registry/save-credential',{...params,providerId:'missing',expectedRevision:next.revision}),/credential-save-failed/);
  for(const bad of [{...params,expectedRevision:-1},{...params,ref:'ARBITRARY'},{...params,key:''}])await assert.rejects(bridge.request('model/registry/save-credential',bad),/bad-model-credential-request/);
  assert.equal(readFileSync(file,'utf8'),before);
  assert.deepEqual(await bridge.request('model/registry/save-credential',{...params,expectedRevision:next.revision,key:'fixture-second-key'}),{saved:true});
  assert.equal((await bridge.request('model/registry/describe')).revision,next.revision);
});

test('preload经真实IPC处理器到Host的凭据重试链', {timeout:30000}, async t=>{
  const require=createRequire(import.meta.url);
  const {registerModelCredentialIpc}=require('../model-credential-ipc.cjs');
  const dir=mkdtempSync(join(tmpdir(),'sacode-key-ipc-host-'));
  const bridge=new HostBridge(host,{...process.env,SACODE_USER_SETTINGS_DIR:join(dir,'settings')});
  t.after(()=>bridge.stop());await bridge.start(dir);
  const empty=await bridge.request('model/registry/describe');
  const saved=await bridge.request('model/registry/update',{draft:{id:'ipc',name:'IPC测试',baseUrl:'https://example.com/v1',protocol:'openai-completions',models:[{id:'m',name:'模型',contextWindow:'',maxTokens:'',image:false}]},expectedRevision:empty.revision});
  const handlers=new Map();let api;
  registerModelCredentialIpc({handle:(name,fn)=>handlers.set(name,fn)},(method,args)=>bridge.request(method,args),require('../models-guard.cjs'));
  vm.runInNewContext(readFileSync(new URL('../preload.cjs',import.meta.url),'utf8'),{
    require:()=>({contextBridge:{exposeInMainWorld:(_,value)=>{api=value;}},ipcRenderer:{invoke:(name,args)=>{
      assert.ok(handlers.has(name),'必须调用已注册的有限IPC');return handlers.get(name)(null,args);
    }}}),
  });
  assert.deepEqual(await api.modelsSaveCredential('ipc','fixture-ipc-key',saved.revision),{saved:true});
  const after=await bridge.request('model/registry/describe');
  assert.equal(after.revision,saved.revision);assert.equal(after.providers[0].keyConfigured,true);
  const changed=await bridge.request('model/registry/set-enabled',{providerId:'ipc',expectedRevision:saved.revision,enabled:'false'});
  await assert.rejects(api.modelsSaveCredential('ipc','fixture-stale-key',saved.revision),/settings-conflict/);
  await assert.rejects(api.modelsSaveCredential('ipc','fixture-key',2**53),/bad-model-revision/);
  assert.equal((await bridge.request('model/registry/describe')).revision,changed.revision);
});

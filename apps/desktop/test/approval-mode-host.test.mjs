import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const {HostBridge}=createRequire(import.meta.url)('../host-bridge.cjs');

test('权限模式真实Host持久切换、非法参数拒绝与重启回读',{timeout:30000},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'sacode-mode-host-'));
  const bridge=new HostBridge(process.env.SACODE_HOST||fileURLToPath(new URL('../dist/host/bin/sacode-host.exe',import.meta.url)),{...process.env,SACODE_USER_SETTINGS_DIR:join(dir,'settings')});
  t.after(()=>bridge.stop());await bridge.start(dir);
  const init=await bridge.request('initialize');assert.ok(init.capabilities.includes('approval/get-mode'));assert.ok(init.capabilities.includes('approval/set-mode'));
  assert.deepEqual(await bridge.request('approval/get-mode'),{ok:true,mode:'build'});
  for(const mode of ['plan','auto','yolo','build']){
    assert.deepEqual(await bridge.request('approval/set-mode',{mode}),{ok:true,result:'committed'});
    assert.deepEqual(await bridge.request('approval/get-mode'),{ok:true,mode});
  }
  assert.deepEqual(await bridge.request('approval/set-mode',{mode:'build'}),{ok:true,result:'noop'});
  const before=await bridge.request('session/projection');
  for(const args of [{mode:'unknown'},{mode:42},{mode:'yolo',extra:'value'},{}])await assert.rejects(bridge.request('approval/set-mode',args),/bad-approval-mode/);
  const after=await bridge.request('session/projection');assert.equal(after.events,before.events);assert.equal(after.pending,0);
  await bridge.request('approval/set-mode',{mode:'plan'});await bridge.stop();await bridge.start(dir);
  assert.deepEqual(await bridge.request('approval/get-mode'),{ok:true,mode:'plan'});
});

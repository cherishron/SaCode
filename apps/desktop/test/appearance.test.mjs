import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { HostBridge }=require('../host-bridge.cjs');
const host=process.env.DSH_HOST || resolve('dist/host/bin/dsh-host.exe');

test('外观保存跨落盘屏障，重启恢复且不污染模型消息', async()=>{
  const dir=mkdtempSync(join(tmpdir(),'sacode-appearance-'));
  writeFileSync(join(dir,'session.log'),'0\tuser/message\t任务\n');
  const first=new HostBridge(host,process.env);
  await first.start(dir);
  try {
    const handshake=await first.request('initialize');
    assert.ok(handshake.capabilities.includes('appearance/get'));
    assert.ok(handshake.capabilities.includes('appearance/set-theme'));
    assert.equal((await first.request('appearance/get')).theme,'system');
    await assert.rejects(()=>first.request('appearance/set-theme',{theme:'unknown'}),/bad-theme/);
    const response=await first.request('appearance/set-theme',{theme:'dark'});
    assert.equal(response.saved,true);
    assert.equal(response.changed,true);
    assert.match(readFileSync(join(dir,'session.log'),'utf8'),/appearance\/theme\tdark/);
    assert.equal((await first.request('appearance/set-theme',{theme:'dark'})).changed,false);
    const projection=await first.request('session/projection');
    assert.equal(projection.messages.length,1);
    assert.equal(projection.pending,0);
  } finally { await first.stop(); }
  const second=new HostBridge(host,process.env);
  await second.start(dir);
  try { assert.equal((await second.request('appearance/get')).theme,'dark'); }
  finally { await second.stop(); }
});

test('另一写者持有租约时拒绝主题变更，不覆盖原日志', async()=>{
  const dir=mkdtempSync(join(tmpdir(),'sacode-appearance-lock-'));
  writeFileSync(join(dir,'session.log'),'0\tuser/message\t任务\n');
  const writer=new HostBridge(host,process.env), reader=new HostBridge(host,process.env);
  await writer.start(dir); await reader.start(dir);
  try {
    await writer.request('session/submit',{eventType:'user/message',data:'待保存'});
    assert.equal((await reader.request('appearance/get')).theme,'system');
    await assert.rejects(()=>reader.request('appearance/set-theme',{theme:'light'}),/already-owned/);
    assert.doesNotMatch(readFileSync(join(dir,'session.log'),'utf8'),/appearance\/theme/);
  } finally { await reader.stop(); await writer.stop(); }
});

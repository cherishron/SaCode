import { fixtureHostEnv } from '../test-support/fixture-env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { HostBridge }=require('../host-bridge.cjs');
const host=process.env.SACODE_HOST || resolve('dist/host/bin/sacode-host.exe');
const boot=async()=>{
  const dir=mkdtempSync(join(tmpdir(),'sacode-session-management-'));
  writeFileSync(join(dir,'session.log'),'0\tuser/message\t原会话\n');
  const bridge=new HostBridge(host, fixtureHostEnv(dir)); await bridge.start(dir);
  return {dir,bridge};
};

test('新建与切换隔离消息、主题、预算，结算旧写入并在重启后恢复选择', async()=>{
  const {dir,bridge}=await boot();
  let id;
  try {
    const capability=(await bridge.request('initialize')).capabilities;
    assert.ok(capability.includes('session/create') && capability.includes('session/select'));
    await bridge.request('appearance/set-theme',{theme:'dark'});
    await bridge.request('usage/set-budget',{budget:7});
    await bridge.request('session/submit',{eventType:'user/message',data:'切换前未保存'});
    id=(await bridge.request('session/create',{title:'中文新会话'})).id;
    const selected=await bridge.request('session/select',{sessionId:id});
    assert.equal(selected.saved,true); assert.equal(selected.theme,'system');
    assert.match(readFileSync(join(dir,'session.log'),'utf8'),/切换前未保存/);
    assert.deepEqual((await bridge.request('session/projection')).messages,[]);
    assert.equal((await bridge.request('usage/status')).budget,200000);
    assert.equal((await bridge.request('appearance/get')).theme,'system');
    await bridge.request('session/append',{eventType:'user/message',data:'只属于新会话'});
    await bridge.request('session/select',{sessionId:'current'});
    const old=(await bridge.request('session/projection')).messages.join('\n');
    assert.match(old,/切换前未保存/); assert.doesNotMatch(old,/只属于新会话/);
    assert.equal((await bridge.request('usage/status')).budget,7);
    assert.equal((await bridge.request('appearance/get')).theme,'dark');
    await bridge.request('session/select',{sessionId:id});
  } finally { await bridge.stop(); }
  const restarted=new HostBridge(host, fixtureHostEnv(dir)); await restarted.start(dir);
  try {
    assert.equal((await restarted.request('session/catalog')).entries.find(e=>e.current).id,id);
    assert.deepEqual((await restarted.request('session/projection')).messages,['user/message: 只属于新会话']);
    await assert.rejects(()=>restarted.request('session/select',{sessionId:'../session.log'}),/unknown-session/);
    assert.equal((await restarted.request('session/catalog')).entries.find(e=>e.current).id,id);
  } finally { await restarted.stop(); }
});

test('待审批及已允许但未消费工单禁止切换，消费后才可切换', async()=>{
  const {bridge}=await boot();
  try {
    const {id}=await bridge.request('session/create',{title:'另一会话'});
    const ticket=await bridge.request('approval/ask',{name:'write'});
    await assert.rejects(()=>bridge.request('session/select',{sessionId:id}),/session-resources-in-flight/);
    await bridge.request('approval/answer',{approvalId:ticket.approvalId,decision:'allowed-once'});
    await assert.rejects(()=>bridge.request('session/select',{sessionId:id}),/session-resources-in-flight/);
    await bridge.request('extension/call',{name:'write',args:'management.txt 正文',approvalId:ticket.approvalId});
    assert.equal((await bridge.request('session/select',{sessionId:id})).selected,true);
    assert.equal((await bridge.request('approval/answer',{approvalId:ticket.approvalId,decision:'denied'})).accepted,false);
  } finally { await bridge.stop(); }
});

test('执行中不能切换，取消结算后才能打开另一会话', async()=>{
  const {bridge}=await boot();
  try {
    const {id}=await bridge.request('session/create',{title:'另一会话'});
    await bridge.request('turn/start',{limit:32});
    await assert.rejects(()=>bridge.request('session/select',{sessionId:id}),/turn-in-flight/);
    await bridge.request('turn/cancel');
    for (let i=0;i<100;i++) {
      if ((await bridge.request('turn/poll')).settled) break;
      await new Promise(r=>setTimeout(r,20));
    }
    assert.equal((await bridge.request('session/select',{sessionId:id})).selected,true);
  } finally { await bridge.stop(); }
});

test('选择落盘失败不报告成功，不允许继续写入错误会话', async()=>{
  const {dir,bridge}=await boot();
  const path=join(dir,'session.log');
  const stdout=[];
  bridge.proc.stdout.on('data',data=>stdout.push(data.toString('utf8')));
  try {
    const first=(await bridge.request('session/create',{title:'第一会话'})).id;
    const second=(await bridge.request('session/create',{title:'第二会话'})).id;
    await bridge.request('session/select',{sessionId:first});
    const original=readFileSync(path,'utf8');
    chmodSync(path,0o444);
    await assert.rejects(()=>bridge.request('session/select',{sessionId:second}),/selection-flush-failed/);
    assert.equal((await bridge.request('session/catalog')).entries.find(e=>e.current).id,first);
    assert.equal(readFileSync(path,'utf8'),original);
    await assert.rejects(()=>bridge.request('session/append',{eventType:'user/message',data:'禁止错误写入'}),/restart-required/);
    for (const line of stdout.join('').trim().split('\n')) assert.doesNotThrow(()=>JSON.parse(line));
  } finally { chmodSync(path,0o666); await bridge.stop(); }
});

test('重启发现所选目录丢失时拒绝静默回退，显式选择可用会话后恢复', async()=>{
  const dir=mkdtempSync(join(tmpdir(),'sacode-selection-missing-'));
  const original='0\tuser/message\t原会话\n1\tworkspace/session-selected\tsessions/missing\n';
  writeFileSync(join(dir,'session.log'),original);
  const bridge=new HostBridge(host, fixtureHostEnv(dir)); await bridge.start(dir);
  try {
    assert.equal((await bridge.request('initialize')).protocolVersion,'0.1');
    await assert.rejects(()=>bridge.request('session/projection'),/selection-replay-rejected/);
    await assert.rejects(()=>bridge.request('session/append',{eventType:'user/message',data:'不能回退写入'}),/selection-replay-rejected/);
    assert.equal(readFileSync(join(dir,'session.log'),'utf8'),original);
    assert.equal((await bridge.request('session/catalog')).entries.some(e=>e.current),false);
    assert.equal((await bridge.request('session/select',{sessionId:'current'})).selected,true);
    assert.deepEqual((await bridge.request('session/projection')).messages,['user/message: 原会话']);
  } finally { await bridge.stop(); }
});

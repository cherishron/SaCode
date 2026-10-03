import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,chmodSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {HostBridge}=require('../host-bridge.cjs');
const host=process.env.DSH_HOST || resolve('dist/host/bin/dsh-host.exe');
const boot=async()=>{
  const dir=mkdtempSync(join(tmpdir(),'sacode-workspace-'));
  const project=join(dir,'中文 项目'); mkdirSync(project);
  writeFileSync(join(dir,'session.log'),'0\tuser/message\t任务\n');
  const bridge=new HostBridge(host,process.env); await bridge.start(dir);
  return {dir,project,bridge};
};

test('项目目录持久恢复，真实相对文件工具写入所选目录，切换会话隔离目录',async()=>{
  const {dir,project,bridge}=await boot();
  try {
    assert.equal((await bridge.request('workspace/get')).configured,false);
    const saved=await bridge.request('workspace/set-directory',{directory:project});
    assert.equal(saved.saved,true);
    const ticket=await bridge.request('approval/ask',{name:'write'});
    await bridge.request('approval/answer',{approvalId:ticket.approvalId,decision:'allowed-once'});
    await bridge.request('extension/call',{name:'write',args:'workspace.txt 工作区正文',approvalId:ticket.approvalId});
    assert.equal(readFileSync(join(project,'workspace.txt'),'utf8'),'工作区正文');
    assert.equal(existsSync(join(dir,'workspace.txt')),false);
    assert.match((await bridge.request('extension/call',{name:'read',args:'workspace.txt'})).result,/工作区正文/);
    const second=(await bridge.request('session/create',{title:'独立会话'})).id;
    await bridge.request('session/select',{sessionId:second});
    assert.equal((await bridge.request('workspace/get')).configured,false);
    await bridge.request('session/select',{sessionId:'current'});
    assert.equal((await bridge.request('workspace/get')).directory,saved.directory);
    const before=readFileSync(join(dir,'session.log'),'utf8');
    await assert.rejects(()=>bridge.request('workspace/set-directory',{directory:join(project,'workspace.txt')}),/bad-workspace-directory/);
    assert.equal(readFileSync(join(dir,'session.log'),'utf8'),before);
  } finally {await bridge.stop();}
  const fresh=new HostBridge(host,process.env); await fresh.start(dir);
  try {assert.equal((await fresh.request('workspace/get')).configured,true);}
  finally {await fresh.stop();}
});

test('待审批工单与另一写者的租约禁止改变项目目录',async()=>{
  const {dir,project,bridge}=await boot();
  const reader=new HostBridge(host,process.env); await reader.start(dir);
  try {
    const ticket=await bridge.request('approval/ask',{name:'write'});
    await assert.rejects(()=>bridge.request('workspace/set-directory',{directory:project}),/session-resources-in-flight/);
    await assert.rejects(()=>reader.request('workspace/set-directory',{directory:project}),/already-owned/);
    assert.equal((await reader.request('workspace/get')).configured,false);
    await bridge.request('approval/answer',{approvalId:ticket.approvalId,decision:'denied'});
    assert.equal((await bridge.request('workspace/set-directory',{directory:project})).saved,true);
  } finally {await reader.stop();await bridge.stop();}
});

test('目录配置落盘失败后保留原目录并禁止错误路径写入',async()=>{
  const {dir,project,bridge}=await boot();
  const path=join(dir,'session.log');
  try {
    chmodSync(path,0o444);
    await assert.rejects(()=>bridge.request('workspace/set-directory',{directory:project}),/workspace-flush-failed/);
    assert.equal((await bridge.request('workspace/get')).configured,false);
    await assert.rejects(()=>bridge.request('extension/call',{name:'read',args:'workspace.txt'}),/workspace-failed-restart-required/);
  } finally {chmodSync(path,0o666);await bridge.stop();}
});

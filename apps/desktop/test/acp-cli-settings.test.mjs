import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,existsSync} from 'node:fs';
import {join,delimiter,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const {HostBridge}=createRequire(import.meta.url)('../host-bridge.cjs');
function environment(){
  const env={...process.env};
  for(const key of Object.keys(env))if(/cangjie|stdx/i.test(key))delete env[key];
  const pathKey=Object.keys(env).find(key=>key.toLowerCase()==='path');
  if(pathKey)env[pathKey]=env[pathKey].split(delimiter).filter(value=>!/cangjie|stdx/i.test(value)).join(delimiter);
  return env;
}
function run(root,...args){return spawnSync(process.env.SACODE_CLI,['acp',...args],{cwd:root,env:environment(),encoding:'utf8',windowsHide:true,timeout:20000});}

test('无SDK的CLI与Host共享ACP配置、修订和写租约',{timeout:40000},async t=>{
  assert.ok(process.env.SACODE_CLI,'需要本批CLI');assert.ok(process.env.SACODE_HOST,'需要本批Host');
  const root=mkdtempSync(join(tmpdir(),'sacode-acp-cli-'));
  const initial=run(root,'settings');assert.equal(initial.status,0,initial.stderr);assert.equal(JSON.parse(initial.stdout).enabled,false);
  const enabled=run(root,'enable','0');assert.equal(enabled.status,0,enabled.stderr);assert.equal(JSON.parse(enabled.stdout).revision,1);
  const stale=run(root,'disable','0');assert.equal(stale.status,1);assert.match(stale.stderr,/revision-conflict/);
  const bridge=new HostBridge(process.env.SACODE_HOST,{...environment(),SACODE_USER_SETTINGS_DIR:join(root,'settings')});
  await bridge.start(root);t.after(()=>bridge.stop());
  assert.deepEqual(await bridge.request('acp/settings/describe',{sessionId:'current'}),JSON.parse(enabled.stdout));
  const disabled=await bridge.request('acp/settings/set-enabled',{sessionId:'current',enabled:false,revision:1});
  const readonly=run(root,'settings');assert.equal(readonly.status,0,readonly.stderr);assert.deepEqual(JSON.parse(readonly.stdout),disabled);
  const owned=run(root,'enable','2');assert.equal(owned.status,1);assert.match(owned.stderr,/already-owned/);
  await bridge.stop();const reopened=run(root,'enable','2');assert.equal(reopened.status,0,reopened.stderr);assert.equal(JSON.parse(reopened.stdout).revision,3);
  const log=readFileSync(join(root,'session.log'),'utf8');assert.equal(log.includes('acp/admission'),false);assert.equal(log.includes('acp/task/start'),false);
});

test('CLI拒绝非法修订，未知动作不创建日志',()=>{
  assert.ok(process.env.SACODE_CLI);
  const root=mkdtempSync(join(tmpdir(),'sacode-acp-cli-invalid-'));
  for(const revision of ['-1','wrong'])assert.equal(run(root,'enable',revision).status,1);
  assert.equal(run(root,'start').status,64);assert.equal(existsSync(join(root,'session.log')),false);
});

test('CLI只读OpenCode探针以非零状态报告未就绪，不创建任务',{
  timeout:30000,skip:!process.env.SACODE_ACP_OPENCODE_TEST_EXECUTABLE,
},async t=>{
  assert.ok(process.env.SACODE_CLI);
  const root=mkdtempSync(join(tmpdir(),'sacode-acp-cli-probe-'));
  const result=spawnSync(process.env.SACODE_CLI,['acp','probe'],{cwd:root,env:{...environment(),SACODE_ACP_OPENCODE_EXECUTABLE:process.env.SACODE_ACP_OPENCODE_TEST_EXECUTABLE},encoding:'utf8',windowsHide:true,timeout:20000});
  assert.ok([0,2].includes(result.status),result.stderr);const report=JSON.parse(result.stdout);
  assert.equal(report.peerId,'opencode');assert.equal(report.modelTaskTested,false);
  console.log('CLI OpenCode 只读状态：'+JSON.stringify(report));
  if(result.status===0){assert.equal(report.environment,'installed-usable');assert.equal(report.verdict,'measured');}
  else assert.notEqual(report.environment==='installed-usable'&&report.localCredentialPrecondition&&report.verdict==='measured'&&report.protocolVersion===1,true);
  assert.equal(existsSync(join(root,'session.log')),false);
  assert.ok(process.env.SACODE_HOST);
  const bridge=new HostBridge(process.env.SACODE_HOST,{...environment(),SACODE_ACP_OPENCODE_EXECUTABLE:process.env.SACODE_ACP_OPENCODE_TEST_EXECUTABLE,SACODE_USER_SETTINGS_DIR:join(root,'settings')});
  await bridge.start(root);t.after(()=>bridge.stop());await bridge.request('workspace/set-directory',{sessionId:'current',directory:root});
  assert.deepEqual(await bridge.request('acp/provider/probe',{sessionId:'current'}),report);await bridge.stop();
});

test('CLI从真实npm shim自动发现二进制，不依赖手工覆盖路径',{
  timeout:30000,skip:process.platform!=='win32'||!process.env.SACODE_ACP_OPENCODE_TEST_EXECUTABLE,
},t=>{
  const shimDirectory=resolve(dirname(process.env.SACODE_ACP_OPENCODE_TEST_EXECUTABLE),'../../../..');
  if(!existsSync(join(shimDirectory,'opencode.cmd'))){t.skip('当前安装不是此npm shim布局');return;}
  const env=environment();delete env.SACODE_ACP_OPENCODE_EXECUTABLE;
  const pathKey=Object.keys(env).find(key=>key.toLowerCase()==='path')||'PATH';env[pathKey]=[shimDirectory,env[pathKey]||''].join(delimiter);
  const root=mkdtempSync(join(tmpdir(),'sacode-acp-cli-discovery-'));
  const result=spawnSync(process.env.SACODE_CLI,['acp','probe'],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:20000});
  assert.ok([0,2].includes(result.status),result.stderr);const report=JSON.parse(result.stdout);
  assert.equal(report.peerId,'opencode');assert.equal(report.modelTaskTested,false);assert.equal(existsSync(join(root,'session.log')),false);
});

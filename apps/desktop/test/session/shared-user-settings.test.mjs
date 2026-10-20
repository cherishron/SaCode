// 两份目录包通过真实 Host 回读共享配置；仅使用临时合成用户，不读取私人凭据。
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const desktop = fileURLToPath(new URL('../..', import.meta.url));
const repo = resolve(desktop, '../..');
const tmp = join(repo, 'target/tmp');
mkdirSync(tmp, {recursive:true});
const root = mkdtempSync(join(tmp, 'shared-settings-20261019-'));
const home = join(root, 'home');
const worker = String.raw`
const {join}=require('node:path');
const desktop=process.env.TEST_DESKTOP;
const {configureDataPaths}=require(join(desktop,'data-paths.cjs'));
const paths=configureDataPaths({app:{isPackaged:true,getPath:n=>n==='exe'?join(process.env.TEST_INSTALL,'SaCode.exe'):join(process.env.TEST_INSTALL,'appdata'),setPath(){}},env:process.env,platform:'win32',isolated:process.env.TEST_ISOLATED==='1'});
(async()=>{
 if(!process.env.TEST_HOST){console.log(JSON.stringify(paths));return;}
 const {HostBridge}=require(join(desktop,'host-bridge.cjs'));
 const bridge=new HostBridge(process.env.TEST_HOST,{...process.env,SACODE_USER_SETTINGS_DIR:paths.settings});
 try{
  await bridge.start(paths.sessions);
  await bridge.request('initialize');
  let view=await bridge.request('model/registry/describe');
  if(process.env.TEST_SEED==='1'){
   await require(join(desktop,'models-save.cjs')).saveModelConfiguration((m,p)=>bridge.request(m,p),{id:'shared-fixture',name:'共享配置测试',baseUrl:'https://invalid.example/v1',protocol:'openai-completions',models:[{id:'fixture-model',name:'合成模型',contextWindow:'',maxTokens:'',image:false}]},'invalid-fixture-only',view.revision);
   view=await bridge.request('model/registry/describe');
  }
  const provider=view.providers.find(p=>p.id==='shared-fixture');
  console.log(JSON.stringify({pid:process.pid,hostPid:bridge.proc.pid,install:process.env.TEST_INSTALL,dataRoot:paths.root,settingsRoot:paths.settings,providersCount:view.providers.length,providerId:provider?.id,credentialConfigured:provider?.keyConfigured===true}));
 }finally{await bridge.stop();}
})().catch(()=>{console.error('共享配置验证失败，底层消息已隐藏');process.exitCode=1;});
`;
function run(extra={}) {
  const env={...process.env,USERPROFILE:home,HOME:home,TEST_DESKTOP:desktop,TEST_INSTALL:join(root,'install-a'),...extra};
  delete env.SACODE_USER_SETTINGS_DIR;
  delete env.SACODE_DATA_DIR;
  Object.assign(env,extra);
  const result=spawnSync(process.execPath,['-e',worker],{env,encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr);
  return JSON.parse(result.stdout.trim());
}
test('不同安装目录默认共用用户配置，数据目录保持独立',()=>{
  const a=run(), b=run({TEST_INSTALL:join(root,'install-b')});
  assert.equal(a.settings,join(home,'.sacode/user'));
  assert.equal(a.settings,b.settings);
  assert.notEqual(a.root,b.root);
});
test('不同 SACODE_DATA_DIR 不改变默认配置根',()=>{
  const a=run({SACODE_DATA_DIR:join(root,'data-a')}),b=run({SACODE_DATA_DIR:join(root,'data-b')});
  assert.equal(a.settings,b.settings); assert.notEqual(a.sessions,b.sessions);
});
test('显式用户配置目录覆盖仍优先',()=>{
  const settings=join(root,'explicit-settings');
  assert.equal(run({SACODE_USER_SETTINGS_DIR:settings}).settings,settings);
});
test('隔离模式不加载共享用户配置',()=>assert.equal(run({TEST_ISOLATED:'1'}),null));
test('两份目录包的真实 Host 共享提供方及凭据配置状态', {skip:!process.env.SACODE_CANDIDATE_ROOT},()=>{
  const candidate=process.env.SACODE_CANDIDATE_ROOT;
  const rows=[];
  for(const [name,seed] of [['install-a','1'],['install-b','0'],['install-a','0']]){
    const install=join(candidate,'sharing',name);
    rows.push(run({TEST_INSTALL:install,TEST_DESKTOP:join(install,'extracted'),TEST_HOST:join(install,'resources/host/bin/sacode-host.exe'),SACODE_DATA_DIR:join(candidate,'sharing',name+'-data'),TEST_SEED:seed}));
  }
  for(const row of rows){assert.equal(row.settingsRoot,join(home,'.sacode/user'));assert.equal(row.providersCount,1);assert.equal(row.providerId,'shared-fixture');assert.equal(row.credentialConfigured,true);}
  assert.notEqual(rows[0].dataRoot,rows[1].dataRoot);
  assert.notEqual(rows[0].hostPid,rows[1].hostPid);
  writeFileSync(join(candidate,'configuration-sharing.json'),JSON.stringify({scope:'两份完整目录包；Node 主进程驱动包内同字节配置解析器及真实 Host，顺序启动并正常停止；未启动 Electron 窗口，不算 GUI 验收',syntheticHome:home,privateCredentialsRead:false,modelRequests:0,rows},null,2));
});

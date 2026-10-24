import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {HostBridge}=require('../../../desktop/host-bridge.cjs');
const repo=fileURLToPath(new URL('../../../../',import.meta.url));
const host=process.env.SACODE_HOST;
const definition={id:'db-local',title:'本地只读库',kind:'database',enabled:false,spec:{engine:'postgresql',host:'localhost',port:5432,database:'demo',user:'tester',credentialRef:'DB_TEST_PASSWORD',tlsMode:'verify-full'}};

async function fixture(run){
  assert.ok(host,'须提供本轮构建的 SACODE_HOST，缺少宿主不计通过');
  const root=join(repo,'target/tmp/connection-definition-host');mkdirSync(root,{recursive:true});
  const dir=mkdtempSync(join(root,'run-'));
  writeFileSync(join(dir,'session.log'),'0\tsession/title\t连接测试\n');
  const env={...process.env,TMP:dir,TEMP:dir,SACODE_USER_SETTINGS_DIR:join(dir,'settings'),SACODE_PROVIDER_BASE_URL:'',SACODE_PROVIDER_MODEL:'',SACODE_PROVIDER_KEY:''};
  let bridge;
  const boot=async()=>{bridge=new HostBridge(host,env);await bridge.start(dir);await bridge.request('initialize');const catalog=await bridge.request('session/catalog');return catalog.entries.find(x=>x.current).id;};
  const request=(method,params)=>bridge.request(method,params);
  const stop=async()=>{const result=await bridge.stop();assert.deepEqual(result,{code:0,signal:null,forced:false});};
  try{await run({boot,request,stop,dir});}finally{if(bridge?.proc?.exitCode===null)await bridge.stop();}
}

test('连接定义经真实 Host 保存与重启回读，启用不等于启动连接', {timeout:45000},async()=>fixture(async({boot,request,stop,dir})=>{
  let sessionId=await boot();
  const owner=()=>({sessionId,scope:'user'});
  const empty=await request('connection/list',owner());assert.equal(empty.revision,0);assert.deepEqual(empty.definitions,[]);
  const saved=await request('connection/save',{...owner(),revision:0,definition});
  assert.equal(saved.revision,1);assert.deepEqual(saved.definitions,[definition]);
  assert.equal(Object.hasOwn(saved.definitions[0],'connected'),false);
  await assert.rejects(request('connection/save',{...owner(),revision:0,definition:{...definition,title:'过期覆盖'}}),/connection-revision-conflict/);
  await stop();sessionId=await boot();
  const replay=await request('connection/list',owner());assert.deepEqual(replay,saved);
  const enabled=await request('connection/control',{...owner(),revision:1,id:definition.id,action:'enable'});
  assert.equal(enabled.definitions[0].enabled,true);assert.equal(Object.hasOwn(enabled.definitions[0],'connected'),false);
  const log=readFileSync(join(dir,'session.log'),'utf8');assert.equal(log.includes('ssh/exec'),false);assert.equal(log.includes('mcp/starting'),false);
  await request('connection/control',{...owner(),revision:2,id:definition.id,action:'remove'});
  assert.deepEqual((await request('connection/list',owner())).definitions,[]);
}));

test('连接配置拒绝跨会话、未知字段、明文密码与不安全 TLS，失败不写配置', {timeout:45000},async()=>fixture(async({boot,request})=>{
  const sessionId=await boot(),owner={sessionId,scope:'user'};
  await assert.rejects(request('connection/save',{...owner,sessionId:'no-such-session',revision:0,definition}),/connection-session-mismatch/);
  for(const spec of [{...definition.spec,password:'invalid-test-secret'},{...definition.spec,tlsMode:'disable'}]){
    await assert.rejects(request('connection/save',{...owner,revision:0,definition:{...definition,spec}}),/connection-/);
  }
  await assert.rejects(request('connection/list',{...owner,extra:true}),/connection-bad-arguments/);
  const after=await request('connection/list',owner);assert.equal(after.revision,0);assert.deepEqual(after.definitions,[]);
  await assert.rejects(request('connection/list',{sessionId,scope:'project'}),/connection-project-required/);
}));

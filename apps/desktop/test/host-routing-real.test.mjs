// 真模型验证自定义会话模型路由与待核算账本；凭据只留在后端。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { HostBridge }=createRequire(import.meta.url)('../host-bridge.cjs');
const here=dirname(fileURLToPath(import.meta.url));
test('真实 StepFun：自定义模型请求完成且进入待核算账本',{timeout:180000},async t=>{
 const keyFile=process.env.SACODE_REAL_KEY_FILE || join(here,'../../../target/step.key');
 const key=process.env.STEPFUN_API_KEY || (existsSync(keyFile)?readFileSync(keyFile,'utf8').trim():'');
 if(!key){t.skip('缺少真实模型凭据');return;}
 const dir=mkdtempSync(join(process.env.SACODE_TEST_TMP || tmpdir(),'sacode-route-real-'));
 const settings=join(dir,'settings').replaceAll('\\','/');mkdirSync(settings);
 const b=new HostBridge(process.env.SACODE_HOST || join(here,'../dist/host/bin/sacode-host.exe'),{...process.env,SACODE_USER_SETTINGS_DIR:settings});await b.start(dir);
 try {
  await b.request('model/registry/update',{draft:{id:'stepfun',name:'StepFun',baseUrl:'https://api.stepfun.com/step_plan/v1',protocol:'openai-completions',models:[{id:'step-5-preview',name:'真实模型',contextWindow:'',maxTokens:'',image:false,availability:'available',outputModalities:['text']}]},expectedRevision:0});
  const v=await b.request('model/registry/describe');await b.request('credential/set',{ref:v.providers[0].credentialRef,value:key});
  await b.request('custom/upsert',{draft:{id:'real',name:'真实会话模型',description:'',enabled:true,category:'coding',requires:['text-output'],mode:'weighted',bindings:[]},expectedRevision:0});
  await b.request('binding/upsert',{customId:'real',binding:{providerId:'stepfun',modelId:'step-5-preview',enabled:true,order:0,weight:1,priceInMicro:-1,priceOutMicro:-1,priceCacheReadMicro:-1,priceCacheWriteMicro:-1,priceVersion:1,currency:'CNY'},expectedRevision:1});
  await b.request('session/submit',{eventType:'user/message',data:'请不要使用任何工具，只回复四个字：收到就好。'});
  await b.request('task/start',{customModelId:'real'});
  let result;
  for(let i=0;i<850;i++){result=await b.request('turn/poll');if(result.settled)break;await new Promise(r=>setTimeout(r,200));}
  assert.equal(result?.settled,true);assert.equal(result.interrupted,false);assert.ok(result.text.length>0);
  const stats=await b.request('ledger/stats');assert.ok(stats.unsettledAttempts.length>=1);assert.equal(stats.pendingReservations.length,0);
  const ledger=readFileSync(join(settings,'usage-ledger.log'),'utf8');assert.ok(ledger.includes('step-5-preview'));assert.ok(ledger.includes('usage-unspecified'));assert.ok(!ledger.includes(key));
 } finally {await b.stop();}
});

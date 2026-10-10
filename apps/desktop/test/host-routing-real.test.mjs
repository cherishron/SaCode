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
const HOST=process.env.SACODE_HOST || join(here,'../dist/host/bin/sacode-host.exe');
// 随包信任锚与宿主 exe 同目录，生产由壳层经 SACODE_CA_BUNDLE 传入；测试直接 spawn 宿主时按同一位置补上。
if(!process.env.SACODE_CA_BUNDLE){const side=join(dirname(HOST),'ca-bundle.pem');if(existsSync(side))process.env.SACODE_CA_BUNDLE=side;}
// 夹具模型名只写一次：账本断言与登记表用的是同一个字面量，避免改端点时漏掉一处变成假绿
const MODEL='step-3.7-flash';
test('真实 StepFun：自定义模型请求完成且进入待核算账本',{timeout:180000},async t=>{
 const keyFile=process.env.SACODE_REAL_KEY_FILE || join(here,'../../../target/step.key');
 const key=process.env.STEPFUN_API_KEY || (existsSync(keyFile)?readFileSync(keyFile,'utf8').trim():'');
 if(!key){t.skip('缺少真实模型凭据');return;}
 const dir=mkdtempSync(join(process.env.SACODE_TEST_TMP || tmpdir(),'sacode-route-real-'));
 const settings=join(dir,'settings').replaceAll('\\','/');mkdirSync(settings);
 const b=new HostBridge(process.env.SACODE_HOST || join(here,'../dist/host/bin/sacode-host.exe'),{...process.env,SACODE_USER_SETTINGS_DIR:settings});await b.start(dir);
 try {
  // 2026-10-11 实测：/step_plan/v1 + step-5-preview 对本账号回 403 real_name_required（账号侧限制），
  // 同一条键打 /v1 + step-3.7-flash 能出真答复，故夹具换成后者。
  await b.request('model/registry/update',{draft:{id:'stepfun',name:'StepFun',baseUrl:'https://api.stepfun.com/v1',protocol:'openai-completions',models:[{id:MODEL,name:'真实模型',contextWindow:'',maxTokens:'',image:false,availability:'available',outputModalities:['text']}]},expectedRevision:0});
  const v=await b.request('model/registry/describe');await b.request('credential/set',{ref:v.providers[0].credentialRef,value:key});
  await b.request('custom/upsert',{draft:{id:'real',name:'真实会话模型',description:'',enabled:true,category:'coding',requires:['text-output'],mode:'weighted',bindings:[]},expectedRevision:0});
  await b.request('binding/upsert',{customId:'real',binding:{providerId:'stepfun',modelId:MODEL,enabled:true,order:0,weight:1,priceInMicro:-1,priceOutMicro:-1,priceCacheReadMicro:-1,priceCacheWriteMicro:-1,priceVersion:1,currency:'CNY'},expectedRevision:1});
  await b.request('session/submit',{eventType:'user/message',data:'请不要使用任何工具，只回复四个字：收到就好。'});
  await b.request('task/start',{customModelId:'real'});
  let result;
  for(let i=0;i<850;i++){result=await b.request('turn/poll');if(result.settled)break;await new Promise(r=>setTimeout(r,200));}
  assert.equal(result?.settled,true);assert.equal(result.interrupted,false);assert.ok(result.text.length>0);
  const stats=await b.request('ledger/stats');assert.ok(stats.unsettledAttempts.length>=1);assert.equal(stats.pendingReservations.length,0);
  const ledger=readFileSync(join(settings,'usage-ledger.log'),'utf8');
  // 账本行是「序号 \t 事件 \t JSON」。钉三件事：这条模型确实进了未核销；未核销原因必须与
  // 用量读数自洽（用量已知→只能是费率未登记，用量未知→才是 usage-unspecified）；凭据材料不落账本。
  const row=ledger.split(/\r?\n/).map(l=>l.split('\t')).filter(c=>c[1]==='ledger/unsettled'&&c[2]&&c[2].includes(MODEL)).pop();
  assert.ok(row,`账本里没有该模型的未核销记录（实测 ${JSON.stringify(ledger).slice(0,160)}）`);
  const rec=JSON.parse(row[2]);
  assert.equal(rec.result,'unsettled');
  assert.equal(rec.reason,rec.input>0?'rate-unregistered:input':'usage-unspecified',`未核销原因与用量不自洽：input=${rec.input} reason=${rec.reason}`);
  assert.ok(!ledger.includes(key));
 } finally {await b.stop();}
});

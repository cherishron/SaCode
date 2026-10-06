// 真实 Host + 本地 HTTP：配置选择、续跑重路由、派发屏障、失败归因与恢复。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { HostBridge } = createRequire(import.meta.url)('../host-bridge.cjs');
const host = process.env.SACODE_HOST || join(dirname(fileURLToPath(import.meta.url)), '../dist/host/bin/sacode-host.exe');
const pause = ms => new Promise(r => setTimeout(r, ms));
async function poll(b) {
  for (let i=0;i<300;i++) { const r=await b.request('turn/poll'); if(r.settled) return r; await pause(20); }
  throw Error('回合没有结算');
}
async function setup(b, url, extra={}) {
  const bridge=b;
  b={request:async(method,params)=> {try {return await bridge.request(method,params);} catch(e) {throw Error(method+': '+e.message);} }};
  await b.request('model/registry/update', {draft:{id:'p',name:'测试供应商',baseUrl:url,protocol:'openai-completions',models:[{id:'upstream',name:'实际模型',contextWindow:'',maxTokens:'',image:false,availability:'available',outputModalities:['text']},{id:'legacy',name:'旧默认模型',contextWindow:'',maxTokens:'',image:false,availability:'available',outputModalities:['text']}]},expectedRevision:0});
  await b.request('model/registry/set-default',{providerId:'p',model:'legacy',expectedRevision:1});
  const v=await b.request('model/registry/describe');
  await b.request('credential/set',{ref:v.providers[0].credentialRef,value:'local-fixture-secret'});
  await b.request('custom/upsert',{draft:{id:'chosen',name:'会话模型',description:'',enabled:true,category:'coding',requires:['text-output'],mode:'weighted',bindings:[],...extra},expectedRevision:0});
  await b.request('binding/upsert',{customId:'chosen',binding:{providerId:'p',modelId:'upstream',enabled:true,order:0,weight:1,priceInMicro:1000,priceOutMicro:2000,priceCacheReadMicro:-1,priceCacheWriteMicro:-1,priceVersion:1,currency:'CNY'},expectedRevision:1});
}
async function fixture(status=200, tools=false, hold=false, beforeEnd=()=>{}) {
  const requests=[];const responses=[];
  const server=createServer(async(req,res)=> {
    let raw='';for await(const c of req) raw+=c;
    requests.push(JSON.parse(raw));
    if(status!==200) {res.writeHead(status,{'retry-after':'3'});res.end('拒绝');return;}
    res.writeHead(200,{'content-type':'text/event-stream'});
    if(hold) {responses.push(res);res.flushHeaders();res.write('data: '+JSON.stringify({choices:[{index:0,delta:{content:'处理中'}}]})+'\n\n');return;}
    const part = tools && requests.length===1 ? {delta:{tool_calls:[{index:0,id:'todo-1',type:'function',function:{name:'todo_write',arguments:'{"todos":[]}'}}]},finish_reason:'tool_calls'} : {delta:{content:'真实回环答复'},finish_reason:'stop'};
    beforeEnd();res.end('data: '+JSON.stringify({choices:[{index:0,...part}]})+'\n\ndata: [DONE]\n\n');
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  return {requests,responses,url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(r=>{server.closeAllConnections();server.close(r);})};
}
async function boot() {
  const dir=mkdtempSync(join(process.env.SACODE_TEST_TMP || tmpdir(),'sacode-routing-'));
  const settings=join(dir,'settings').replaceAll('\\','/');mkdirSync(settings);
  const b=new HostBridge(host,{...process.env,SACODE_USER_SETTINGS_DIR:settings});await b.start(dir);
  return {b,dir,settings};
}
test('会话自定义模型进入真实请求，逐步派发且费用未知不伪造零，重启不重发', {timeout:30000},async()=>{
  const f=await fixture(200,true);const {b,dir,settings}=await boot();
  try {
    assert.ok((await b.request('initialize')).capabilities.includes('ledger/stats'));
    await setup(b,f.url);
    await b.request('binding/upsert',{customId:'chosen',binding:{providerId:'p',modelId:'legacy',enabled:true,order:1,weight:1,priceInMicro:1000,priceOutMicro:2000,priceCacheReadMicro:-1,priceCacheWriteMicro:-1,priceVersion:2,currency:'CNY'},expectedRevision:2});
    await b.request('session/submit',{eventType:'user/message',data:'测试工具续跑'});
    await b.request('task/start',{customModelId:'chosen'});
    const result=await poll(b);
    assert.equal(result.interrupted,false);
    assert.equal(f.requests.length,2,'工具调用之后必须再请求');
    assert.deepEqual(f.requests.map(r=>r.model),['upstream','legacy'],'每个步骤必须重新路由，不能沿用第一步模型');
    const raw=readFileSync(join(settings,'usage-ledger.log'),'utf8');
    assert.equal(raw.split('attempt/dispatched').length-1,2);
    assert.ok(raw.includes('-'+b.proc.pid+'-'),'请求身份必须区分并发 Host 进程');
    assert.ok(raw.includes('usage-unspecified'),'合计token不足以四档结算');
    const stats=await b.request('ledger/stats');
    assert.equal(stats.pendingReservations.length,0);
    assert.equal(stats.unsettledAttempts.length,2);
    assert.equal(stats.modelTotals.length,0);
    assert.ok(!raw.includes('local-fixture-secret'));
    await b.stop();await b.start(dir);
    await b.request('ledger/stats');await pause(50);
    assert.equal(f.requests.length,2,'重启不得自动重发已派发尝试');
  } finally {await b.stop();await f.close();}
});
test('无效会话模型明确拒绝，不退回默认供应商', {timeout:15000},async()=>{
  const f=await fixture();const {b}=await boot();
  try {await setup(b,f.url);await assert.rejects(b.request('task/start',{customModelId:'missing'}),/custom-model-not-found/);assert.equal(f.requests.length,0);}
  finally {await b.stop();await f.close();}
});
for(const [status,scope] of [[500,'upstream'],[401,'route-set'],[429,'route-set']]) {
 test(`HTTP ${status} 归因到 ${scope}，释放预留`,{timeout:15000},async()=>{
  const f=await fixture(status);const {b,settings}=await boot();
  try {await setup(b,f.url);await b.request('task/start',{customModelId:'chosen'});const r=await poll(b);assert.equal(r.interrupted,true);
    const raw=readFileSync(join(settings,'route-health.log'),'utf8');assert.ok(raw.includes('\"kind\":\"'+scope+'\"'));
    assert.equal((await b.request('ledger/stats')).pendingReservations.length,0);
  } finally {await b.stop();await f.close();}
 });
}
test('账本派发路径不可写时一个请求也不发',{timeout:15000},async()=>{
 const f=await fixture();const {b,settings}=await boot();
 try {await setup(b,f.url);mkdirSync(join(settings,'usage-ledger.log'));await assert.rejects(b.request('task/start',{customModelId:'chosen'}),/ledger-replay-rejected/);assert.equal(f.requests.length,0);}
 finally {await b.stop();await f.close();}
});

test('派发标记被活租约拒绝时不向上游发字节',{timeout:15000},async()=>{
 const f=await fixture();const {b,settings}=await boot();
 try {await setup(b,f.url);writeFileSync(join(settings,'usage-ledger.log.lease'),'writer='+process.pid+'-blocked');
   await b.request('task/start',{customModelId:'chosen'});const r=await poll(b);
   assert.equal(r.interrupted,true);assert.match(r.finishReason,/attempt-mark-failed/);
   assert.equal(f.requests.length,0);
 } finally {await b.stop();await f.close();}
});

test('请求派发后进程被杀，冷启动报告遗留尝试且不自动重发',{timeout:20000},async()=>{
 const f=await fixture(200,false,true);const {b,dir,settings}=await boot();let cold;
 try {await setup(b,f.url);await b.request('task/start',{customModelId:'chosen'});
   for(let i=0;i<100&&f.requests.length===0;i++) await pause(20);
   assert.equal(f.requests.length,1);
   const exit=once(b.proc,'exit');b.proc.kill();await exit;
   cold=new HostBridge(host,{...process.env,SACODE_USER_SETTINGS_DIR:settings});await cold.start(dir);
   const stats=await cold.request('ledger/stats');assert.equal(stats.unsettledAttempts.length,1);
   await pause(50);assert.equal(f.requests.length,1);
 } finally {if(cold) await cold.stop();if(b.proc?.exitCode===null) await b.stop();await f.close();}
});
test('取消只终止当前尝试，不记成模型故障，也不留预算预留',{timeout:20000},async()=>{
 const f=await fixture(200,false,true);const {b,settings}=await boot();
 try {await setup(b,f.url,{dailyAmountMicro:1000000});await b.request('task/start',{customModelId:'chosen'});
   for(let i=0;i<100&&f.requests.length===0;i++) await pause(20);
   assert.equal(f.requests.length,1);await b.request('turn/cancel');
   for(const res of f.responses) res.end('data: [DONE]\n\n');
   const r=await poll(b);assert.equal(r.cancelled,true);
   assert.equal((await b.request('ledger/stats')).pendingReservations.length,0);
   const health=readFileSync(join(settings,'route-health.log'),'utf8');assert.ok(health.includes('cancelled'));
   assert.ok(!health.includes('"category":"effective"'));
 } finally {await b.stop();await f.close();}
});

test('三次上游5xx后同模型进入冷却，第四次不发请求',{timeout:20000},async()=>{
 const f=await fixture(500);const {b,settings}=await boot();
 try {await setup(b,f.url);for(let i=0;i<3;i++){await b.request('task/start',{customModelId:'chosen'});assert.equal((await poll(b)).interrupted,true);}
   await assert.rejects(b.request('task/start',{customModelId:'chosen'}),/route-cooling/);
   assert.equal(f.requests.length,3);
 } finally {await b.stop();await f.close();}
});

test('上游已完成但结算被占用时保留待核算尝试，不冒充传输失败作废',{timeout:20000},async()=>{
 const {b,settings}=await boot();const f=await fixture(200,false,false,()=>writeFileSync(join(settings,'usage-ledger.log.lease'),'writer='+process.pid+'-settlement'));
 try {await setup(b,f.url,{dailyAmountMicro:1000000});await b.request('task/start',{customModelId:'chosen'});
   const r=await poll(b);assert.equal(r.interrupted,true);assert.match(r.finishReason,/ledger-settlement-rejected/);
   const stats=await b.request('ledger/stats');assert.equal(stats.unsettledAttempts.length,1);assert.equal(stats.pendingReservations.length,1);
   const raw=readFileSync(join(settings,'usage-ledger.log'),'utf8');assert.ok(!raw.includes('attempt/failed'));assert.ok(!raw.includes('ledger/void'));
 } finally {await b.stop();await f.close();}
});

test('真实连接被拒归因到线路，不算模型5xx',{timeout:15000},async()=>{
 const f=await fixture();const {b,settings}=await boot();
 try {await setup(b,f.url);await f.close();await b.request('task/start',{customModelId:'chosen'});
   assert.equal((await poll(b)).interrupted,true);
   const health=readFileSync(join(settings,'route-health.log'),'utf8');assert.ok(health.includes('"kind":"channel"'));assert.ok(health.includes('"failures":0'));
 } finally {await b.stop();await f.close();}
});
test('不完整SSE协议归因 unknown，不把协议错误累计成模型故障',{timeout:15000},async()=>{
 const f=await fixture(200,false,true);const {b,settings}=await boot();
 try {await setup(b,f.url);await b.request('task/start',{customModelId:'chosen'});
   for(let i=0;i<100&&f.responses.length===0;i++) await pause(20);
   assert.equal(f.responses.length,1);f.responses[0].end('data: [DONE]\n\n');
   assert.equal((await poll(b)).interrupted,true);
   const health=readFileSync(join(settings,'route-health.log'),'utf8');assert.ok(health.includes('"kind":"upstream"'));assert.ok(health.includes('"category":"unknown"'));assert.ok(health.includes('"failures":0'));
 } finally {await b.stop();await f.close();}
});

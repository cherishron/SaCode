import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const {createPageToolBridge}=createRequire(import.meta.url)('../page-tool-bridge.cjs');

function fixture({approvalId=0,allow=true,claim=true,replaceWindow=false}={}) {
  const calls=[],scripts=[],queue=[];let resolve;
  const window={webContents:{executeJavaScript:async code=>{scripts.push(code);return vm.runInNewContext(code,{document:{querySelector:()=>({getAttribute:()=> 's1'})},window:{DshPageTools:{tools:[{name:'page.readState',handler:async()=>({text:'actual-handler'})},{name:'page.clickElement',handler:async()=>({ok:true})}]}}});}}};
  let target=window;
  const bridge={proc:{},request:async(method,args)=>{
    calls.push({method,args});
    if(method==='page/tool/attach')return{sessionId:'s1'};
    if(method==='page/tool/prepare')return{sessionId:'s1',approvalId};
    if(method==='approval/answer')return{accepted:true};
    if(method==='page/tool/call')return new Promise(done=>{resolve=done;queue.push({sessionId:'s1',requestId:'owned-request',name:args.name,arguments:args.arguments});});
    if(method==='page/tool/poll')return{sessionId:'s1',requests:[...queue]};
    if(method==='page/tool/claim'){if(replaceWindow)target={};return{allowed:claim};}
    if(method==='page/tool/result'){queue.length=0;resolve?.(JSON.parse(args.result));return{accepted:true};}
    throw Error('unexpected-method');
  }};
  const driver=createPageToolBridge({bridge,getWindow:()=>target,askPermission:async()=>allow,intervalMs:100000});
  return{driver,bridge,calls,scripts,queue,window};
}

test('页面调用先过核心提案与执行领取才进入真实handler',async t=>{
  const f=fixture();t.after(()=>f.driver.dispose());
  const pending=f.driver.invoke('page.readState',{selector:'#safe'});
  await new Promise(r=>setImmediate(r));
  assert.equal(f.scripts.length,0);
  await f.driver.pump();
  assert.deepEqual(await pending,{text:'actual-handler'});
  assert.equal(f.scripts.length,1);
  const names=f.calls.map(c=>c.method);
  assert.ok(names.indexOf('page/tool/prepare')<names.indexOf('page/tool/call'));
  assert.ok(names.indexOf('page/tool/claim')<names.indexOf('page/tool/result'));
  assert.equal(f.calls.find(c=>c.method==='page/tool/claim').args.requestId,'owned-request');
});

test('页面动作被用户拒绝时核心记录拒绝且不投递执行',async t=>{
  const f=fixture({approvalId:7,allow:false});t.after(()=>f.driver.dispose());
  assert.deepEqual(await f.driver.invoke('page.clickElement',{selector:'#danger'}),{error:'page-approval-denied'});
  assert.equal(f.calls.some(c=>c.method==='page/tool/call'),false);
  assert.deepEqual(f.calls.find(c=>c.method==='approval/answer').args,{approvalId:7,decision:'denied'});
  assert.equal(f.scripts.length,0);
});

test('核心未发放执行许可及窗口已变化时都不执行handler',async t=>{
  for(const options of [{claim:false},{replaceWindow:true}]){
    const f=fixture(options);t.after(()=>f.driver.dispose());
    f.queue.push({sessionId:'s1',requestId:'queued',name:'page.readState',arguments:'{}'});
    await f.driver.pump();assert.equal(f.scripts.length,0);
    assert.equal(f.calls.some(c=>c.method==='page/tool/result'),false);
  }
});

test('页面传输拒绝外会话、未知工具和伪造参数形状',async t=>{
  const f=fixture();t.after(()=>f.driver.dispose());
  f.queue.push({sessionId:'other',requestId:'x',name:'page.readState',arguments:'{}'},
    {sessionId:'s1',requestId:'x',name:'page.executeArbitraryCode',arguments:'{}'},
    {sessionId:'s1',requestId:'x',name:'page.readState',arguments:'[]'});
  await f.driver.pump();assert.equal(f.scripts.length,0);
  assert.equal(f.calls.some(c=>c.method==='page/tool/claim'),false);
});

test('宿主拒绝调用时页面不能退回直接执行handler',async t=>{
  const f=fixture();t.after(()=>f.driver.dispose());
  f.bridge.request=async()=>{throw Error('host-unavailable');};
  await assert.rejects(f.driver.invoke('page.readState',{}),/host-unavailable/);
  assert.equal(f.scripts.length,0);
});

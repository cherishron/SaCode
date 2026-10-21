// 真实Host进程 + 合成会话事件，不访问供应商或用户配置。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const {HostBridge}=createRequire(import.meta.url)('../../../desktop/host-bridge.cjs');
const root=fileURLToPath(new URL('../../../../target/tmp/host-compact-fix/runs/',import.meta.url));
test('Host compact安全探针：空闲、turn、pending工具、审批、计划和提问',{timeout:60000},async()=>{
  assert.ok(process.env.SACODE_HOST,'必须显式提供本轮构建的SACODE_HOST');
  mkdirSync(root,{recursive:true});const directory=mkdtempSync(join(root,'probe-'));
  const bridge=new HostBridge(process.env.SACODE_HOST,{...process.env,SACODE_USER_SETTINGS_DIR:join(directory,'settings')});
  const append=(eventType,data='')=>bridge.request('session/submit',{eventType,data});
  let sequence=0;const compact=()=>bridge.request('compact/run',{sessionId:'current',requestId:'safety-'+(++sequence)});
  try{
    await bridge.start(directory);await bridge.request('initialize');
    await append('user/message','初始化合成会话并取得写租约');
    assert.notEqual((await compact()).status,'queued','空会话不应永久queued');
    await append('turn/start');assert.equal((await compact()).status,'queued');
    await append('turn/end','stop');assert.notEqual((await compact()).status,'queued');
    const call={id:'pending-1',type:'function',function:{name:'read',arguments:'{"path":"a.txt"}'}};
    // session/submit 的旧字符串解码不还原模型信封的控制字符；不以该入口伪造模型信封。
    // 未结算 tool/call 放在最后验证，避免影响后面的空闲压缩验收。
    for(const [ask,settle,data,answer] of [
      ['approval/asked','approval/decided','999:write','999:denied'],
      ['plan/submitted','plan/review','plan-probe::{}','plan-probe::{"decision":"dismiss"}'],
      ['user-questions/request','user-questions/answer','question-probe::{}','question-probe::{}'],
    ]){
      await append(ask,data);assert.equal((await compact()).status,'queued',ask);
      await append(settle,answer);assert.notEqual((await compact()).status,'queued',settle);
    }
    for(let i=0;i<5;i++){
      await append('user/message','合成压缩任务'+i);await append('turn/start');
      await append('assistant/message',('可压缩的合成历史正文，保留事实与结算边界。').repeat(300));await append('turn/end','stop');
    }
    const result=await compact();assert.equal(result.status,'ready');assert.equal(result.reason,'compact-published');assert.equal(result.artifactAvailable,true);
    assert.ok(result.afterInputBound<result.beforeInputBound);
    await append('tool/call',JSON.stringify(call));assert.equal((await compact()).status,'queued','未结算工具必须等待');
  }finally{const result=await bridge.stop();assert.equal(result.code,0);assert.equal(result.forced,false);}
});

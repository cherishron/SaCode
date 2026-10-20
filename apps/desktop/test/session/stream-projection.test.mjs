import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context={window:{}};
vm.runInNewContext(readFileSync(new URL('../../renderer/msgfold.js',import.meta.url),'utf8'),context);
const {withStreamingMessage}=context.window.SaCodeMsgFold;
test('流式正文进入同一气泡链，不改写持久消息或 Markdown',()=>{
  const messages=[{id:'old',role:'user',content:'修改文件'}];
  const text='# 计划\n\n```js\nconst a = 1;\n```';
  const rows=withStreamingMessage(messages,{running:true,text},'s1');
  assert.equal(rows.length,2);assert.equal(messages.length,1);
  assert.equal(rows[1].content,text);assert.equal(rows[1].role,'assistant');
  assert.equal(rows[1].sessionId,'s1');assert.equal(rows[1].live,true);
  assert.notEqual(rows[1].id,withStreamingMessage([],{running:true,text},'s2')[0].id);
});
test('成功收束撤掉临时消息，取消和失败保留真实半截正文',()=>{
  const saved=[{id:'durable',role:'assistant',content:'答复'}];
  assert.equal(withStreamingMessage(saved,{settled:true,text:'答复'},'s1'),saved);
  assert.equal(withStreamingMessage([],{settled:true,projectionPending:true,text:'待回放正文'},'s1')[0].content,'待回放正文');
  for(const reason of ['cancelled','interrupted']){
    const rows=withStreamingMessage([],{settled:true,[reason]:true,text:'半截'},'s1');
    assert.equal(rows[0].content,'半截');assert.equal(rows[0].running,false);
  }
  assert.equal(withStreamingMessage(saved,{running:false,text:''},'s1'),saved);
});

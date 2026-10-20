import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const compiled=await build({entryPoints:[fileURLToPath(new URL('../../renderer/pages/tool-card.ts',import.meta.url))],bundle:true,write:false,format:'cjs',external:['vue']});
const vue={defineComponent:x=>x,h:(type,props,children)=>({type,props,children}),ref:value=>({value})};
const context={module:{exports:{}},require:()=>vue};vm.runInNewContext(compiled.outputFiles[0].text,context);
const {ToolCard}=context.module.exports;
const flatten=node=>Array.isArray(node)?node.flatMap(flatten):node&&typeof node==='object'?[node,...flatten(node.children)]:[];
test('工具卡使用关联名称参数与核心状态，正文前缀不能伪造成功',()=>{
  for(const status of ['running','completed','denied','cancelled','failed','unknown']){
    const props={message:{id:'event-2',content:'ok:这段文字不能覆盖拒绝状态',toolCall:{id:'tool-event-1',callId:'one',name:'edit',arguments:'{"path":"src/a.js"}',status}}};
    const render=ToolCard.setup(props);const initial=render();assert.equal(initial.props['data-tool-status'],status);
    assert.match(JSON.stringify(initial),/edit/);assert.match(JSON.stringify(initial),/src\/a.js/);
    const button=flatten(initial).find(n=>n.type==='button');assert.equal(button.props['aria-expanded'],false);
    button.props.onClick();assert.equal(flatten(render()).find(n=>n.type==='button').props['aria-expanded'],true);
    assert.match(JSON.stringify(render()),/ok:这段文字不能覆盖拒绝状态/);
    flatten(render()).find(n=>n.type==='button').props.onClick();assert.equal(flatten(render()).some(n=>n.type==='pre'),false);
  }
});
test('历史无关联结果明确未知，原始内容安全地作为文本节点展示',()=>{
  const render=ToolCard.setup({message:{id:'event-9',content:'<script>done</script>'}});
  assert.equal(render().props['data-tool-status'],'unknown');assert.match(JSON.stringify(render()),/缺少调用关联/);
  flatten(render()).find(n=>n.type==='button').props.onClick();
  assert.ok(flatten(render()).some(n=>n.type==='pre'&&n.children==='<script>done</script>'));
  assert.ok(flatten(render()).every(n=>!n.props?.innerHTML));
});
test('调用与结果按事件身份关联；未完成调用保持日志位置、会话和附件',()=>{
  const ctx={window:{}};vm.runInNewContext(readFileSync(new URL('../../renderer/msgfold.js',import.meta.url),'utf8'),ctx);
  const attachment={kind:'image',attachmentId:'sha256:fixture'};
  const calls=[{id:'tool-event-2',eventSeq:2,callId:'x',name:'read',arguments:'{}',status:'completed',resultMessageId:'event-3'},
    {id:'tool-event-5',eventSeq:5,callId:'y',name:'edit',arguments:'{}',status:'running',resultMessageId:''}];
  const rows=[{id:'event-1',attachments:[]},{id:'event-3',attachments:[attachment]},{id:'event-6',attachments:[]}];
  const items=ctx.window.SaCodeMsgFold.toBubbleMessages(['assistant/message: 读取','tool/result: 相同正文','user/message: 下一条'],rows,'s1',calls);
  assert.equal(items[1].toolCall.callId,'x');assert.equal(items[1].attachments[0],attachment);
  assert.equal(items[2].toolCall.callId,'y');assert.equal(items[2].sessionId,'s1');assert.equal(items[3].id,'event-6');
  const isolated=ctx.window.SaCodeMsgFold.toBubbleMessages(['tool/result: 相同正文'],[{id:'event-3'}],'s2',[]);
  assert.equal(isolated[0].toolCall,undefined);
});

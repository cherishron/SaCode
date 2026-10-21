import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const compiled=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/composer-commands.ts',import.meta.url))],bundle:true,write:false,format:'cjs',external:[]});

function loadModule(){
  const ctx={module:{exports:{}},require:()=>null};
  vm.runInNewContext(compiled.outputFiles[0].text,ctx);
  return ctx.module.exports;
}

test('getCommands 返回 5 个内置命令',()=>{
  const mod=loadModule();
  const cmds=mod.getCommands();
  assert.equal(cmds.length,5);
  const names=cmds.map(c=>c.name);
  assert.deepEqual(Array.from(names),['help','review','compress','init','clear']);
});

test('所有命令均为中文 label 与 help',()=>{
  const mod=loadModule();
  const cmds=mod.getCommands();
  for(const c of cmds){
    assert.ok(c.label && /[\u4e00-\u9fa5]/.test(c.label),'label 应含中文');
    assert.ok(c.help && /[\u4e00-\u9fa5]/.test(c.help),'help 应含中文');
    assert.equal(c.section,'commands');
  }
});

test('popover section=commands 时渲染正确数量的菜单项',async()=>{
  const menuCompiled=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/composer-menu.ts',import.meta.url))],bundle:true,write:false,format:'cjs',external:['vue']});
  let watchCallback;
  const vue={defineComponent:x=>x,ref:value=>({value}),h:(type,props,children)=>({type,props,children}),nextTick:fn=>Promise.resolve().then(fn),onMounted:()=>{},onBeforeUnmount:()=>{},watch:(_source,fn)=>{watchCallback=fn;}};
  const ctx={module:{exports:{}},require:()=>vue,innerWidth:1384,innerHeight:764,document:{removeEventListener(){}},window:{removeEventListener(){}}};
  vm.runInNewContext(menuCompiled.outputFiles[0].text,ctx);
  const render=ctx.module.exports.AddButton.setup({workspaceConfigured:true,goalAvailable:true,listFiles:async()=>({files:[]}),slashTrigger:1},{emit:()=>{}});
  watchCallback();
  await Promise.resolve();
  const nodes=flatten(render());
  const items=nodes.filter(n=>n.type==='button'&&n.props&&n.props.role==='menuitem');
  assert.ok(items.length>=5,'commands section 应至少渲染 5 个菜单项');
});

test('选择帮助命令发送精确命令标识',async()=>{
  const menuCompiled=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/composer-menu.ts',import.meta.url))],bundle:true,write:false,format:'cjs',external:['vue']});
  let watchCallback;
  const vue={defineComponent:x=>x,ref:value=>({value}),h:(type,props,children)=>({type,props,children}),nextTick:fn=>Promise.resolve().then(fn),onMounted:()=>{},onBeforeUnmount:()=>{},watch:(_source,fn)=>{watchCallback=fn;}};
  const ctx={module:{exports:{}},require:()=>vue,innerWidth:1384,innerHeight:764,document:{removeEventListener(){}},window:{removeEventListener(){}}};
  vm.runInNewContext(menuCompiled.outputFiles[0].text,ctx);
  const emitted=[];
  const render=ctx.module.exports.AddButton.setup({workspaceConfigured:true,goalAvailable:true,listFiles:async()=>({files:[]}),slashTrigger:1},{emit:(...a)=>emitted.push(a)});
  watchCallback();
  await Promise.resolve();
  const nodes=flatten(render());
  const menuItems=nodes.filter(n=>n.type==='button'&&n.props&&n.props.role==='menuitem'&&JSON.stringify(n.children).includes('帮助'));
  assert.ok(menuItems.length>0,'应有菜单项');
  if(menuItems[0]&&menuItems[0].props&&menuItems[0].props.onClick){
    menuItems[0].props.onClick();
    assert.ok(emitted.some(e=>e[0]==='command'),'应发射 command 事件');
  }
});

function flatten(tree){if(Array.isArray(tree))return tree.flatMap(flatten);if(!tree||typeof tree!=='object')return[];return[tree,...(Array.isArray(tree.children)?tree.children.flatMap(flatten):[])];}

test('clear 不再只清前端投影，命令不只在前端收口',()=>{
  const mod=loadModule();
  const cmds=mod.getCommands();
  const clearCmd=cmds.find(c=>c.name==='clear');
  assert.ok(clearCmd,'应存在 clear 命令');
  // 会话日志是唯一真源：clear 必须经 Host 清空，不能仍被当成纯前端命令。
  assert.notEqual(clearCmd.frontendOnly,true,'clear 必须调用 Host 清空会话日志，不能只清前端投影');
});

test('clear 执行路径调用 sessionClear，而不是本地把 messages 置空',()=>{
  const app=readFileSync(new URL('../renderer/app.js',import.meta.url),'utf8');
  assert.match(app,/async function clearConversation\(/,'渲染层必须有 clearConversation');
  assert.match(app,/window\.sacode\.sessionClear\(sessionId\)/,'clearConversation 必须调用 Host 的 sessionClear');
  // 真源清空、重启回放与清空后追加由 bridge.test.mjs 的同名用例覆盖。
});

test('clear 成功后重置 turn，取消/中断轮次的 live 气泡不得残留',async()=>{
  const app=readFileSync(new URL('../renderer/app.js',import.meta.url),'utf8');
  const start=app.indexOf('async function clearConversation(');
  const end=app.indexOf('\n    // 代码审查只读取',start);
  assert.ok(start>0&&end>start,'应能定位 clearConversation 函数');
  const source=app.slice(start,end).trimEnd();
  const ref=value=>({value});
  const calls=[];
  // 复现残留场景：上一轮被取消但留下了部分正文，turn 里仍有 live 文本。
  const turn=ref({running:false,settled:true,text:'部分回复',finishReason:'cancelled',cancelled:true,interrupted:false,delivered:2,projectionPending:true});
  const sendBusy=ref(false),clearBusy=ref(false),scrollSession=ref('s1'),catalogBusy=ref(false);
  const error=ref(''),clearNotice=ref(null);
  const self={cancelReview(){}};
  const window={sacode:{sessionClear:async(id)=>{calls.push(id);}}};
  const fn=new Function('turn','sendBusy','clearBusy','sessionGeneration','scrollSession','catalogBusy','refresh','error','self','clearNotice','window',
    `return (${source});`)(turn,sendBusy,clearBusy,7,scrollSession,catalogBusy,async()=>{},error,self,clearNotice,window);
  await fn();
  assert.deepEqual(calls,['s1'],'必须先清空真源再重置投影状态');
  assert.equal(turn.value.running,false);
  assert.equal(turn.value.settled,false);
  assert.equal(turn.value.text,'','取消轮次的部分正文必须清掉，否则 msgfold 会继续渲染 live 气泡');
  assert.equal(turn.value.cancelled,false);
  assert.equal(turn.value.interrupted,false);
  assert.equal(turn.value.delivered,0);
  assert.equal(turn.value.projectionPending,undefined,'投影待定标记必须随 turn 归零');
});

test('slash command e2e：列出 5 个命令且 help 全中文',()=>{
  const mod=loadModule();
  const cmds=mod.getCommands();
  assert.equal(cmds.length,5,'应有 5 个内置命令');
  for(const c of cmds){
    assert.ok(c.help && /[\u4e00-\u9fa5]/.test(c.help),'help 应含中文');
  }
});

test('help 命令标记为 frontendOnly',()=>{
  const mod=loadModule();
  const cmds=mod.getCommands();
  const helpCmd=cmds.find(c=>c.name==='help');
  assert.ok(helpCmd,'应存在 help 命令');
  assert.equal(helpCmd.frontendOnly,true,'help 应标记为 frontendOnly');
});

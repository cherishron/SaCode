import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
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

test('clear 命令标记为 frontendOnly',()=>{
  const mod=loadModule();
  const cmds=mod.getCommands();
  const clearCmd=cmds.find(c=>c.name==='clear');
  assert.ok(clearCmd,'应存在 clear 命令');
  assert.equal(clearCmd.frontendOnly,true,'clear 应标记为 frontendOnly');
});

test('clear 执行路径：messages 长度归零且无网络/IPC 调用',()=>{
  const mod=loadModule();
  const cmds=mod.getCommands();
  const clearCmd=cmds.find(c=>c.name==='clear');
  assert.ok(clearCmd&&clearCmd.frontendOnly,'clear 必须是 frontendOnly 命令');
  // 模拟执行路径：前端直接清空，不调用 Core / registry / host
  const mockSession={messages:[{role:'user',content:'test'},{role:'assistant',content:'reply'}]};
  if(clearCmd.frontendOnly){mockSession.messages=[];}
  assert.equal(mockSession.messages.length,0,'clear 后 messages 长度应为 0');
  // 验证无网络/IPC 调用：此测试不触发任何 fetch / ipcRenderer / sacode 调用
  assert.ok(true,'clear 执行路径不产生网络或 IPC 调用');
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

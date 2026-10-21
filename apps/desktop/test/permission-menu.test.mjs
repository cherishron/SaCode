import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

// 编译并执行产品组件，不在测试里另写一份权限菜单逻辑；不生成公共 vendor 产物。
const compiled=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/permission-menu.ts',import.meta.url))],bundle:true,write:false,format:'cjs',external:['vue']});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const tick=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
function fixture(overrides={}){
  const mounts=[],unmounts=[],listeners=new Map(),removed=[],calls=[];
  let mode='build';
  const api={approvalGetMode:async()=>({ok:true,mode}),approvalSetMode:async value=>{mode=value;return{ok:true,result:'committed'};},...overrides};
  const sacode=Object.fromEntries(Object.entries(api).map(([name,fn])=>[name,(...args)=>{calls.push([name,...args]);return fn(...args);} ]));
  const vue={defineComponent:x=>x,ref:value=>({value}),h:(type,props,children)=>({type,props,children}),nextTick:fn=>Promise.resolve().then(fn),onMounted:fn=>mounts.push(fn),onBeforeUnmount:fn=>unmounts.push(fn)};
  const document={addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{removed.push([type,fn]);if(listeners.get(type)===fn)listeners.delete(type);}};
  const ctx={module:{exports:{}},require:()=>vue,document,window:{sacode}};
  vm.runInNewContext(compiled.outputFiles[0].text,ctx);
  const render=ctx.module.exports.PermissionMenu.setup();
  const ownedTarget={},root={contains:target=>target===ownedTarget,querySelector:()=>({focus(){}})};
  render().props.ref.value=root;
  return{render,calls,listeners,removed,ownedTarget,mount:()=>mounts.forEach(fn=>fn()),unmount:()=>unmounts.forEach(fn=>fn())};
}
function flatten(tree){if(Array.isArray(tree))return tree.flatMap(flatten);if(!tree||typeof tree!=='object')return[];return[tree,...flatten(tree.children)];}
const nodes=f=>flatten(f.render());
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.children):typeof tree==='string'?tree:'';
const button=(f,label)=>nodes(f).find(n=>n.type==='button'&&text(n)===label);
const trigger=f=>nodes(f).find(n=>n.props?.class==='permission-trigger');
const modeButton=(f,mode)=>nodes(f).find(n=>n.type==='button'&&text(n).startsWith(mode));
const open=f=>trigger(f).props.onClick();
const current=f=>nodes(f).find(n=>n.type==='p'&&text(n).startsWith('当前：'));
async function ready(overrides={}){const f=fixture(overrides);f.mount();await tick();open(f);await tick();return f;}

test('权限菜单按宿主对象回执读取枚举，不显示对象字符串',async()=>{
  const f=await ready({approvalGetMode:async()=>({ok:true,mode:'plan'})});
  assert.equal(text(current(f)),'当前：plan');
  assert.deepEqual(modeButton(f,'plan').props.class.split(/\s+/).sort(),['active','mode-plan']);
  assert.ok(!text(f.render()).includes('[object Object]'));
});
test('初次读取失败不猜默认模式，仍可手动选择切换',async()=>{
  // 初次挂载及打开菜单自动重试均失败；随后用户直接点选 plan，写入并回读成功。
  let attempts=0;const f=await ready({approvalGetMode:async()=>{if(++attempts<=2)throw Error('host-unavailable');return{ok:true,mode:'plan'};}});
  assert.match(text(current(f)),/未确认/);assert.ok(nodes(f).some(n=>n.props?.role==='alert'));
  assert.equal(modeButton(f,'plan').props.disabled,false);
  await modeButton(f,'plan').props.onClick();await tick();open(f);await tick();
  assert.deepEqual(f.calls.map(c=>c[0]),['approvalGetMode','approvalGetMode','approvalSetMode','approvalGetMode']);
  assert.equal(text(current(f)),'当前：plan');
});
test('读取回执错型、非法枚举或失败形状均不作为模式',async()=>{
  for(const result of ['plan',null,{ok:false,mode:'yolo'},{ok:true,mode:'unknown'},{ok:true,mode:{name:'build'}}]){
    const f=await ready({approvalGetMode:async()=>result});
    assert.match(text(current(f)),/未确认/);assert.equal(modeButton(f,'yolo').props.disabled,false);
    assert.equal(f.calls.filter(c=>c[0]==='approvalSetMode').length,0);
  }
});
test('设置在途不乐观切换，重复点击不重复请求',async()=>{
  const wait=deferred();let read=0;const f=await ready({approvalGetMode:async()=>({ok:true,mode:++read===1?'build':'plan'}),approvalSetMode:()=>wait.promise});
  const choose=modeButton(f,'plan').props.onClick;choose();choose();await tick();
  assert.equal(text(current(f)),'当前：build');assert.equal(modeButton(f,'plan').props.disabled,true);
  assert.equal(f.calls.filter(c=>c[0]==='approvalSetMode').length,1);
  wait.resolve({ok:true,result:'committed'});await tick();open(f);await tick();assert.equal(text(current(f)),'当前：plan');
});
test('设置 committed 或 noop 后回读核实成功才显示新模式',async()=>{
  for(const result of ['committed','noop']){
    let mode='build';const f=await ready({approvalGetMode:async()=>({ok:true,mode}),approvalSetMode:async value=>{mode=value;return{ok:true,result};}});
    await modeButton(f,'auto').props.onClick();await tick();open(f);await tick();
    assert.equal(text(current(f)),'当前：auto');assert.deepEqual(f.calls.map(c=>c[0]),['approvalGetMode','approvalSetMode','approvalGetMode']);
  }
});
test('设置失败保留旧模式和菜单，显示错误且可重试',async()=>{
  let attempts=0;const f=await ready({approvalSetMode:async()=>{if(++attempts===1)throw Error('mode-write-failed');return{ok:true,result:'committed'};},approvalGetMode:async()=>({ok:true,mode:attempts>1?'plan':'build'})});
  await modeButton(f,'plan').props.onClick();await tick();assert.equal(text(current(f)),'当前：build');
  assert.match(text(f.render()),/mode-write-failed/);assert.equal(modeButton(f,'plan').props.disabled,false);
  await modeButton(f,'plan').props.onClick();await tick();open(f);await tick();assert.equal(text(current(f)),'当前：plan');
});
test('设置失败形状或非法结果不假报成功、不额外回读',async()=>{
  for(const result of [undefined,{ok:false,result:'committed'},{ok:true,result:'done'}]){
    const f=await ready({approvalSetMode:async()=>result});await modeButton(f,'yolo').props.onClick();await tick();
    assert.equal(text(current(f)),'当前：build');assert.ok(nodes(f).some(n=>n.props?.role==='alert'));
    assert.equal(f.calls.filter(c=>c[0]==='approvalGetMode').length,1);
  }
});
test('设置后回读不一致按后端实际模式显示，不冒充已切换',async()=>{
  const f=await ready({approvalGetMode:async()=>({ok:true,mode:'build'})});await modeButton(f,'plan').props.onClick();await tick();
  assert.equal(text(current(f)),'当前：build');assert.match(text(f.render()),/不一致/);
});
test('设置后回读失败改为未确认，不沿用旧状态猜测成功',async()=>{
  let reads=0;const f=await ready({approvalGetMode:async()=>{if(++reads>1)throw Error('readback-failed');return{ok:true,mode:'build'};}});
  await modeButton(f,'plan').props.onClick();await tick();assert.match(text(current(f)),/未确认/);
  assert.equal(modeButton(f,'auto').props.disabled,false);assert.ok(button(f,'重新读取'));
});
test('卸载移除两类文档监听，迟到初次读取不改变组件',async()=>{
  const wait=deferred(),f=fixture({approvalGetMode:()=>wait.promise});f.mount();open(f);await tick();
  const before=text(f.render());f.unmount();assert.equal(f.listeners.size,0);assert.equal(f.removed.length,2);
  wait.resolve({ok:true,mode:'yolo'});await tick();assert.equal(text(f.render()),before);
});
test('卸载后迟到设置回执不回读、不更新旧组件',async()=>{
  const wait=deferred(),f=await ready({approvalSetMode:()=>wait.promise});modeButton(f,'plan').props.onClick();await tick();
  const before=text(f.render());f.unmount();wait.resolve({ok:true,result:'committed'});await tick();
  assert.equal(f.calls.filter(c=>c[0]==='approvalGetMode').length,1);assert.equal(text(f.render()),before);
});
test('回读在途卸载后不把新模式写回旧会话组件',async()=>{
  const wait=deferred();let reads=0;const f=await ready({approvalGetMode:()=>++reads===1?Promise.resolve({ok:true,mode:'build'}):wait.promise});
  modeButton(f,'plan').props.onClick();await tick();assert.equal(reads,2);
  const before=text(f.render());f.unmount();wait.resolve({ok:true,mode:'plan'});await tick();assert.equal(text(f.render()),before);
});
test('Esc 关闭在途菜单不重复请求、不因迟到失败强制重新打开',async()=>{
  const wait=deferred(),f=await ready({approvalSetMode:()=>wait.promise});modeButton(f,'plan').props.onClick();await tick();
  f.render().props.onKeydown({key:'Escape',stopPropagation(){}});await tick();
  wait.reject(Error('late-mode-failure'));await tick();assert.equal(trigger(f).props['aria-expanded'],false);
  open(f);await tick();assert.equal(text(current(f)),'当前：build');assert.match(text(f.render()),/late-mode-failure/);
  assert.equal(f.calls.filter(c=>c[0]==='approvalSetMode').length,1);
});
test('Shift+Tab 仅处理本菜单焦点，在途不循环且卸载后不留监听',async()=>{
  const wait=deferred(),f=await ready({approvalSetMode:()=>wait.promise});let prevented=0;
  const key=f.listeners.get('keydown');const event={key:'Tab',shiftKey:true,preventDefault:()=>prevented++};
  key({...event,target:{}});assert.equal(prevented,0);assert.equal(f.calls.length,1);
  key({...event,target:f.ownedTarget});await tick();assert.equal(prevented,1);assert.equal(f.calls.at(-1)[1],'auto');
  key({...event,target:f.ownedTarget});assert.equal(f.calls.length,2);f.unmount();wait.resolve({ok:true,result:'committed'});await tick();
  assert.equal(f.listeners.size,0);
});
test('turn 在途时 -32001 turn-in-flight 显示友好提示而非原始协议码',async()=>{
  // IPC 包装后 message 形如 "Error invoking remote method 'sacode:approvalSetMode': -32001 turn-in-flight"。
  const f=await ready({approvalSetMode:async()=>{throw Error("Error invoking remote method 'sacode:approvalSetMode': -32001 turn-in-flight");}});
  await modeButton(f,'plan').props.onClick();await tick();
  const rendered=text(f.render());
  assert.match(rendered,/执行中不能切换权限模式/);
  assert.doesNotMatch(rendered,/-32001/);
  assert.doesNotMatch(rendered,/turn-in-flight/);
});

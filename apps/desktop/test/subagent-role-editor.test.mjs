// subagent-role-editor 组件行为测试：真实 Vue 响应式 + 事件派发，只替换宿主节点（同 team-panel 模式）。
// IPC 未接（preload/main 不动），数据面经 adapter 注入——adapter 契约即未来 IPC 通道的负载口径。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';

const source=fileURLToPath(new URL('../renderer/pages/subagent-role-editor.ts',import.meta.url));
const require=createRequire(import.meta.url),vue=require('vue');
let Page;
if(existsSync(source)){
  const compiled=await build({entryPoints:[source],bundle:true,write:false,platform:'node',format:'cjs',external:['vue'],logLevel:'silent'});
  const module={exports:{}};
  runInNewContext(compiled.outputFiles[0].text,{module,exports:module.exports,require:name=>name==='vue'?vue:require(name)});
  Page=module.exports.Page;
}
const node=(type,text='')=>({type,text,props:{},children:[],parent:null});
const renderer=vue.createRenderer({
  createElement:type=>node(type),createText:text=>node('#text',text),createComment:text=>node('#comment',text),
  setText:(n,text)=>{n.text=text;},setElementText:(n,text)=>{n.text=text;n.children=[];},
  parentNode:n=>n.parent,nextSibling:n=>n.parent?.children[n.parent.children.indexOf(n)+1]||null,
  patchProp:(n,key,old,value)=>{n.props[key]=value;},
  insert(n,parent,anchor=null){if(n.parent)n.parent.children.splice(n.parent.children.indexOf(n),1);n.parent=parent;const i=anchor?parent.children.indexOf(anchor):-1;if(i<0)parent.children.push(n);else parent.children.splice(i,0,n);},
  remove(n){if(n.parent)n.parent.children.splice(n.parent.children.indexOf(n),1);n.parent=null;},
});
const walk=n=>[n,...n.children.flatMap(walk)];
const text=n=>n.text+n.children.map(text).join('');
const flush=async()=>{await vue.nextTick();await new Promise(r=>setTimeout(r));await vue.nextTick();};

const builtin=(id,name,tools)=>({id,name,description:name+' 预设描述',systemPrompt:'内置 '+name+' 提示词',tools,acpEnabled:true,model:'inherit',budget:{},origin:'builtin',revision:'preset',writable:false});
const PRESETS=[builtin('builtin-explorer','explorer',['read']),builtin('builtin-planner','planner',['read']),builtin('builtin-implementer','implementer',['read','write','command']),builtin('builtin-reviewer','reviewer',['read'])];
const writer=()=>({id:'role-writer',name:'writer',description:'写作子代理',systemPrompt:'你是写作角色。',tools:['read','write'],acpEnabled:false,model:'m-fast',budget:{rounds:5},origin:'user',revision:'rev-9',writable:true});

// adapter mock：负载口径与组件契约一致；CAS 语义（按 revision 比对）在 mock 内模拟核心侧判定。
function makeAdapter({roles=PRESETS.concat([writer()]),models=[{id:'m-fast',label:'快模型',available:true},{id:'m-pro',label:'强模型',available:true}],failRead=false,saveError=null,deleteError=null}={}){
  const state={roles:roles.map(r=>({...r,budget:{...r.budget},tools:r.tools.slice()})),models:models.slice()};
  const calls={read:0,save:[],del:[]},listeners=new Set();
  let counter=0;
  const adapter={
    calls,
    read:async()=>{
      calls.read++;
      if(failRead)throw new Error('read failed');
      return{roles:state.roles.map(r=>({...r,budget:{...r.budget},tools:r.tools.slice()})),models:state.models.slice()};
    },
    saveRole:async(role,expectedRevision)=>{
      calls.save.push([JSON.parse(JSON.stringify(role)),expectedRevision]);
      if(saveError)throw saveError;
      const at=state.roles.findIndex(r=>r.id===role.id);
      if(at>=0&&state.roles[at].revision!==expectedRevision)throw{code:'role-conflict'};
      const n=++counter;
      const saved={...role,id:role.id||('role-'+n),budget:{...role.budget},tools:role.tools.slice(),revision:'rev-'+n};
      if(at>=0)state.roles[at]=saved;else state.roles.push(saved);
      return{...saved,budget:{...saved.budget},tools:saved.tools.slice()};
    },
    deleteRole:async(id,revision)=>{
      calls.del.push([id,revision]);
      if(deleteError)throw deleteError;
      const at=state.roles.findIndex(r=>r.id===id);
      if(at<0||state.roles[at].revision!==revision)throw{code:'role-conflict'};
      state.roles.splice(at,1);
    },
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    invalidate(){for(const fn of listeners)fn();},
    // 测试注入：外部并发修改（改内容并推进修订号）。
    mutateExternally(id,patch){const at=state.roles.findIndex(r=>r.id===id);if(at>=0)state.roles[at]={...state.roles[at],...patch,revision:'rev-ext-'+(++counter)};},
  };
  return adapter;
}
function mount(adapter){
  assert.ok(Page,'subagent-role-editor 尚未实现：先定义行为测试，再新增组件');
  const props=vue.reactive({adapter}),root=node('root');
  const app=renderer.createApp({render:()=>vue.h(Page,{...props})});app.mount(root);
  return{root,props,unmount:()=>app.unmount()};
}
const find=(f,type,label)=>walk(f.root).find(n=>n.type===type&&(n.props['aria-label']===label||text(n)===label));
const button=(f,label)=>{const n=find(f,'button',label);assert.ok(n,'缺少按钮：'+label);return n;};
async function input(f,label,value){const n=walk(f.root).find(n=>['input','textarea','select'].includes(n.type)&&n.props['aria-label']===label);assert.ok(n,'缺少输入：'+label);(n.props.onInput||n.props.onChange)({target:{value}});await vue.nextTick();}
async function toggle(f,label){const n=walk(f.root).find(n=>n.type==='input'&&n.props['aria-label']===label);assert.ok(n,'缺少开关：'+label);n.props.onChange();await vue.nextTick();}
async function submit(f,label='保存'){const b=button(f,label);let n=b;while(n&&n.type!=='form')n=n.parent;assert.ok(n,'操作应支持原生表单键盘提交');let prevented=false;n.props.onSubmit({preventDefault(){prevented=true;}});assert.ok(prevented);await vue.nextTick();}
const plain=v=>JSON.parse(JSON.stringify(v));

test('无 adapter 时只读展示 4 个内置预设，不虚构读写入口',async()=>{
  const f=mount(undefined);await flush();
  for(const name of ['explorer','planner','implementer','reviewer'])assert.ok(text(f.root).includes(name),name);
  assert.match(text(f.root),/角色接口尚未接入/);
  assert.equal(walk(f.root).filter(n=>n.props['data-role-origin']==='builtin').length,4);
  assert.ok(!find(f,'button','新建自定义角色'));
  assert.ok(button(f,'复制 explorer 为自定义').props.disabled);
  button(f,'打开角色 explorer').props.onClick();await vue.nextTick();
  assert.ok(walk(f.root).filter(n=>['input','textarea','select'].includes(n.type)).every(n=>n.props.disabled));
  assert.ok(!find(f,'button','编辑'));assert.ok(!find(f,'button','删除'));
  f.unmount();
});

test('角色列表展示来源、工具集、修订号与 ACP 徽标，模型面来自 adapter',async()=>{
  const adapter=makeAdapter(),f=mount(adapter);await flush();
  assert.match(text(f.root),/用户 · 读文件\/写文件 · 修订 rev-9/);
  assert.equal(walk(f.root).find(n=>n.props['data-role-id']==='role-writer')?.children.filter(n=>n.type==='span'&&text(n)==='ACP').length,0); // writer ACP 关闭
  assert.ok(walk(f.root).find(n=>n.props['data-role-id']==='builtin-explorer')?.children.some(n=>text(n)==='ACP'));
  button(f,'打开角色 writer').props.onClick();await vue.nextTick();
  for(const value of ['writer','当前修订 rev-9'])assert.ok(text(f.root).includes(value),value);
  assert.equal(find(f,'input','角色描述').props.value,'写作子代理'); // 只读详情的描述/提示词是输入值，不虚构文本节点
  assert.equal(find(f,'textarea','System Prompt').props.value,'你是写作角色。');
  assert.ok(button(f,'编辑').props.type==='button');
  const model=walk(f.root).find(n=>n.type==='select'&&n.props['aria-label']==='模型');
  assert.deepEqual(model.children.map(o=>o.props.value),['inherit','m-fast','m-pro']);
  f.unmount();
});

test('未知模型不冒充可用：追加不可用项并标注',async()=>{
  const adapter=makeAdapter({roles:PRESETS.concat([{...writer(),model:'m-gone'}])}),f=mount(adapter);await flush();
  button(f,'打开角色 writer').props.onClick();await vue.nextTick();
  const model=walk(f.root).find(n=>n.type==='select'&&n.props['aria-label']==='模型');
  assert.deepEqual(model.children.map(o=>o.props.value),['inherit','m-fast','m-pro','m-gone']);
  assert.equal(text(model.children[3]),'m-gone（当前不可用）');
  f.unmount();
});

test('复制内置为自定义：预填内容、无修订基线、保存负载与 expectedRevision 为空',async()=>{
  const adapter=makeAdapter(),f=mount(adapter);await flush();
  button(f,'复制 explorer 为自定义').props.onClick();await vue.nextTick();
  assert.match(text(f.root),/编辑角色/);assert.match(text(f.root),/新角色（无修订基线）/);
  assert.equal(find(f,'input','角色名称').props.value,'explorer（副本）');
  assert.ok(!find(f,'input','角色名称').props.disabled);
  await submit(f);
  assert.equal(adapter.calls.save.length,1);
  const [saved,expected]=adapter.calls.save[0];
  assert.equal(expected,'');
  assert.deepEqual(plain({...saved,budget:saved.budget}),{id:'',name:'explorer（副本）',description:'explorer 预设描述',systemPrompt:'内置 explorer 提示词',tools:['read'],acpEnabled:true,model:'inherit',budget:{},origin:'user',revision:'',writable:true});
  await flush();
  assert.equal(walk(f.root).filter(n=>n.props['data-role-id']==='role-1').length,1); // mock 为新角色分配的 id
  assert.match(text(f.root),/当前修订 rev-1/);
  f.unmount();
});

test('新建角色：默认最小能力，名称/描述必填，预算留空不进入负载',async()=>{
  const adapter=makeAdapter(),f=mount(adapter);await flush();
  button(f,'新建自定义角色').props.onClick();await vue.nextTick();
  assert.equal(walk(f.root).filter(n=>n.type==='input'&&n.props.type==='checkbox'&&n.props.checked===true&&n.props['aria-label']?.startsWith('工具：')).length,1); // 仅默认读文件
  assert.ok(button(f,'保存').props.disabled);
  await input(f,'角色名称','编排');assert.ok(button(f,'保存').props.disabled);
  await input(f,'角色描述','调度子代理');
  await toggle(f,'工具：写文件');await toggle(f,'工具：跑命令');await toggle(f,'工具：MCP');
  await input(f,'轮次上限','5');await input(f,'Token 上限',' 2000 ');
  await submit(f);
  assert.equal(adapter.calls.save.length,1);
  const [saved]=adapter.calls.save[0];
  assert.equal(saved.name,'编排');assert.equal(saved.description,'调度子代理');
  assert.deepEqual(saved.tools,['read','write','command','mcp']);
  assert.deepEqual(saved.budget,{rounds:5,tokens:2000}); // 留空字段不出现
  assert.equal(saved.acpEnabled,false);
  f.unmount();
});

test('工具集是闭环勾选：恰好 8 项，负载只含已知键',async()=>{
  const adapter=makeAdapter(),f=mount(adapter);await flush();
  button(f,'新建自定义角色').props.onClick();await vue.nextTick();
  const boxes=walk(f.root).filter(n=>n.type==='input'&&n.props.type==='checkbox'&&n.props['aria-label']?.startsWith('工具：'));
  assert.equal(boxes.length,8);
  for(const label of ['工具：浏览器','工具：SSH','工具：数据库','工具：Skill'])await toggle(f,label);
  await input(f,'角色名称','x');await input(f,'角色描述','d');await submit(f);
  assert.deepEqual(adapter.calls.save[0][0].tools,['read','browser','ssh','database','skill']);
  f.unmount();
});

test('预算校验：非正整数阻断保存并标注 aria-invalid',async()=>{
  const adapter=makeAdapter(),f=mount(adapter);await flush();
  button(f,'新建自定义角色').props.onClick();await vue.nextTick();
  await input(f,'角色名称','x');await input(f,'角色描述','d');
  for(const bad of ['0','-1','1.5','abc']){await input(f,'轮次上限',bad);assert.ok(button(f,'保存').props.disabled,bad);assert.equal(find(f,'input','轮次上限').props['aria-invalid'],true,bad);}
  await input(f,'轮次上限','3');assert.ok(!button(f,'保存').props.disabled);
  await submit(f);assert.deepEqual(adapter.calls.save[0][0].budget,{rounds:3});
  f.unmount();
});

test('编辑用户角色携带 CAS 基线：expectedRevision 为打开时修订号，成功后显示新修订',async()=>{
  const adapter=makeAdapter(),f=mount(adapter);await flush();
  button(f,'打开角色 writer').props.onClick();await vue.nextTick();
  button(f,'编辑').props.onClick();await vue.nextTick();
  assert.ok(button(f,'保存').props.disabled); // 未改动不可保存
  await input(f,'角色名称','writer2');
  assert.match(text(f.root),/基于修订 rev-9/);
  await submit(f);
  assert.equal(adapter.calls.save.length,1);
  const [saved,expected]=adapter.calls.save[0];
  assert.equal(expected,'rev-9');assert.equal(saved.id,'role-writer');assert.equal(saved.name,'writer2');
  await flush();
  assert.match(text(f.root),/当前修订 rev-1/);assert.equal(walk(f.root).some(n=>n.props['data-role-id']==='role-writer'&&text(n).includes('writer2')),true);
  f.unmount();
});

test('保存冲突（role-conflict）：草稿保留、保存禁用、提示最新修订，可放弃重读',async()=>{
  const adapter=makeAdapter({saveError:{code:'role-conflict'}}),f=mount(adapter);await flush();
  button(f,'打开角色 writer').props.onClick();await vue.nextTick();
  button(f,'编辑').props.onClick();await vue.nextTick();
  await input(f,'角色名称','writer2');await submit(f);await flush(); // 保存拒绝在微任务后渲染，需 macrotask flush
  assert.match(text(f.root),/已在其他位置更新/);
  assert.ok(button(f,'保存').props.disabled);
  assert.equal(find(f,'input','角色名称').props.value,'writer2'); // 草稿不丢
  button(f,'放弃修改并重新读取').props.onClick();await flush();
  assert.ok(!text(f.root).match(/已在其他位置更新/));
  assert.equal(find(f,'input','角色名称').props.disabled,true); // 回到只读详情
  assert.equal(adapter.calls.read,2);
  f.unmount();
});

test('外部并发修订经 subscribe 触发重读：内容不同报冲突，内容一致静默收编草稿',async()=>{
  const adapter=makeAdapter(),f=mount(adapter);await flush();
  button(f,'打开角色 writer').props.onClick();await vue.nextTick();
  button(f,'编辑').props.onClick();await vue.nextTick();
  await input(f,'角色名称','writer2');
  adapter.mutateExternally('role-writer',{name:'other'});adapter.invalidate();await flush();
  assert.match(text(f.root),/已在其他位置更新/);assert.ok(button(f,'保存').props.disabled);
  button(f,'放弃修改并重新读取').props.onClick();await flush();
  assert.match(text(f.root),/other/);
  f.unmount();
  // 内容一致：外部保存了用户正在编辑的同样内容 → 不报冲突、草稿收编为详情。
  const adapter2=makeAdapter(),g=mount(adapter2);await flush();
  button(g,'打开角色 writer').props.onClick();await vue.nextTick();
  button(g,'编辑').props.onClick();await vue.nextTick();
  await input(g,'角色名称','writer2');
  adapter2.mutateExternally('role-writer',{name:'writer2',description:'写作子代理',systemPrompt:'你是写作角色。',tools:['read','write'],acpEnabled:false,model:'m-fast',budget:{rounds:5}});
  adapter2.invalidate();await flush();
  assert.ok(!text(g.root).match(/已在其他位置更新/));
  assert.equal(find(g,'input','角色名称').props.disabled,true);assert.equal(find(g,'input','角色名称').props.value,'writer2');
  g.unmount();
});

test('删除是两步确认：只发 id 与修订号；内置预设不出现删除按钮',async()=>{
  const adapter=makeAdapter(),f=mount(adapter);await flush();
  assert.equal(walk(f.root).filter(n=>n.type==='button'&&text(n)==='删除').length,1); // 仅 writer
  button(f,'删除 writer').props.onClick();await vue.nextTick();
  assert.deepEqual(adapter.calls.del,[]); // 第一步只进入确认
  assert.equal(text(button(f,'删除 writer')),'确认删除');
  button(f,'删除 writer').props.onClick();await flush();
  assert.deepEqual(adapter.calls.del,[['role-writer','rev-9']]);
  assert.equal(walk(f.root).some(n=>n.props['data-role-id']==='role-writer'),false);
  assert.ok(!text(f.root).includes('写作子代理'));
  f.unmount();
});

test('删除冲突提示修订已变，不删本地条目',async()=>{
  const adapter=makeAdapter({deleteError:{code:'role-conflict'}}),f=mount(adapter);await flush();
  button(f,'删除 writer').props.onClick();await vue.nextTick();
  button(f,'删除 writer').props.onClick();await flush();
  assert.match(text(f.root),/已在其他位置更新/);
  assert.equal(walk(f.root).some(n=>n.props['data-role-id']==='role-writer'),true);
  f.unmount();
});

test('busy 门控：保存中禁用全部写操作，完成后恢复并更新列表',async()=>{
  const adapter=makeAdapter();let release;const realSave=adapter.saveRole;
  adapter.saveRole=(role,rev)=>new Promise(res=>{realSave(role,rev).then(saved=>{release=()=>res(saved);});});
  const f=mount(adapter);await flush();
  button(f,'打开角色 writer').props.onClick();await vue.nextTick();
  button(f,'编辑').props.onClick();await vue.nextTick();
  await input(f,'角色名称','writer2');await submit(f);
  assert.match(text(f.root),/保存中…/);
  assert.ok(button(f,'保存中…').props.disabled);
  assert.ok(walk(f.root).filter(n=>['input','textarea','select'].includes(n.type)).every(n=>n.props.disabled));
  assert.ok(button(f,'新建自定义角色').props.disabled);
  assert.ok(release,'保存应处于未决状态');release();await flush();
  assert.match(text(f.root),/当前修订 rev-1/);
  assert.ok(!walk(f.root).some(n=>n.type==='button'&&text(n).startsWith('保存'))); // 保存成功后退出编辑，无残留保存按钮
  f.unmount();
});

test('读取失败与空列表：不虚构角色事实',async()=>{
  const failed=makeAdapter({failRead:true}),f=mount(failed);await flush();
  assert.match(text(f.root),/暂时无法读取角色定义/);
  assert.ok(!text(f.root).includes('explorer')); // adapter 存在时不回退内置预设
  f.unmount();
  const empty=makeAdapter({roles:[]}),g=mount(empty);await flush();
  assert.match(text(g.root),/暂无自定义角色/);
  assert.ok(button(g,'新建自定义角色'));
  g.unmount();
});

test('角色文本均为文本节点：无 HTML 注入，输入值原样保留',async()=>{
  const attack='<img src=x onerror=alert(1)>';
  const adapter=makeAdapter({roles:PRESETS.concat([{...writer(),name:attack}])}),f=mount(adapter);await flush();
  assert.ok(text(f.root).includes(attack));
  assert.ok(!walk(f.root).some(n=>['img','script'].includes(n.type)||'innerHTML' in n.props));
  button(f,'打开角色 '+attack).props.onClick();await vue.nextTick();
  button(f,'编辑').props.onClick();await vue.nextTick();
  await input(f,'角色名称',attack);
  assert.equal(find(f,'input','角色名称').props.value,attack);
  await input(f,'角色描述','d');await submit(f);
  assert.equal(adapter.calls.save[0][0].name,attack);
  f.unmount();
});

test('ACP 开关与提示：能力只代表可申请，权限边界提示在场',async()=>{
  const adapter=makeAdapter(),f=mount(adapter);await flush();
  button(f,'打开角色 writer').props.onClick();await vue.nextTick();
  button(f,'编辑').props.onClick();await vue.nextTick();
  assert.match(text(f.root),/每次外部调用仍需审批/);
  await toggle(f,'ACP 能力');await input(f,'角色名称','w');await input(f,'角色描述','d');await submit(f);
  assert.equal(adapter.calls.save[0][0].acpEnabled,true);
  assert.match(text(f.root),/不含密钥/);
  f.unmount();
});

test('未改动不可保存；放弃修改回到基线',async()=>{
  const adapter=makeAdapter(),f=mount(adapter);await flush();
  button(f,'打开角色 writer').props.onClick();await vue.nextTick();
  button(f,'编辑').props.onClick();await vue.nextTick();
  assert.ok(button(f,'保存').props.disabled);
  await input(f,'角色名称','writer2');assert.ok(!button(f,'保存').props.disabled);
  button(f,'撤销修改').props.onClick();await vue.nextTick();
  assert.equal(find(f,'input','角色名称').props.value,'writer');assert.ok(button(f,'保存').props.disabled);
  await submit(f);assert.deepEqual(adapter.calls.save,[]);
  f.unmount();
});

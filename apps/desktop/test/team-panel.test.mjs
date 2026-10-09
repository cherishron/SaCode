import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';

const source=fileURLToPath(new URL('../renderer/pages/team-panel.ts',import.meta.url));
const require=createRequire(import.meta.url),vue=require('vue');
let TeamPanel;
if(existsSync(source)){
  const compiled=await build({entryPoints:[source],bundle:true,write:false,platform:'node',format:'cjs',external:['vue'],logLevel:'silent'});
  const module={exports:{}};
  runInNewContext(compiled.outputFiles[0].text,{module,exports:module.exports,require:name=>name==='vue'?vue:require(name)});
  TeamPanel=module.exports.TeamPanel;
}
// 使用真实 Vue 响应式与事件派发，只替换宿主节点，不新增 DOM 测试依赖。
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
const empty=()=>({members:[],tasks:[],messages:[]});
const snapshot=()=>({members:[{id:'alice',role:'开发',sessionId:'session-a',status:'running'},{id:'bob',role:'审查',sessionId:'session-b',status:'idle'}],tasks:[{id:'t1',title:'实现',owner:'alice',status:'pending',dependencies:[],result:''}],messages:[{id:'m1',sender:'alice',target:'bob',text:'请审查',status:'pending'}]});
function mount(extra={}){
  assert.ok(TeamPanel,'TeamPanel 尚未实现：先定义行为测试，再新增组件');
  const props=vue.reactive({snapshot:empty(),busy:false,error:'',...extra}),events=[],root=node('root');
  const listeners=Object.fromEntries(['addMember','sendMessage','createTask','assignTask','stopMember','selectSession','refresh'].map(name=>['on'+name[0].toUpperCase()+name.slice(1),(...args)=>events.push([name,...args])]));
  const app=renderer.createApp({render:()=>vue.h(TeamPanel,{...props,...listeners})});app.mount(root);
  return{root,props,events,unmount:()=>app.unmount()};
}
const find=(f,type,label)=>walk(f.root).find(n=>n.type===type&&(n.props['aria-label']===label||text(n)===label));
const button=(f,label)=>{const n=find(f,'button',label);assert.ok(n,'缺少按钮：'+label);return n;};
async function input(f,label,value){const n=walk(f.root).find(n=>['input','textarea','select'].includes(n.type)&&n.props['aria-label']===label);assert.ok(n,'缺少输入：'+label);(n.props.onInput||n.props.onChange)({target:{value}});await vue.nextTick();}
async function submit(f,label){const b=button(f,label);let n=b;while(n&&n.type!=='form')n=n.parent;assert.ok(n,'操作应支持原生表单键盘提交');let prevented=false;n.props.onSubmit({preventDefault(){prevented=true;}});assert.ok(prevented);await vue.nextTick();}
const plain=v=>JSON.parse(JSON.stringify(v));

 test('空快照不虚构成员、任务或消息，刷新只发无参事件',()=>{
  const f=mount();assert.match(text(f.root),/暂无成员/);assert.match(text(f.root),/暂无任务/);assert.match(text(f.root),/暂无消息/);
  assert.equal(walk(f.root).filter(n=>n.props['data-member-id']).length,0);
  button(f,'刷新').props.onClick();assert.deepEqual(f.events,[['refresh']]);f.unmount();
});
test('成员状态、会话身份和消息送达状态均来自快照',()=>{
  const f=mount({snapshot:snapshot()});for(const value of ['alice','开发','session-a','running','审查','idle','请审查','pending'])assert.ok(text(f.root).includes(value),value);
  assert.equal(walk(f.root).filter(n=>n.props['data-message-id']==='m1').length,1);assert.deepEqual(f.events,[]);f.unmount();
});
test('任务分入五态看板，依赖、owner、失败结果原样展示，未知态不冒充完成',()=>{
  const s=snapshot();s.tasks=['pending','running','completed','failed','cancelled','new-state'].map((status,i)=>({id:'t'+i,title:'任务'+i,owner:'bob',status,dependencies:['upstream'],result:status==='failed'?'真实失败原因':''}));
  const f=mount({snapshot:s});for(const status of ['pending','running','completed','failed','cancelled','new-state']){
    const card=walk(f.root).find(n=>n.props['data-task-id']==='t'+s.tasks.findIndex(t=>t.status===status));assert.ok(card);assert.ok(text(card).includes(status));
    if(status!=='new-state'){let parent=card.parent;while(parent&&!parent.props['data-task-status'])parent=parent.parent;assert.equal(parent?.props['data-task-status'],status);}
  }
  assert.match(text(f.root),/upstream/);assert.match(text(f.root),/真实失败原因/);assert.match(text(f.root),/new-state/);f.unmount();
});
test('成员会话按钮是可键盘激活的 button，emit 精确 sessionId，缺失关联时禁用',()=>{
  const s=snapshot();s.members.push({id:'orphan',role:'开发',sessionId:'',status:'idle'});const f=mount({snapshot:s});
  const b=button(f,'打开成员 alice 的会话');assert.equal(b.props.type,'button');b.props.onClick();
  const missing=button(f,'打开成员 orphan 的会话');assert.ok(missing.props.disabled);missing.props.onClick();assert.deepEqual(f.events,[['selectSession','session-a']]);f.unmount();
});
test('创建成员表单 trim 用户字段，只 emit name/role，不新增假成员且保留草稿',async()=>{
  const f=mount();await input(f,'成员名称',' Alice ');await input(f,'成员角色',' 开发 ');await submit(f,'创建成员');
  assert.deepEqual(plain(f.events),[['addMember',{name:'Alice',role:'开发'}]]);assert.match(text(f.root),/暂无成员/);
  assert.equal(find(f,'input','成员名称').props.value,' Alice ');f.unmount();
});
test('空白名称或角色不能发创建成员事件',async()=>{
  const f=mount();await input(f,'成员名称',' ');await input(f,'成员角色','开发');await submit(f,'创建成员');assert.deepEqual(f.events,[]);
  await input(f,'成员名称','alice');await input(f,'成员角色',' ');await submit(f,'创建成员');assert.deepEqual(f.events,[]);assert.ok(walk(f.root).some(n=>n.props.role==='alert'));f.unmount();
});
test('发送消息保留正文原始字节，仅向快照中的目标 emit，不乐观新增或标成已送达',async()=>{
  const s=snapshot(),before=plain(s),f=mount({snapshot:s});await input(f,'消息目标','bob');await input(f,'消息正文','  第一行\n<script>正文</script>  ');await submit(f,'发送消息');
  assert.deepEqual(plain(f.events),[['sendMessage',{target:'bob',text:'  第一行\n<script>正文</script>  '}]]);assert.deepEqual(plain(s),before);
  assert.equal(walk(f.root).filter(n=>n.props['data-message-id']).length,1);assert.match(text(f.root),/pending/);f.unmount();
});
test('消息拒绝空白正文和已从快照消失的目标',async()=>{
  const f=mount({snapshot:snapshot()});await input(f,'消息目标','bob');await input(f,'消息正文',' \n ');await submit(f,'发送消息');assert.deepEqual(f.events,[]);
  await input(f,'消息正文','真实草稿');f.props.snapshot=empty();await vue.nextTick();await submit(f,'发送消息');assert.deepEqual(f.events,[]);f.unmount();
});
test('创建任务发送 title 与去重 dependencies，只请求不增加任务事实',async()=>{
  const f=mount({snapshot:snapshot()});await input(f,'任务标题',' 新任务 ');await input(f,'依赖任务（JSON 数组）','["t1","t1"]');await submit(f,'创建任务');
  assert.deepEqual(plain(f.events),[['createTask',{title:'新任务',dependencies:['t1']}]]);assert.equal(walk(f.root).filter(n=>n.props['data-task-id']).length,1);f.unmount();
});
test('任务拒绝空标题、畸形依赖、非字符串依赖及未知依赖',async()=>{
  const f=mount({snapshot:snapshot()});await submit(f,'创建任务');await input(f,'任务标题','任务');
  for(const value of ['oops','{}','[1]','["missing"]']){await input(f,'依赖任务（JSON 数组）',value);await submit(f,'创建任务');assert.deepEqual(f.events,[]);assert.ok(walk(f.root).some(n=>n.props.role==='alert'));}f.unmount();
});
test('分派任务只发 taskId/memberId，不修改 owner 和 pending 状态',async()=>{
  const s=snapshot(),f=mount({snapshot:s});await input(f,'任务 t1 的受派成员','bob');button(f,'分派任务 t1').props.onClick();
  assert.deepEqual(plain(f.events),[['assignTask',{taskId:'t1',memberId:'bob'}]]);assert.equal(s.tasks[0].owner,'alice');assert.equal(s.tasks[0].status,'pending');f.unmount();
});
test('终态任务或消失成员不能分派，终态成员不可重复停止',async()=>{
  const s=snapshot();s.tasks[0].status='completed';s.members[0].status='cancelled';const f=mount({snapshot:s});
  await input(f,'任务 t1 的受派成员','bob');assert.ok(button(f,'分派任务 t1').props.disabled);button(f,'分派任务 t1').props.onClick();
  assert.ok(button(f,'停止成员 alice').props.disabled);button(f,'停止成员 alice').props.onClick();assert.deepEqual(f.events,[]);
  f.props.snapshot=snapshot();await vue.nextTick();await input(f,'任务 t1 的受派成员','bob');f.props.snapshot.members.pop();await vue.nextTick();button(f,'分派任务 t1').props.onClick();assert.deepEqual(f.events,[]);f.unmount();
});
test('停止只发成员 id，状态仍为快照值；快照替换后自动更新，不保留旧团队事实',async()=>{
  const f=mount({snapshot:snapshot()});button(f,'停止成员 alice').props.onClick();assert.deepEqual(f.events,[['stopMember','alice']]);assert.match(text(f.root),/running/);
  f.props.snapshot=empty();await vue.nextTick();assert.match(text(f.root),/暂无成员/);assert.equal(walk(f.root).filter(n=>n.props['data-task-id']).length,0);f.unmount();
});
test('busy 显示 loading 并门控写操作和刷新，旧回调也不能绕过；会话导航仍可用',async()=>{
  const f=mount({snapshot:snapshot()});await input(f,'成员名称','new');await input(f,'成员角色','开发');await input(f,'消息目标','bob');await input(f,'消息正文','hi');await input(f,'任务标题','new');await input(f,'任务 t1 的受派成员','bob');
  const oldStop=button(f,'停止成员 alice').props.onClick,oldAssign=button(f,'分派任务 t1').props.onClick;f.props.busy=true;await vue.nextTick();
  assert.ok(walk(f.root).some(n=>n.props.role==='status'&&/正在/.test(text(n))));
  for(const label of ['创建成员','发送消息','创建任务','分派任务 t1','停止成员 alice','刷新'])assert.ok(button(f,label).props.disabled,label);
  for(const n of walk(f.root).filter(n=>['input','textarea','select'].includes(n.type)))assert.ok(n.props.disabled);
  oldStop();oldAssign();await submit(f,'创建成员');await submit(f,'发送消息');await submit(f,'创建任务');button(f,'刷新').props.onClick();assert.deepEqual(f.events,[]);
  button(f,'打开成员 alice 的会话').props.onClick();assert.deepEqual(f.events,[['selectSession','session-a']]);f.unmount();
});
test('错误、用户输入和模型文本均为文本节点，无 HTML 注入或后端成功宣称',async()=>{
  const attack='<img src=x onerror=alert(1)>',s=snapshot();s.members[0].role=attack;s.tasks[0].title=attack;s.tasks[0].result=attack;s.messages[0].text=attack;
  const f=mount({snapshot:s,error:attack});assert.ok(walk(f.root).some(n=>n.props.role==='alert'&&text(n)===attack));
  await input(f,'成员名称',attack);assert.equal(find(f,'input','成员名称').props.value,attack);
  assert.ok(text(f.root).includes(attack));assert.ok(!walk(f.root).some(n=>['img','script'].includes(n.type)||'innerHTML' in n.props));
  assert.match(text(f.root),/操作仅发出请求/);assert.doesNotMatch(readFileSync(source,'utf8'),/innerHTML|window\.(?:api|sacode)|ipcRenderer/);f.unmount();
});

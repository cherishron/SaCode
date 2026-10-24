import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadPageModule} from './support/load-page-module.mjs';
import {fileURLToPath} from 'node:url';

const vue={defineComponent:x=>x,ref:v=>({value:v}),computed:spec=>({get value(){return typeof spec==='function'?spec():spec.get();},set value(v){spec.set(v);}}),watch:()=>{},onMounted:fn=>fn(),onBeforeUnmount:()=>{}};
const module=loadPageModule(new URL('../renderer/pages/connection-page.ts',import.meta.url),{vue});
const ConnectionPage=module.ConnectionPage;

function makeApi(){
  const calls=[];
  return {api:{connectionList:async(sessionId,scope)=>{calls.push({method:'connectionList',sessionId,scope});return {revision:0,definitions:[],scope,workspace:''};},
    connectionSave:async(sessionId,scope,revision,definition)=>{calls.push({method:'connectionSave',sessionId,scope,revision,definition});return {revision:revision+1,definitions:[definition],scope,workspace:''};},
    connectionControl:async(sessionId,scope,revision,id,action)=>{calls.push({method:'connectionControl',sessionId,scope,revision,id,action});return {revision:revision+1,definitions:[],scope,workspace:''};}},calls};
}

function setup(props={api:{connectionList:async() =>({revision:0,definitions:[],scope:'user',workspace:''}),connectionSave:async(s,sc,r,d)=>({revision:r+1,definitions:[d],scope:sc,workspace:''}),connectionControl:async() =>({revision:1,definitions:[],scope:'user',workspace:''})},sessionId:'s1'}){
  let mounted=[],unmount=[];
  const vue={defineComponent:x=>x,h:(type,props,children)=>({type,props,children}),ref:v=>({value:v}),computed:spec=>({get value(){return typeof spec==='function'?spec():spec.get();},set value(v){spec.set(v);}}),watch:()=>{},onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>unmount.push(fn)};
  const module=loadPageModule(new URL('../renderer/pages/connection-page.ts',import.meta.url),{vue});
  const render=module.ConnectionPage.setup({...props,onBack(){}},{emit(){}});
  return {render,mounted,unmount};
}
const nodes=n=>Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...nodes(n.children)]:[];

test('ConnectionPage 加载连接列表并展示空态，不冒充已有连接',async()=>{
  const {render,mounted}=setup();mounted[0]();await new Promise(r=>setImmediate(r));
  const list=nodes(render());
  assert.ok(list.some(n=>n.children&&JSON.stringify(n.children).includes('暂无连接')),'空态必须说明暂无连接');
  assert.equal(list.find(n=>n.type==='button'&&n.children==='保存'),undefined,'无编辑表单时不应有保存按钮');
  assert.ok(list.some(n=>n.type==='button'&&n.children==='添加连接'),'必须有添加连接按钮');
});

test('ConnectionPage 新增数据库连接调用 connectionSave，不显示密码字段',async()=>{
  const {api,calls}=makeApi();
  const {render,mounted}=setup({api,sessionId:'s1'});
  mounted[0]();await new Promise(r=>setImmediate(r));
  const list=nodes(render());
  list.find(n=>n.type==='button'&&n.children==='添加连接').props.onClick();
  const form=nodes(render());
  const kindSelect=form.find(n=>n.props?.['aria-label']==='连接类型');
  kindSelect.props.onChange({target:{value:'database'}});
  const save=form.find(n=>n.type==='button'&&n.children==='保存');
  assert.ok(save,'保存按钮存在');
  assert.equal(form.some(n=>n.props?.['aria-label']==='密码'),false,'不得有密码字段');
  assert.equal(form.some(n=>n.props?.['aria-label']==='明文口令'),false,'不得有明文口令字段');
});

test('ConnectionPage 启用连接调用 control 但不启动连接，无测试连接按钮',async()=>{
  const definition={id:'db-local',title:'本地库',kind:'database',enabled:false,spec:{engine:'postgresql',host:'localhost',port:5432,database:'demo',user:'tester',credentialRef:'DB_TEST_PASSWORD',tlsMode:'verify-full'}};
  const api={connectionList:async()=>({revision:1,definitions:[definition],scope:'user',workspace:''}),connectionSave:async(s,sc,r,d)=>({revision:r+1,definitions:[d],scope:sc,workspace:''}),connectionControl:async(s,sc,r,id,action)=>({revision:r+1,definitions:[{...definition,enabled:action==='enable'}],scope:sc,workspace:''})};
  const {render,mounted}=setup({api,sessionId:'s1'});mounted[0]();await new Promise(r=>setImmediate(r));
  const list=nodes(render());
  assert.equal(list.some(n=>n.type==='button'&&n.children==='测试连接'),false,'不得有测试连接按钮（那是独立审批通道）');
  assert.equal(list.some(n=>n.type==='button'&&n.children==='启动服务'),false,'不得有启动服务按钮');
  const enableBtn=list.find(n=>n.type==='button'&&n.children==='启用');
  assert.ok(enableBtn,'启用按钮存在');
});

test('ConnectionPage CAS 冲突展示友好提示并保留草稿',async()=>{
  const definition={id:'db-local',title:'本地库',kind:'database',enabled:false,spec:{engine:'postgresql',host:'localhost',port:5432,database:'demo',user:'tester',credentialRef:'DB_TEST_PASSWORD',tlsMode:'verify-full'}};
  const api={connectionList:async()=>({revision:1,definitions:[definition],scope:'user',workspace:''}),connectionSave:async()=>{throw Error('connection-revision-conflict');},connectionControl:async()=>({revision:2,definitions:[definition],scope:'user',workspace:''})};
  const {render,mounted}=setup({api,sessionId:'s1'});mounted[0]();await new Promise(r=>setImmediate(r));
  const list=nodes(render());
  list.find(n=>n.type==='button'&&n.children==='编辑').props.onClick();
  const form=nodes(render());
  const save=form.find(n=>n.type==='button'&&n.children==='保存');
  await save.props.onClick();await new Promise(r=>setImmediate(r));
  const after=nodes(render());
  assert.ok(after.some(n=>n.children&&JSON.stringify(n.children).includes('已被其他操作更新')),'CAS冲突展示友好提示');
});

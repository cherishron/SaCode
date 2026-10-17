// 真实Vue响应式/事件/页面挂载；只替换宿主节点，无需额外DOM依赖。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url),Vue=require('vue');
const compile=await build({stdin:{contents:"export {Page} from './provider-settings';export {createModelCenterAdapters} from './model-center-adapter';",resolveDir:fileURLToPath(new URL('../../renderer/pages/',import.meta.url)),loader:'ts'},bundle:true,write:false,format:'cjs',external:['vue']});
const module={exports:{}};
vm.runInNewContext(compile.outputFiles[0].text,{module,exports:module.exports,require:()=>Vue,crypto:{randomUUID},URL,Set,Map});
const {Page,createModelCenterAdapters}=module.exports;
const node=(type,text='')=>({type,text,props:{},children:[],parent:null});
const renderer=Vue.createRenderer({
  createElement:type=>node(type),createText:text=>node('#text',text),createComment:text=>node('#comment',text),
  setText:(n,text)=>{n.text=text;},setElementText:(n,text)=>{n.text=text;n.children=[];},
  parentNode:n=>n.parent,nextSibling:n=>n.parent?.children[n.parent.children.indexOf(n)+1]||null,
  patchProp:(n,key,_old,value)=>{n.props[key]=value;},
  insert(n,parent,anchor=null){if(n.parent)n.parent.children.splice(n.parent.children.indexOf(n),1);n.parent=parent;const i=anchor?parent.children.indexOf(anchor):-1;if(i<0)parent.children.push(n);else parent.children.splice(i,0,n);},
  remove(n){if(n.parent)n.parent.children.splice(n.parent.children.indexOf(n),1);n.parent=null;},
});
const walk=n=>[n,...n.children.flatMap(walk)];
const text=n=>n.text+n.children.map(text).join('');
const button=(f,label)=>{const b=walk(f.root).find(n=>n.type==='button'&&(n.props['aria-label']===label||text(n)===label));assert.ok(b,'缺少按钮：'+label);return b;};
const settle=async()=>{for(let i=0;i<8;i++){await Promise.resolve();await Vue.nextTick();}};
const row={id:'fixture',name:'合成供应商',baseUrl:'https://example.invalid/v1',protocol:'openai-completions',enabled:true,declared:false,sortOrder:0,transport:'direct',keyConfigured:true,models:[{id:'original',name:'原模型',contextWindow:'',maxTokens:'',image:false}]};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const mount=adapter=>{const root=node('root'),app=renderer.createApp({render:()=>Vue.h(Page,{adapter})});app.mount(root);return{root,unmount:()=>app.unmount()};};
function fixture(){
  const pending=deferred(),queries=[],cancels=[],pulls=[];let result,revision=5,readFailure=false;
  const api={modelsDescribe:async()=>{if(readFailure)throw Error('fixture-directory-failed');return{providers:[row],revision,writable:true};},modelsCatalog:async()=>[],
    modelPull:async(...args)=>{pulls.push(args);return pending.promise;},
    modelPullDescribe:async id=>{queries.push(id);if(result instanceof Error)throw result;return result;},
    modelPullCancel:async id=>{cancels.push(id);return{operationId:id,providerId:row.id,status:'cancelled',settled:false,cancelRequested:true,error:'model-pull-cancelled'};}};
  const adapter=createModelCenterAdapters(api)['provider-settings'];
  return{adapter,pending,pulls,queries,cancels,setResult:value=>{result=value;},setRevision:value=>{revision=value;},failDirectory:value=>{readFailure=value;}};
}

test('页面未知态不随目录刷新消失；页签重挂载保留ID，查询结果后才放开拉取',async()=>{
  const f=fixture();let ui=mount(f.adapter);await settle();
  button(ui,'拉取 合成供应商 模型目录').props.onClick();await settle();
  assert.equal(f.pulls.length,1);const id=f.pulls[0][2];assert.match(text(ui.root),new RegExp(id));
  assert.ok(button(ui,'拉取 合成供应商 模型目录').props.disabled);
  assert.equal(button(ui,'取消当前模型拉取').props.disabled,false);
  f.pending.resolve({pullOperation:{operationId:id,providerId:row.id,status:'unknown',settled:false,error:'model-pull-timeout-unknown'}});await settle();
  assert.match(text(ui.root),/结果未知/);assert.doesNotMatch(text(ui.root),/已拉取模型目录/);
  button(ui,'刷新供应商目录').props.onClick();await settle();assert.match(text(ui.root),/结果未知/);
  ui.unmount();ui=mount(f.adapter);await settle();assert.match(text(ui.root),new RegExp(id));
  assert.ok(button(ui,'拉取 合成供应商 模型目录').props.disabled);
  f.setResult({operationId:id,providerId:row.id,status:'succeeded',settled:true,error:''});
  button(ui,'查询当前模型拉取结果').props.onClick();await settle();
  assert.deepEqual(f.queries,[id]);assert.equal(f.pulls.length,1);
  assert.match(text(ui.root),/已拉取成功；后台已收束/);
  assert.equal(button(ui,'拉取 合成供应商 模型目录').props.disabled,false);ui.unmount();
});

test('页面取消不等同收束，迟到初始回执不能倒退状态',async()=>{
  const f=fixture(),ui=mount(f.adapter);await settle();button(ui,'拉取 合成供应商 模型目录').props.onClick();await settle();
  const id=f.pulls[0][2];button(ui,'取消当前模型拉取').props.onClick();await settle();
  assert.deepEqual(f.cancels,[id]);assert.match(text(ui.root),/后台尚未确认收束/);assert.match(text(ui.root),/已请求取消/);
  assert.ok(button(ui,'拉取 合成供应商 模型目录').props.disabled);
  f.pending.resolve({pullOperation:{operationId:id,providerId:row.id,status:'running',settled:false}});await settle();
  assert.match(text(ui.root),/模型拉取已取消/);
  f.setResult({operationId:id,providerId:row.id,status:'cancelled',settled:true,error:'model-pull-cancelled'});
  button(ui,'查询当前模型拉取结果').props.onClick();await settle();
  assert.equal(button(ui,'拉取 合成供应商 模型目录').props.disabled,false);ui.unmount();
});

test('查询失联或Host重启未知仍禁止重复；不按更新的目录解锁',async()=>{
  const f=fixture(),ui=mount(f.adapter);await settle();button(ui,'拉取 合成供应商 模型目录').props.onClick();await settle();
  const id=f.pulls[0][2];f.pending.reject(Error('host-gone'));await settle();
  f.setResult(Error('query-failed'));button(ui,'查询当前模型拉取结果').props.onClick();await settle();
  assert.match(text(ui.root),/结果未知/);assert.ok(button(ui,'拉取 合成供应商 模型目录').props.disabled);
  f.setResult({operationId:id,status:'unknown',settled:false,error:'model-pull-operation-unknown'});
  button(ui,'查询当前模型拉取结果').props.onClick();await settle();
  assert.match(text(ui.root),/当前宿主没有该操作记录/);assert.equal(f.pulls.length,1);ui.unmount();
});

test('HTTP失败的关联回执显示可读原因；已结束后可发起新操作',async()=>{
  const f=fixture(),ui=mount(f.adapter);await settle();button(ui,'拉取 合成供应商 模型目录').props.onClick();await settle();
  const id=f.pulls[0][2];f.pending.resolve({pullOperation:{operationId:id,providerId:row.id,status:'failed',settled:true,error:'http-status:401'}});await settle();
  assert.match(text(ui.root),/拉取失败；请检查供应商密钥；后台已收束/);
  assert.equal(button(ui,'拉取 合成供应商 模型目录').props.disabled,false);ui.unmount();
});

test('未知提示持续保留：目录涨修订/读失败恢复/重复点击都不能替代精确操作回执',async()=>{
  const f=fixture(),ui=mount(f.adapter);await settle();button(ui,'拉取 合成供应商 模型目录').props.onClick();await settle();
  const id=f.pulls[0][2];f.pending.reject(Error('host-gone'));await settle();
  const label='拉取 合成供应商 模型目录';
  assert.equal(text(button(ui,label)),'结果待核对');
  assert.match(text(ui.root),/刷新供应商目录只读取当前配置，不能证明这次拉取成功/);
  f.setRevision(200);button(ui,'刷新供应商目录').props.onClick();await settle();
  assert.match(text(ui.root),/结果未知/);assert.ok(button(ui,label).props.disabled);
  // 连处理器都直接调用，仍须由状态门拒绝，不能只靠DOM disabled。
  for(let i=0;i<3;i++)button(ui,label).props.onClick();await settle();assert.equal(f.pulls.length,1);
  f.failDirectory(true);button(ui,'刷新供应商目录').props.onClick();await settle();
  assert.match(text(ui.root),/结果未知/);assert.match(text(ui.root),/fixture-directory-failed/);
  f.failDirectory(false);button(ui,'刷新供应商目录').props.onClick();await settle();
  f.setResult(Error('query-lost'));button(ui,'查询当前模型拉取结果').props.onClick();await settle();
  assert.match(text(ui.root),/本次核对未取得有效回执/);assert.ok(button(ui,label).props.disabled);
  assert.equal(f.queries[0],id);ui.unmount();
});

test('提交结果未知但已收束仍保留警示，查询失联不抹掉已收束事实',async()=>{
  const f=fixture(),ui=mount(f.adapter);await settle();button(ui,'拉取 合成供应商 模型目录').props.onClick();await settle();
  const id=f.pulls[0][2];f.pending.resolve({pullOperation:{operationId:id,providerId:row.id,status:'outcome-unknown',settled:true,error:'model-pull-outcome-unknown'}});await settle();
  assert.match(text(ui.root),/提交结果未知.*后台已收束/);assert.equal(text(button(ui,'拉取 合成供应商 模型目录')),'结果待核对');
  f.setResult(Error('query-failed'));button(ui,'查询当前模型拉取结果').props.onClick();await settle();
  assert.match(text(ui.root),/提交结果未知.*后台已收束/);assert.match(text(ui.root),/本次核对未取得有效回执/);
  assert.ok(button(ui,'拉取 合成供应商 模型目录').props.disabled);ui.unmount();
});

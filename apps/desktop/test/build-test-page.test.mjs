import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const watches=[];
const vue={
  defineComponent:value=>value,
  h:(type,props,children)=>({type,props:props||{},children}),
  ref:value=>({value}),
  watch:(source,callback,options)=>{watches.push({source,callback});if(options?.immediate)callback(source());},
  onBeforeUnmount:()=>{},
};
const plugin={name:'build-test-page-vue',setup(build){
  build.onResolve({filter:/^vue$/},()=>({path:'vue',namespace:'build-test-vue'}));
  build.onLoad({filter:/^vue$/,namespace:'build-test-vue'},()=>({contents:'module.exports=globalThis.__vue;',loader:'js'}));
}};
const bundle=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/build-test-page.ts',import.meta.url))],bundle:true,write:false,format:'cjs',plugins:[plugin]});
let uuid=0;
const context={module:{exports:{}},globalThis:{__vue:vue,crypto:{randomUUID:()=>`test-id-${++uuid}`}}};
vm.runInNewContext(bundle.outputFiles[0].text,context);
const {BuildTestPage}=context.module.exports;

function find(node,predicate){
  if(Array.isArray(node)){for(const child of node){const hit=find(child,predicate);if(hit)return hit;}return null;}
  if(!node||typeof node!=='object')return null;
  if(predicate(node))return node;
  return find(node.children,predicate);
}
function textContent(node){
  if(Array.isArray(node))return node.map(textContent).join('');
  if(!node||typeof node!=='object')return String(node||'');
  return textContent(node.children);
}
const button=(tree,label)=>find(tree,node=>node.type==='button'&&textContent(node)===label);

test('默认不建提案；模板预览需要二次明确操作，隐藏后恢复不会重放',async()=>{
  watches.length=0;
  const calls=[];const props={active:true,sessionId:'s1',api:{executionPropose:()=>calls.push('propose')}};
  const render=BuildTestPage.setup(props,{emit:()=>{}});
  let tree=render();
  assert.ok(find(tree,node=>node.type?.name==='SaCodeExecutionTask')===null);
  assert.equal(calls.length,0);
  const card=find(tree,node=>node.type==='article'&&textContent(node).includes('运行仓颉测试'));
  assert.ok(card);
  await button(card,'选择任务').props.onClick();
  tree=render();
  const preview=find(tree,node=>node.type==='pre');
  assert.deepEqual(JSON.parse(textContent(preview)).argv,['test','--no-color','--no-progress']);
  assert.ok(button(tree,'创建持久执行提案'));
  assert.equal(find(tree,node=>node.type?.name==='SaCodeExecutionTask'),null);
  assert.equal(calls.length,0);
  const activeWatch=watches.find(item=>typeof item.source()==='boolean');
  assert.ok(activeWatch);
  props.active=false;activeWatch.callback(false,true);
  props.active=true;activeWatch.callback(true,false);
  tree=render();
  assert.ok(button(tree,'选择任务'));
  assert.equal(find(tree,node=>node.type?.name==='SaCodeExecutionTask'),null);
  assert.equal(calls.length,0);
});

test('用户确认创建后走执行任务提案；页面不自动审批或启动',async()=>{
  watches.length=0;
  const calls={propose:[],authorize:0,start:0};
  const props={active:true,sessionId:'s1',api:{
    workspaceGet:async()=>({sessionId:'s1',directory:'D:/workspace',revision:4,available:true,configured:true}),
    executionPropose:async(sessionId,taskId,requestId,proposal)=>{
      calls.propose.push({sessionId,taskId,requestId,proposal});
      return{sessionId,executionId:'execution-1',taskId,requestId,proposal,proposalDigest:'a'.repeat(64),revision:1,phase:'awaiting-approval',result:'',providerAvailable:false,providerReason:'platform-sandbox-unavailable',approvalArguments:'bound'};
    },
    executionDescribe:async()=>{},executionAuthorize:async()=>{calls.authorize++;},executionStart:async()=>{calls.start++;},
    executionStop:async()=>{},executionOutput:async()=>{},approvalAsk:async()=>({approvalId:1}),approvalAnswer:async()=>({accepted:true}),
  }};
  const render=BuildTestPage.setup(props,{emit:()=>{}});
  let tree=render();
  const card=find(tree,node=>node.type==='article'&&textContent(node).includes('运行仓颉测试'));
  await button(card,'选择任务').props.onClick();
  tree=render();
  await button(tree,'创建持久执行提案').props.onClick();
  tree=render();
  const child=find(tree,node=>node.type?.name==='SaCodeExecutionTask');
  assert.ok(child);
  const childRender=child.type.setup(child.props,{emit:()=>{}});
  await new Promise(resolve=>setImmediate(resolve));
  const taskTree=childRender();
  assert.equal(calls.propose.length,1);
  const proposal=JSON.parse(calls.propose[0].proposal);
  assert.equal(proposal.executable,'cjpm');
  assert.deepEqual(Array.from(proposal.argv),['test','--no-color','--no-progress']);
  assert.equal(proposal.workspaceRevision,4);
  assert.equal(calls.authorize,0);
  assert.equal(calls.start,0);
  assert.match(textContent(taskTree),/执行隔离后端/);
  const start=button(taskTree,'启动');
  assert.ok(start?.props.disabled);
  assert.equal(calls.start,0);
});

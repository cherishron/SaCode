import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const vue={defineComponent:value=>value,h:(type,props,children)=>({type,props:props||{},children}),ref:value=>({value}),watch:(source,callback,options)=>{if(options?.immediate)callback();},onBeforeUnmount:()=>{}};
const plugin={name:'test-vue-runtime',setup(build){build.onResolve({filter:/^vue$/},()=>({path:'vue',namespace:'vue-test'}));build.onLoad({filter:/^vue$/,namespace:'vue-test'},()=>({contents:'module.exports=globalThis.__testVue;',loader:'js'}));}};
const bundle=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/execution-task.ts',import.meta.url))],bundle:true,write:false,format:'cjs',plugins:[plugin]});
const ctx={module:{exports:{}},globalThis:{__testVue:vue,crypto:{randomUUID:()=> 'generated-id'}}};
vm.runInNewContext(bundle.outputFiles[0].text,ctx);
const {ExecutionTask}=ctx.module.exports;
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
test('私有快照审批显示原目录、执行目录、排除和摘要，渲染不启动任务',async()=>{
 const calls=[];
 let current;
 const api={workspaceGet:async()=>({sessionId:'s1',available:true,configured:true,directory:'D:/private',revision:3}),
 executionPropose:async(sessionId,taskId,requestId,proposal)=>{
  const receipt={version:1,sessionId,taskId,requestId,executionId:'execution-1',proposalDigest:'a'.repeat(64),workspaceRevision:3,sourceDirectory:'D:/original',executionDirectory:'D:/private',manifestDigest:'b'.repeat(64),entryCount:5,byteCount:123,excluded:['.git','src/target'],toolBinding:JSON.stringify({version:1,requested:'tool',executable:'D:/Tools/tool.exe',sha256:'c'.repeat(64)})};
  return current={sessionId,taskId,requestId,executionId:'execution-1',proposal,proposalDigest:'a'.repeat(64),revision:1,phase:'awaiting-approval',result:'',providerAvailable:false,providerReason:'sandbox-probe-failed',approvalArguments:'exact-snapshot-bound',workspaceSnapshot:JSON.stringify(receipt)};
 },executionDescribe:async()=>current,executionStart:async()=>{calls.push('start');return current;},approvalAsk:async()=>{calls.push('approve');return{approvalId:1};}};
 const render=ExecutionTask.setup({active:true,sessionId:'s1',api,preset:{id:'private-1',title:'私有任务',executable:'tool',argv:[]},showTestReport:false},{emit:()=>{}});
 await new Promise(resolve=>setImmediate(resolve));
 const tree=render(),section=find(tree,n=>n.props?.['aria-label']==='私有工作区快照');
 assert.ok(section);const text=textContent(section);
 for(const expected of ['D:/original','D:/private','b'.repeat(64),'5 项','123 字节','.git','src/target','另行授权','D:/Tools/tool.exe','c'.repeat(64)])assert.ok(text.includes(expected),expected);
 assert.deepEqual(calls,[]);
});

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
test('Git 固定提案只创建持久任务；审批与启动仍由用户分别触发',async()=>{
 const calls={propose:[],authorize:0,start:0};
 let current={sessionId:'s1',executionId:'execution-1',taskId:'task-git-1',requestId:'request-git-1',proposal:'',proposalDigest:'a'.repeat(64),revision:1,phase:'awaiting-approval',result:'',providerAvailable:true,approvalArguments:'bound-proposal'};
 const api={
  workspaceGet:async()=>({sessionId:'s1',available:true,configured:true,directory:'D:/fixture',revision:9}),
  executionPropose:async(sessionId,taskId,requestId,proposal)=>{calls.propose.push({sessionId,taskId,requestId,proposal});current={...current,sessionId,taskId,requestId,proposal};return current;},
  executionDescribe:async()=>current,
  executionAuthorize:async()=>{calls.authorize++;current={...current,revision:2,phase:'admitted'};return current;},
  executionStart:async()=>{calls.start++;current={...current,revision:3,phase:'running'};return current;},
  executionStop:async()=>current,
  executionOutput:async()=>({sessionId:'s1',executionId:'execution-1',records:[],nextCursor:0,hasMore:false}),
  approvalAsk:async(name,args)=>{assert.equal(name,'execution/start');assert.equal(args,'bound-proposal');return{approvalId:17};},
  approvalAnswer:async(id,decision)=>({accepted:id===17&&decision==='allowed-once'}),
 };
 const preset={id:'git-action-1',title:'暂存所选文件',summary:'测试操作',executable:'git',argv:['add','--all','--',':(literal)file.txt'],timeoutMs:120000,outputLimit:16384};
 const render=ExecutionTask.setup({active:true,sessionId:'s1',api,preset,showTestReport:false},{emit:()=>{}});
 await new Promise(resolve=>setImmediate(resolve));
 let tree=render();
 assert.equal(calls.propose.length,1);
 assert.equal(calls.propose[0].sessionId,'s1');
 assert.equal(calls.propose[0].taskId,'task-git-action-1');
 assert.equal(JSON.parse(calls.propose[0].proposal).executable,'git');
 assert.deepEqual(Array.from(JSON.parse(calls.propose[0].proposal).argv),preset.argv);
 assert.equal(find(tree,node=>textContent(node)==='可执行程序'),null);
 assert.equal(calls.authorize,0);
 assert.equal(calls.start,0);
 const approve=find(tree,node=>node.type==='button'&&textContent(node)==='批准此提案一次');
 assert.ok(approve);
 await approve.props.onClick();
 assert.equal(calls.authorize,1);
 assert.equal(calls.start,0);
 tree=render();
 const start=find(tree,node=>node.type==='button'&&textContent(node)==='启动');
 assert.ok(start);
 await start.props.onClick();
 assert.equal(calls.start,1);
});
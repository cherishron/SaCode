import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const vue={defineComponent:value=>value,h:(type,props,children)=>({type,props:props||{},children}),ref:value=>({value}),watch:(source,callback,options)=>{if(options?.immediate)callback();},onBeforeUnmount:()=>{}};
const plugin={name:'test-vue-runtime',setup(build){build.onResolve({filter:/^vue$/},()=>({path:'vue',namespace:'vue-test'}));build.onLoad({filter:/^vue$/,namespace:'vue-test'},()=>({contents:'module.exports=globalThis.__testVue;',loader:'js'}));}};
const bundle=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/task-review.ts',import.meta.url))],bundle:true,write:false,format:'cjs',plugins:[plugin]});
const ctx={module:{exports:{}},globalThis:{__testVue:vue,crypto:{randomUUID:()=> 'generated-id'}}};
vm.runInNewContext(bundle.outputFiles[0].text,ctx);
const {TaskReview}=ctx.module.exports;
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

test('差异审查消费持久任务清单，不启动任务、不改文件',async()=>{
 const proposal=JSON.stringify({cwd:'D:/private',workspaceRevision:1});
 const workspaceSnapshot=JSON.stringify({version:1,executionId:'execution-1',sessionId:'s1',taskId:'t',requestId:'r',proposalDigest:'a'.repeat(64),workspaceRevision:1,sourceDirectory:'D:/original',executionDirectory:'D:/private',manifestDigest:'b'.repeat(64),entryCount:1,byteCount:3,excluded:[]});
 const review={version:1,executionId:'execution-1',sessionId:'s1',taskId:'t',requestId:'r',executionRevision:4,proposalDigest:'a'.repeat(64),manifestDigest:'b'.repeat(64),sourceDirectory:'D:/original',files:[{path:'src/a.txt',kind:'modified',beforeDigest:'c'.repeat(64),afterDigest:'d'.repeat(64),beforeObject:'sha256:'+'c'.repeat(64),afterObject:'sha256:'+'d'.repeat(64)}]};
 const calls=[];
 const render=TaskReview.setup({sessionId:'s1',active:true,describe:async(...args)=>{calls.push(args);return{sessionId:'s1',executionId:'execution-1',taskId:'t',requestId:'r',proposal,proposalDigest:'a'.repeat(64),revision:4,phase:'exited',result:'{}',providerAvailable:false,providerReason:'sandbox-probe-failed',workspaceSnapshot,review:JSON.stringify(review)};}});
 let tree=render();find(tree,n=>n.type==='input').props.onInput({target:{value:'execution-1'}});tree=render();await find(tree,n=>n.type==='button').props.onClick();
 const text=textContent(render());for(const expected of ['D:/original','src/a.txt','修改前','修改后','写回接口尚未提供'])assert.ok(text.includes(expected),expected);
 assert.deepEqual(calls,[['s1','execution-1']]);
 review.files[0].afterObject='sha256:'+'e'.repeat(64);
 await find(render(),n=>n.type==='button').props.onClick();
 assert.match(textContent(render()),/任务差异对象无效/);
});

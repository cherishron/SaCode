import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const compiled=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/knowledge-page.ts',import.meta.url))],bundle:true,write:false,format:'cjs',external:['vue']});
const tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function fixture(api){const unmounts=[],events=[];const vue={defineComponent:x=>x,ref:value=>({value}),h:(type,props,children)=>({type,props:props||{},children}),watch:(_source,fn,opts)=>{if(opts?.immediate)fn();},onBeforeUnmount:fn=>unmounts.push(fn)};const ctx={module:{exports:{}},require:()=>vue,crypto:{randomUUID:()=> 'new-id'},globalThis:{confirm:()=>true}};vm.runInNewContext(compiled.outputFiles[0].text,ctx);const render=ctx.module.exports.KnowledgePage.setup({api,sessionId:'s1',directory:'D:/project'},{emit:(...args)=>events.push(args)});return{render,unmounts,events};}
function nodes(node){if(!node||typeof node!=='object')return [];return[node,...(Array.isArray(node.children)?node.children.flatMap(nodes):[])];}
function button(f,text){return nodes(f.render()).find(n=>n.type==='button'&&n.children===text);}
const snapshot=(docs=[],revision=0)=>({scope:'user',workspace:'',revision,documents:docs});
test('知识页读取真实清单，失败不伪装为空库',async()=>{const f=fixture({knowledgeList:async()=>{throw Error('storage-offline');}});await tick();assert.match(JSON.stringify(f.render()),/storage-offline/);assert.doesNotMatch(JSON.stringify(f.render()),/还没有知识文档/);});
test('保存冲突保留草稿，双击只发一次',async()=>{let reject,calls=0;const f=fixture({knowledgeList:async()=>snapshot(),knowledgeSave:()=>{calls++;return new Promise((_r,j)=>reject=j);}});await tick();button(f,'添加文档').props.onClick();let input=nodes(f.render()).find(n=>n.props['aria-label']==='文档标题');input.props.onInput({target:{value:'我的知识'}});button(f,'保存文档').props.onClick();button(f,'保存文档').props.onClick();assert.equal(calls,1);reject(Error('knowledge-revision-conflict'));await tick();assert.match(JSON.stringify(f.render()),/我的知识/);assert.match(JSON.stringify(f.render()),/草稿已保留/);});
test('引用必须重新读取有效修订，卸载后不注入迟到正文',async()=>{let resolve;const doc={id:'d',title:'知识',content:'正文',revision:1};const f=fixture({knowledgeList:async()=>snapshot([doc],1),knowledgeReference:()=>new Promise(r=>resolve=r)});await tick();button(f,'引用到输入框').props.onClick();f.unmounts[0]();resolve({...snapshot([],1),document:doc});await tick();assert.equal(f.events.length,0);});
test('过期文件来源不能引用',async()=>{const f=fixture({knowledgeList:async()=>snapshot([{id:'d',title:'知识',content:'旧正文',revision:1,sourceKind:'file',sourcePath:'src/app.cj',sourceStatus:'stale'}],1)});await tick();assert.equal(button(f,'引用到输入框').props.disabled,true);assert.match(JSON.stringify(f.render()),/来源已变化/);});

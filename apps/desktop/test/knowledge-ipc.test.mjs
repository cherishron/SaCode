import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const {registerKnowledgeIpc}=require('../knowledge-ipc.cjs');
test('知识接口限制作用域、字段与修订，不接受任意文件路径',async()=>{
 const handlers=new Map(),calls=[];registerKnowledgeIpc({handle:(k,f)=>handlers.set(k,f)},async(...args)=>{calls.push(args);return {revision:1};});
 const invoke=(name,args)=>handlers.get('sacode:knowledge'+name)(null,args);
 await invoke('Save',{sessionId:'s1',scope:'project',id:'one',title:'标题',content:'正文',revision:0});
 assert.equal(calls[0][0],'knowledge/save');
 assert.throws(()=>invoke('List',{sessionId:'s1',scope:'other',query:''}),/scope/);
 assert.throws(()=>invoke('List',{sessionId:'s1',scope:'user',query:'',path:'C:/secret'}),/args/);
 assert.throws(()=>invoke('Save',{sessionId:'s1',scope:'user',id:'one',title:'t',content:'c',revision:-1}),/document/);
 assert.equal(calls.length,1);
});
test('知识预加载暴露有限动作，路径仅用于项目导入',()=>{
 let api;const calls=[];vm.runInNewContext(readFileSync(new URL('../preload.cjs',import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_,v)=>api=v},ipcRenderer:{invoke:(...args)=>calls.push(args),on(){},removeListener(){}}})});
 api.knowledgeList('s1','user','关键字');api.knowledgeSave('s1','project','one','t','c',0);api.knowledgeRemove('s1','project','one',1);
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['sacode:knowledgeList',{sessionId:'s1',scope:'user',query:'关键字'}],['sacode:knowledgeSave',{sessionId:'s1',scope:'project',id:'one',title:'t',content:'c',revision:0}],['sacode:knowledgeRemove',{sessionId:'s1',scope:'project',id:'one',title:'',content:'',revision:1}]]);
 api.knowledgeImport('s1','project','two','来源','docs/guide.md',2);api.knowledgeReference('s1','project','two',3);assert.equal(calls[3][0],'sacode:knowledgeImport');assert.equal(calls[4][0],'sacode:knowledgeReference');
});

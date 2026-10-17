import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {registerAutomationIpc} from '../automation-ipc.cjs';

function fixture(){const handlers=new Map(),calls=[];registerAutomationIpc({handle:(name,handler)=>handlers.set(name,handler)},async(method,args)=>{calls.push({method,args});return{ok:true};});return{handlers,calls,invoke:(name,args)=>handlers.get('sacode:automation'+name)({},args)};}
const definition={id:'job-1',title:'检查任务',prompt:'核对变更',cron:'0 9 * * 1-5',workspace:'D:/repo',modelId:'model-1',timezone:'Asia/Shanghai',permission:'build',enabled:true};

test('自动化 IPC 只映射固定 list/save/control 动词和精确参数',async()=>{
 const f=fixture();await f.invoke('List',{sessionId:'session-1',scope:'user'});await f.invoke('Save',{sessionId:'session-1',scope:'project',definition,revision:4});await f.invoke('Control',{sessionId:'session-1',scope:'user',id:'job-1',action:'pause',revision:5});
 assert.deepEqual(f.calls.map(call=>call.method),['automation/list','automation/save','automation/control']);assert.equal(f.calls[1].args.definition.id,'job-1');assert.equal(f.calls[2].args.revision,5);
});

test('自动化 IPC 拒绝额外字段、陈旧修订和未知控制动作',async()=>{
 const f=fixture();
 await assert.rejects(async()=>f.invoke('List',{sessionId:'s',scope:'user',path:'D:/'}),/automation-bad-args/);
 await assert.rejects(async()=>f.invoke('Save',{sessionId:'s',scope:'user',definition,revision:-1}),/automation-bad-revision/);
 await assert.rejects(async()=>f.invoke('Control',{sessionId:'s',scope:'project',id:'job-1',action:'run',revision:0}),/automation-bad-action/);
 await assert.rejects(async()=>f.invoke('Save',{sessionId:'s',scope:'user',definition:{...definition,extra:true},revision:0}),/automation-bad-definition/);
 assert.equal(f.calls.length,0);
});

test('预加载层把页面三种操作映射到固定 IPC 通道',async()=>{
 const invocations=[],exposed={};const source=readFileSync(fileURLToPath(new URL('../preload.cjs',import.meta.url)),'utf8');
 vm.runInNewContext(source,{require:()=>({contextBridge:{exposeInMainWorld:(name,api)=>{exposed[name]=api;}},ipcRenderer:{invoke:(...args)=>{invocations.push(args);return Promise.resolve({ok:true});}}})});
 await exposed.sacode.automationList('s1','user');await exposed.sacode.automationSave('s1','project',definition,4);await exposed.sacode.automationControl('s1','user','job-1','pause',5);
 assert.deepEqual(JSON.parse(JSON.stringify(invocations)),[
  ['sacode:automationList',{sessionId:'s1',scope:'user'}],
  ['sacode:automationSave',{sessionId:'s1',scope:'project',definition,revision:4}],
  ['sacode:automationControl',{sessionId:'s1',scope:'user',id:'job-1',action:'pause',revision:5}],
 ]);
});

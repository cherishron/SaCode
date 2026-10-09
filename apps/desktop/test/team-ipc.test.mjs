import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);

test('预加载团队通道保留精确字段且不开放通用请求',async()=>{
  let api;const calls=[];
  vm.runInNewContext(readFileSync(new URL('../preload.cjs',import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>api=value},ipcRenderer:{invoke:(method,args)=>{calls.push({method,args});}}})});
  await api.teamMessageSend('current','worker','中文');
  await api.teamTaskCreate('current','任务',['task-1']);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{method:'sacode:teamMessageSend',args:{teamSessionId:'current',target:'worker',text:'中文'}},{method:'sacode:teamTaskCreate',args:{teamSessionId:'current',title:'任务',dependencies:['task-1']}}]);
  assert.equal(api.request,undefined);
  assert.equal(Object.keys(api).filter(key=>key.startsWith('team')).length,10);
});

test('团队 IPC 固定动作转发，身份不可由渲染层自报',async()=>{
  const {registerTeamIpc}=require('../team-ipc.cjs');
  const handlers=new Map(),calls=[];
  registerTeamIpc({handle:(name,fn)=>handlers.set(name,fn)},async(method,args)=>{calls.push({method,args});return {accepted:true};});
  assert.equal(handlers.size,10);
  const send=handlers.get('sacode:teamMessageSend');
  const args={teamSessionId:'current',target:'worker',text:'中文::你好'};
  assert.deepEqual(await send(null,args),{accepted:true});
  assert.deepEqual(calls,[{method:'team/message/send',args}]);
  for(const extra of ['actorSessionId','sender','approvalId'])await assert.rejects(()=>send(null,{...args,[extra]:'leader'}),/bad-team-arguments/);
  assert.equal(calls.length,1);
});

test('团队 IPC 拒绝畸形依赖及无效身份，输入校验失败不得派发',async()=>{
  const {registerTeamIpc}=require('../team-ipc.cjs');
  const handlers=new Map();let calls=0;
  registerTeamIpc({handle:(name,fn)=>handlers.set(name,fn)},async()=>{calls++;return {};});
  const create=handlers.get('sacode:teamTaskCreate');
  const args={teamSessionId:'current',title:'任务',dependencies:['task-1']};
  for(const bad of [{...args,dependencies:'task-1'},{...args,dependencies:[null]},{...args,title:' '},{...args,teamSessionId:'../session'},{...args,extra:true},null])await assert.rejects(()=>create(null,bad),/bad-team-arguments/);
  assert.equal(calls,0);
  await create(null,args);assert.equal(calls,1);
});

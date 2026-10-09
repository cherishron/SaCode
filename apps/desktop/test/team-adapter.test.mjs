import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

test('团队投影适配只映射权威状态，不把任务认领当作完成',()=>{
  const {teamPanelSnapshot}=require('../team-adapter.cjs');
  const source={members:[{id:'a',role:'worker',sessionId:'sessions/session-a',active:true}],tasks:[{id:'t',title:'任务',owner:'a',assignedTo:'a',phase:'in_progress',dependencies:[],result:''}],messages:[{id:'m',sender:'a',recipient:'b',text:'中文',delivered:false}]};
  const result=teamPanelSnapshot(source,{a:'running'});
  assert.equal(result.members[0].status,'running');
  assert.equal(result.tasks[0].status,'running');
  assert.equal(result.tasks[0].owner,'a');
  assert.equal(result.messages[0].status,'pending');
  assert.equal(result.messages[0].target,'b');
  assert.equal(source.tasks[0].phase,'in_progress');
});

test('团队投影成员历史恢复为闲置，未知任务态不能冒充成功',()=>{
  const {teamPanelSnapshot}=require('../team-adapter.cjs');
  const result=teamPanelSnapshot({members:[{id:'a',role:'worker',sessionId:'s',active:true},{id:'b',role:'worker',sessionId:'b',active:false}],tasks:[{id:'t',title:'任务',phase:'unexpected',dependencies:[]}],messages:[]});
  assert.equal(result.members[0].status,'idle');
  assert.equal(result.members[1].status,'stopped');
  assert.equal(result.tasks[0].status,'unexpected');
});

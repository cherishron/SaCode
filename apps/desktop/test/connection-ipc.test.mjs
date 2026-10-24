import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const definition={id:'db-local',title:'本地只读库',kind:'database',enabled:false,spec:{engine:'postgresql',host:'localhost',port:5432,database:'demo',user:'tester',credentialRef:'DB_TEST_PASSWORD',tlsMode:'verify-full'}};
function fixture(){
  const calls=[];let api;
  vm.runInNewContext(readFileSync(new URL('../preload.cjs',import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>{api=value;}},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve({});}}})});
  return {api,calls};
}

test('连接预加载仅提供固定配置动作，不把保存配置变为启动连接',async()=>{
  const {api,calls}=fixture();
  assert.equal(typeof api.connectionList,'function');
  await api.connectionList({sessionId:'s1',scope:'user'});
  await api.connectionSave({sessionId:'s1',scope:'project',revision:0,definition});
  await api.connectionControl({sessionId:'s1',scope:'project',revision:1,id:'db-local',action:'enable'});
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[
    ['sacode:connectionList',{sessionId:'s1',scope:'user'}],
    ['sacode:connectionSave',{sessionId:'s1',scope:'project',revision:0,definition}],
    ['sacode:connectionControl',{sessionId:'s1',scope:'project',revision:1,id:'db-local',action:'enable'}],
  ]);
});

test('连接预加载拒绝密码、任意路径、未知动作和非整数修订',async()=>{
  const {api,calls}=fixture();
  assert.equal(typeof api.connectionSave,'function');
  for(const request of [
    {sessionId:'s1',scope:'user',revision:0,definition:{...definition,spec:{...definition.spec,password:'invalid-test-secret'}}},
    {sessionId:'s1',scope:'user',revision:0.5,definition},
    {sessionId:'s1',scope:'user',revision:0,definition,path:'D:/outside'},
  ])await assert.rejects(async()=>api.connectionSave(request));
  await assert.rejects(async()=>api.connectionControl({sessionId:'s1',scope:'user',revision:0,id:'db-local',action:'exec'}));
  assert.equal(calls.length,0);
});

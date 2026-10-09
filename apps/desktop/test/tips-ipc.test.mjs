import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('Tips preload 仅暴露读取、启动、回复和隐藏固定动作',async()=>{
  let api;const calls=[];
  vm.runInNewContext(readFileSync(new URL('../preload.cjs',import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_,v)=>{api=v;}},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve();}}})});
  await api.tipsGet();await api.tipsStartup();await api.tipsAfterReply();await api.tipsSetHidden(true);
  assert.deepEqual(calls.map(c=>c[0]),['sacode:tipsGet','sacode:tipsStartup','sacode:tipsAfterReply','sacode:tipsSetHidden']);
  assert.equal(JSON.stringify(calls[3][1]),'{"hidden":true}');
  assert.equal(calls[2].length,1);
  assert.equal(api.request,undefined);
});

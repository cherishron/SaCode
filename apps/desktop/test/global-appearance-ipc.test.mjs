import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
test('全局外观 preload 仅发送固定动作和字号字段',async()=>{
  let api;const calls=[];
  vm.runInNewContext(readFileSync(new URL('../preload.cjs',import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>{api=value;}},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve();}}})});
  await api.globalAppearanceGet();await api.globalAppearanceSetFontSize(18);
  await api.globalAppearanceSetTheme('dark');
  assert.equal(calls[0][0],'dsh:globalAppearanceGet');assert.equal(calls[0].length,1);
  assert.equal(calls[1][0],'dsh:globalAppearanceSetFontSize');
  assert.equal(JSON.stringify(calls[1][1]),'{"fontSize":18}');
  assert.equal(calls[2][0],'dsh:globalAppearanceSetTheme');
  assert.equal(JSON.stringify(calls[2][1]),'{"theme":"dark"}');
  assert.equal('request' in api,false);
});

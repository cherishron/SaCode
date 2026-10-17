import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const {registerAcpIpc}=createRequire(import.meta.url)('../../acp-ipc.cjs');
test('CodeBuddy控制保留提供方身份，旧OpenCode调用兼容且拒绝任意程序',async()=>{
 const handlers=new Map(),calls=[];registerAcpIpc({handle:(key,value)=>handlers.set(key,value)},async(...args)=>calls.push(args));
 const invoke=(name,args)=>handlers.get('sacode:'+name)({},args);
 await invoke('acpProviderProbe',{sessionId:'s',peerId:'codebuddy'});
 await invoke('acpSettingsDescribe',{sessionId:'s',peerId:'opencode'});
 await invoke('acpSettingsSetEnabled',{sessionId:'s',peerId:'codebuddy',enabled:true,revision:0});
 assert.deepEqual(calls,[['acp/provider/probe',{sessionId:'s',peerId:'codebuddy'}],['acp/settings/describe',{sessionId:'s'}],['acp/settings/set-enabled',{sessionId:'s',enabled:true,revision:0,peerId:'codebuddy'}]]);
 calls.length=0;
 for(const args of [{sessionId:'s',peerId:'shell'},{sessionId:'s',peerId:'codebuddy',executable:'cmd'},{sessionId:'s',peerId:undefined}])await assert.rejects(invoke('acpProviderProbe',args),/bad-acp/);
 await assert.rejects(invoke('acpDelegationList',{sessionId:'s',peerId:'codebuddy'}),/bad-acp/);
 assert.equal(calls.length,0);
});
test('预加载CodeBuddy选项只扩展现有有限控制通道，不暴露任意转发',()=>{
 let api;const calls=[];vm.runInNewContext(readFileSync(new URL('../../preload.cjs',import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>api=value},ipcRenderer:{invoke:(...args)=>calls.push(args),on(){},removeListener(){}}})});
 api.acpProviderProbe('s','codebuddy');api.acpDiagnosticsKeep('s','acp-'+'a'.repeat(32),1,'codebuddy');
 assert.equal(calls[0][1].peerId,'codebuddy');assert.equal(calls[1][1].peerId,'codebuddy');assert.equal(api.request,undefined);
});

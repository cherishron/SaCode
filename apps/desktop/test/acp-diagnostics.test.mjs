import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const result=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/acp-diagnostics.ts',import.meta.url))],bundle:true,format:'cjs',write:false,external:['vue'],logLevel:'silent'});
const m={exports:{}};vm.runInNewContext(result.outputFiles[0].text,{module:m,exports:m.exports,require:()=>({h:(type,props,children)=>({type,props,children})})});
const {readAcpDiagnostics,renderAcpDiagnostics}=m.exports;
const value=()=>({version:1,diagnosticId:'acp-'+'a'.repeat(32),workspace:'workspace',executable:'trusted-executable',agentName:'OpenCode',agentVersion:'2.fixture',sessionModel:'name-contains-free',sessionMode:'build',source:'acp-observation',configSources:'unknown',processIdentity:'unknown',primaryAgent:'unknown',price:'unknown',pluginModels:'unknown',network:'not-tested',modelTask:'not-tested'});
test('只显示协议实际回执，带free的模型名不改变价格和任务验证状态',()=>{
 const v=value();assert.equal(readAcpDiagnostics(v),v);const text=JSON.stringify(renderAcpDiagnostics(v));
 for(const label of ['2.fixture','name-contains-free','未知，未核价','未确认动态插件覆盖','未发送模型任务'])assert.ok(text.includes(label));
 assert.equal(text.includes('免费模型已确认'),false);
});
test('缺字段和未知契约安全展示，不泄露任意原始配置',()=>{
 for(const patch of [{version:2},{price:'free'},{sessionModel:3},{agentVersion:'x\nsecret'},{diagnosticId:'wrong'}]){
  const input={...value(),...patch,_meta:{apiKey:'must-not-render'}};assert.throws(()=>readAcpDiagnostics(input));
  const text=JSON.stringify(renderAcpDiagnostics(input));assert.ok(text.includes('结构化诊断回执无效'));assert.equal(text.includes('must-not-render'),false);
 }
 assert.equal(readAcpDiagnostics(undefined),null);
});

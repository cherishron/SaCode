import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const output=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/acp-instance-metadata.ts',import.meta.url))],bundle:true,format:'cjs',write:false,external:['vue'],logLevel:'silent'});
const m={exports:{}};vm.runInNewContext(output.outputFiles[0].text,{module:m,exports:m.exports,require:()=>({h:(type,props,children)=>({type,props,children})})});
const {readAcpInstanceMetadata,renderAcpInstanceMetadata}=m.exports;
function fixture(){return {version:1,source:'opencode-v2-plugin',binding:'request-and-acp-session',directory:'fixture',sessionId:'s1',providerVersion:'2.0.28',providerPid:17,osUser:'fixture-user',capturedAt:100,
 models:{status:'observed',complete:true,items:[{providerId:'p',modelId:'free-name-not-proof',enabled:true}]},
 defaultModel:{ref:{providerId:'p',modelId:'free-name-not-proof'},availability:'listed'},
 agents:{status:'observed',complete:true,items:[{id:'worker',mode:'subagent',model:{providerId:'p',modelId:'missing'},availability:'not-listed'}]},
 plugins:{status:'observed',complete:true,items:[{id:'omo',status:'unknown'}]},configSources:'not-exposed',price:'unknown',dynamicRoutes:'unknown',modelTask:'not-tested'};}
test('主模型目录与Agent模型风险分列，未调用和未核价边界可见',()=>{
 const value=fixture();assert.equal(readAcpInstanceMetadata(value,'fixture'),value);const rendered=JSON.stringify(renderAcpInstanceMetadata(value,'fixture'));
 for(const text of ['free-name-not-proof','worker','missing','当前启用目录已列出','当前启用目录未列出','不影响 SaCode 自有 Agent','模型价格未知'])assert.ok(rendered.includes(text));
 assert.equal(rendered.includes('完全可用'),false);assert.equal(rendered.includes('免费已确认'),false);
});
test('拒绝跨作用域、伪造免费、非法版本和不完整目录的伪造结论',()=>{
 for(const patch of [{directory:'other'},{providerVersion:'2.0.29'},{price:'free'},{providerPid:0},{models:{...fixture().models,complete:false,items:[]}}]){
  const value={...fixture(),...patch};assert.throws(()=>readAcpInstanceMetadata(value,'fixture'));assert.ok(JSON.stringify(renderAcpInstanceMetadata(value,'fixture')).includes('回执无效'));
 }
});
test('未知扩展配置和密钥字段不进入页面，空元数据保持未知',()=>{
 const value={...fixture(),credential:'must-not-render',headers:{authorization:'must-not-render'}};
 value.agents.items[0].request={secret:'must-not-render'};
 assert.equal(JSON.stringify(renderAcpInstanceMetadata(value,'fixture')).includes('must-not-render'),false);assert.equal(renderAcpInstanceMetadata(null,'fixture'),null);
});

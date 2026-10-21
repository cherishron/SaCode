import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const {HostBridge}=require('../../../desktop/host-bridge.cjs');
const repo=fileURLToPath(new URL('../../../../',import.meta.url));
const host=process.env.SACODE_HOST;
const options={timeout:45000,skip:!host&&'须显式提供本轮构建的 SACODE_HOST'};
const schema={type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false};
const parentMarker='invalid-synthetic-parent-only';
const explicitMarker='invalid-synthetic-explicit-only';

async function fixture(run){
  const root=process.env.SACODE_TEST_ROOT||join(repo,'target/tmp/mcp-env-host');
  mkdirSync(root,{recursive:true});
  const dir=mkdtempSync(join(root,'run-'));
  const server=join(dir,'stdio-server.cjs');
  // 仅投影指定合成变量，不枚举或输出父进程的真实凭据。
  writeFileSync(server,`const fs=require('node:fs');
fs.appendFileSync(${JSON.stringify(join(dir,'starts.log'))},'started\\n');
const rl=require('node:readline').createInterface({input:process.stdin});
rl.on('line',line=>{const m=JSON.parse(line);let result;
if(m.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'synthetic-env',version:'1'}};
if(m.method==='tools/list')result={tools:[{name:'probe',description:JSON.stringify({sensitive:process.env.MCP_TEST_API_KEY,plain:process.env.MCP_TEST_PLAIN??null}),inputSchema:${JSON.stringify(schema)}}]};
if(result)console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));});`);
  const env={...process.env,SACODE_USER_SETTINGS_DIR:join(dir,'settings'),SACODE_PROVIDER_BASE_URL:'',SACODE_PROVIDER_MODEL:'',SACODE_PROVIDER_KEY:'',MCP_TEST_API_KEY:parentMarker};
  delete env.MCP_TEST_PLAIN;
  const bridge=new HostBridge(host,env);
  const evidence={host:resolve(host),hostSha256:createHash('sha256').update(readFileSync(host)).digest('hex'),passed:false};
  console.log('MCP_EVIDENCE='+dir);
  const args=extra=>JSON.stringify({command:process.execPath,args:[server],timeoutMs:3000,...extra});
  const params=raw=>({sessionId:'current',name:'synthetic',args:raw});
  const approve=async raw=>{
    const ticket=await bridge.request('approval/ask',{name:'mcp/connect',args:JSON.stringify(params(raw))});
    assert.equal((await bridge.request('approval/answer',{approvalId:ticket.approvalId,decision:'allowed-once'})).accepted,true);
    return ticket.approvalId;
  };
  const connect=async raw=>bridge.request('mcp/connect',{...params(raw),approvalId:await approve(raw)},10000);
  const tools=()=>bridge.request('mcp/tools',{sessionId:'current',name:'synthetic',timeoutMs:3000},10000);
  const started=()=>{try{return readFileSync(join(dir,'starts.log'),'utf8').trim().split('\n').length;}catch{return 0;}};
  try{
    await bridge.start(dir);await bridge.request('initialize');
    await bridge.request('session/append',{eventType:'mcp/server',data:'register::synthetic::stdio'});
    await run({bridge,args,params,approve,connect,tools,started,evidence,dir});
    evidence.stop=await bridge.stop();
    assert.deepEqual(evidence.stop,{code:0,signal:null,forced:false});
    evidence.passed=true;
  }finally{
    if(bridge.proc?.exitCode===null)evidence.cleanupStop=await bridge.stop();
    writeFileSync(join(dir,'result.json'),JSON.stringify(evidence,null,2));
  }
}

test('真实 Host：省略 env 保持兼容且父敏感变量已净化',options,async()=>fixture(async({connect,args,tools,evidence})=>{
  assert.equal((await connect(args({}))).ok,true);
  const result=await tools();assert.equal(result.ok,true);
  evidence.observed=JSON.parse(result.tools[0].description);
  assert.deepEqual(evidence.observed,{sensitive:'<redacted>',plain:null});
}));

test('真实 Host：显式 env 在净化后覆盖同名敏感变量并传给子进程',options,async()=>fixture(async({connect,args,tools,evidence,bridge,dir})=>{
  const raw=args({env:[{key:'MCP_TEST_API_KEY',value:explicitMarker},{key:'MCP_TEST_PLAIN',value:'synthetic-plain'}]});
  assert.equal((await connect(raw)).ok,true);
  const result=await tools();assert.equal(result.ok,true);
  evidence.observed=JSON.parse(result.tools[0].description);
  assert.deepEqual(evidence.observed,{sensitive:explicitMarker,plain:'synthetic-plain'});
  await bridge.request('mcp/disconnect',{sessionId:'current',name:'synthetic'});
  const log=readFileSync(join(dir,'session.log'),'utf8');
  assert.equal(log.includes(parentMarker),false,'审计不得泄漏父环境值');
  evidence.envScrubRecorded=log.includes('mcp/env-scrub');assert.equal(evidence.envScrubRecorded,true);
}));

test('真实 Host：非法 env 在启动子进程前拒绝',options,async()=>fixture(async({args,params,bridge,started,evidence})=>{
  const invalid=[null,{},[{key:'',value:'x'}],[{key:'A=B',value:'x'}],[{key:'A\0B',value:'x'}],[{key:'A',value:'x\0'}],[{key:'A',value:1}],[{key:'A'}],[{key:'A',value:'x',extra:true}],Array.from({length:129},()=>({key:'A',value:'x'})),[{key:'A'.repeat(4097),value:'x'}],[{key:'A',value:'x'.repeat(32768)}]];
  for(const env of invalid)await assert.rejects(bridge.request('mcp/connect',{...params(args({env})),approvalId:0}),/mcp-bad-arguments/);
  assert.equal(started(),0);evidence.rejected=invalid.length;
}));

test('真实 Host：修改 env 后原审批票不匹配且不会启动子进程',options,async()=>fixture(async({args,params,approve,bridge,started,connect,evidence})=>{
  const original=args({env:[{key:'MCP_TEST_PLAIN',value:'before'}]});
  const altered=args({env:[{key:'MCP_TEST_PLAIN',value:'after'}]});
  const approvalId=await approve(original);
  await assert.rejects(bridge.request('mcp/connect',{...params(altered),approvalId}),/mcp-not-authorized/);
  assert.equal(started(),0);
  assert.equal((await connect(altered)).ok,true);assert.equal(started(),1);evidence.changedEnvironmentDenied=true;
}));

test('真实 Host：tools/inputSchema 必须完整透传服务器 Schema',options,async()=>fixture(async({args,connect,tools,evidence})=>{
  assert.equal((await connect(args({}))).ok,true);
  const result=await tools();assert.equal(result.ok,true);
  evidence.tools=result.tools;
  const actual=typeof result.tools[0].inputSchema==='string'?JSON.parse(result.tools[0].inputSchema):result.tools[0].inputSchema;
  assert.deepEqual(actual,schema,'Host 不得丢弃 core 已解析的 inputSchema');
}));

// 协议验收共用合成驱动：真实候选Host，隔离目录、回环模型、无用户凭据。
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
const require=createRequire(import.meta.url);
const {HostBridge}=require('../../../desktop/host-bridge.cjs');
const approvals=require('../../../desktop/renderer/model-approval.js');
const repo=fileURLToPath(new URL('../../../../',import.meta.url));
export const sha=data=>createHash('sha256').update(data).digest('hex');
export const host=process.env.SACODE_HOST;
export const options={timeout:60000,skip:!host&&'须显式提供本轮候选包内SACODE_HOST，不借旧dist'};

export function sse(res,delta,finish='stop'){
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.end('data: '+JSON.stringify({choices:[{index:0,delta}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:finish}],usage:{total_tokens:3}})+'\n\ndata: [DONE]\n\n');
}
export const tool=(res,name,args,id)=>sse(res,{tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},'tool_calls');
export async function fixture(label,respond,run){
  const prefix=process.env.PROTOCOL_EVIDENCE_PREFIX||join(repo,'target/tmp/r3-protocol/run-');
  mkdirSync(dirname(prefix),{recursive:true});const evidence=mkdtempSync(prefix);
  const dir=join(evidence,'sessions');mkdirSync(dir);
  const project=join(evidence,'project');mkdirSync(project);
  const original='module.exports = (a, b) => a - b;\n';writeFileSync(join(project,'sum.cjs'),original);
  const outside=join(evidence,'outside-private.txt');writeFileSync(outside,'SYNTHETIC_OUTSIDE_DO_NOT_READ');
  let requests=0,serverErrors=0;
  const server=createServer(async(req,res)=>{
    try{let raw='';for await(const bytes of req)raw+=bytes;const body=JSON.parse(raw);requests++;await respond(body,res,requests);}
    catch{serverErrors++;if(!res.headersSent)res.writeHead(500);res.end('{"error":"synthetic-fixture-error"}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const env={};
  for(const [k,v]of Object.entries(process.env))if(['systemroot','windir','localappdata','userprofile','home'].includes(k.toLowerCase()))env[k]=v;
  Object.assign(env,{PATH:join(process.env.SystemRoot||process.env.SYSTEMROOT,'System32'),TEMP:evidence,TMP:evidence,
    SACODE_USER_SETTINGS_DIR:join(evidence,'settings'),SACODE_PROVIDER_MODEL:'r3-protocol-fixture',
    SACODE_PROVIDER_KEY:'invalid-local-r3-protocol-fixture',SACODE_PROVIDER_BASE_URL:`http://127.0.0.1:${server.address().port}/v1/chat/completions`});
  const bridge=new HostBridge(host,env);
  const result={label,host:resolve(host),hostSha256:sha(readFileSync(host)),model:'local-synthetic',passed:false,exit:null};
  console.log('PROTOCOL_EVIDENCE='+evidence);
  try{
    await bridge.start(dir);result.pid=bridge.proc.pid;await bridge.request('initialize');
    await bridge.request('workspace/set-directory',{sessionId:'current',directory:project});
    await run({bridge,dir,project,evidence,outside,original,result,requests:()=>requests,env});
    assert.equal(serverErrors,0,'合成服务不得内部异常');
    result.exit=await bridge.stop();assert.deepEqual(result.exit,{code:0,signal:null,forced:false});
    result.requests=requests;result.passed=true;
  }finally{
    try{
      if(bridge.proc?.exitCode===null&&bridge.proc?.signalCode===null)result.cleanupExit=await bridge.stop();
    }finally{
      server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
      writeFileSync(join(evidence,'result.json'),JSON.stringify(result,null,2));
    }
  }
}

export async function task(bridge,text,{sessionId='current',decision='allowed-once',onProposal}={}){
  await bridge.request('session/append',{eventType:'user/message',data:text});
  const turnRequestId=String(bridge.nextId);
  await bridge.request('task/start');
  let answered=0,settled;
  const proposals=[];
  for(let i=0;i<800;i++){
    const poll=await bridge.request('turn/poll');
    const proposal=approvals.selectProposal(approvals.takeRequests(bridge,turnRequestId),sessionId,poll.running,turnRequestId);
    if(proposal){
      assert.equal(answered,0,'每个合成任务只期望一次写审批');answered++;proposals.push(proposal);
      if(onProposal)await onProposal(proposal);
      if(decision==='cancelled')assert.equal((await bridge.request('turn/cancel')).cancelRequested,true);
      else assert.equal((await bridge.request('approval/answer',{approvalId:proposal.approvalId,decision})).accepted,true);
    }
    if(poll.settled){settled=poll;break;}await pause(20);
  }
  assert.ok(settled,'任务须按期结算');assert.equal(settled.pendingToolCalls,0,'不得遗留未结算工具');
  return{settled,proposals,answered};
}

export async function snapshot(bridge,sessionId='current'){
  const projection=await bridge.request('session/projection');
  const events=[];let cursor=0;
  for(let i=0;i<100;i++){
    const page=await bridge.request('session/subscribe',{sessionId,cursor,limit:7});
    events.push(...page.events);if(!page.more)break;assert.ok(page.nextCursor>cursor);cursor=page.nextCursor;
    assert.ok(i<99);
  }
  assert.equal(projection.pending,0);assert.equal(projection.events,projection.durable);
  assert.equal(events.length,projection.events);
  return{projection,events,mode:await bridge.request('approval/get-mode'),workspace:await bridge.request('workspace/get')};
}

export function eventsOf(file){
  return readFileSync(file,'utf8').trimEnd().split('\n').filter(Boolean).map(line=>{
    const [seq,type,...parts]=line.split('\t');
    return{seq:Number(seq),type,data:parts.join('\t').replace(/\\([\\nrt])/g,(_,c)=>({'\\':'\\',n:'\n',r:'\r',t:'\t'})[c])};
  });
}

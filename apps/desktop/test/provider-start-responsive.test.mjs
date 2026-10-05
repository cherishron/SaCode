import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {HostBridge}=createRequire(import.meta.url)('../host-bridge.cjs');
const host=process.env.DSH_HOST||fileURLToPath(new URL('../dist/host/bin/dsh-host.exe',import.meta.url));

test('提供商未交回响应头时起轮先应答，目标暂停和队列仍可操作',async()=>{
 let release;const gate=new Promise(done=>release=done);
 let entered;const requestStarted=new Promise(done=>entered=done);
 const server=createServer(async(req,res)=>{
  req.resume();entered();await gate;
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.end('data: '+JSON.stringify({choices:[{index:0,delta:{content:'ok'},finish_reason:null}]})+'\n\n'+
   'data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{total_tokens:1}})+'\n\n'+'data: [DONE]\n\n');
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const root=mkdtempSync(join(tmpdir(),'sacode-provider-start-'));
 const bridge=new HostBridge(host,{...process.env,SACODE_USER_SETTINGS_DIR:join(root,'settings'),DSH_PROVIDER_BASE_URL:`http://127.0.0.1:${server.address().port}/v1`,DSH_PROVIDER_MODEL:'fixture',DSH_PROVIDER_KEY:'fixture'});
 const watchdog=setTimeout(release,6500);
 await bridge.start(root);
 try{
  await bridge.request('goal/create',{sessionId:'current',objective:'验证响应性'});
  await bridge.request('session/append',{eventType:'user/message',data:'开始'});
  assert.equal((await bridge.request('task/start')).started,true);
  await requestStarted;
  assert.equal((await bridge.request('turn/poll')).running,true);
  assert.equal((await bridge.request('goal/pause',{sessionId:'current',revision:1})).phase,'paused');
  assert.equal((await bridge.request('queue/enqueue',{text:'继续补充',rpcId:'while-headers'})).accepted,true);
  clearTimeout(watchdog);release();
  let result;
  for(let i=0;i<200;i++){result=await bridge.request('turn/poll');if(result.settled)break;await new Promise(done=>setTimeout(done,10));}
  assert.equal(result.settled,true);assert.equal(result.text,'ok');assert.equal(result.interrupted,false);
  assert.equal((await bridge.request('goal/describe',{sessionId:'current'})).phase,'paused');
 }finally{
  clearTimeout(watchdog);release();await bridge.stop();server.closeAllConnections();await new Promise(done=>server.close(done));
 }
});

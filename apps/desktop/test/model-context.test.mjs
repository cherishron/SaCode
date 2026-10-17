import { fixtureHostEnv } from '../test-support/fixture-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
const {HostBridge}=createRequire(import.meta.url)('../host-bridge.cjs');

test('真实 Host 请求携带用户正文及前文，响应落盘后可投影', {timeout:20000}, async()=>{
  let received;
  const server=createServer(async(req,res)=>{
    let body='';for await(const part of req) body+=part;
    received={url:req.url,body:JSON.parse(body)};
    res.writeHead(200,{'content-type':'text/event-stream'});
    res.end('data: '+JSON.stringify({choices:[{index:0,delta:{content:'真实协议夹具回复'},finish_reason:null}]})+'\n\n'+
      'data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:2,completion_tokens:3,total_tokens:5}})+'\n\n'+
      'data: [DONE]\n\n');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const dir=mkdtempSync(join(tmpdir(),'sacode-model-context-'));
  const exe=process.env.SACODE_HOST || fileURLToPath(new URL('../dist/host/bin/sacode-host.exe',import.meta.url));
  const bridge=new HostBridge(exe,{...fixtureHostEnv(dir),SACODE_PROVIDER_BASE_URL:`http://127.0.0.1:${server.address().port}`,SACODE_PROVIDER_MODEL:'fixture-model',SACODE_PROVIDER_KEY:'fixture-only'});
  try {
    await bridge.start(dir);
    for(const text of ['第一轮中文任务','继续\n保留"引号"与\\路径']) {
      await bridge.request('session/append',{eventType:'user/message',data:text});
    }
    const start=await bridge.request('turn/start',{limit:5});
    assert.equal(start.provider,'real');
    let settled=false;
    for(let i=0;i<100;i++) {const poll=await bridge.request('turn/poll');if(poll.settled){settled=true;break;}await sleep(20);}
    assert.equal(settled,true,'真实流必须收束');
    assert.equal(received.url,'/chat/completions');
    assert.equal(received.body.model,'fixture-model');
    assert.deepEqual(received.body.messages,[{role:'user',content:'第一轮中文任务'},{role:'user',content:'继续\n保留"引号"与\\路径'}]);
    assert.deepEqual(received.body.stream_options,{include_usage:true});
    const projection=await bridge.request('session/projection');
    assert.ok(projection.messages.some(m=>m.includes('真实协议夹具回复')));
    assert.ok(readFileSync(join(dir,'session.log'),'utf8').includes('assistant/message'));
  } finally {
    await bridge.stop().catch(()=>{});
    await new Promise(resolve=>server.close(resolve));
    rmSync(dir,{recursive:true,force:true});
  }
});

import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readdirSync,copyFileSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const repo=resolve('.'),core=resolve(process.env.SACODE_CORE_LIBRARY||'');
assert.ok(process.env.SACODE_CORE_LIBRARY&&existsSync(join(core,'libcore.a')),'必须指定本轮 core 库');
const stdx='C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx';
const root=mkdtempSync(resolve('apps/desktop/.tmp-test/sse-cancel-')),exe=join(root,'probe.exe'),tmp=join(root,'tmp');mkdirSync(tmp);
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const source=resolve('core/test-support/sse-cancel-probe.cj');
const args=['--import-path',core,'--import-path',stdx,'-L',core,'-L',stdx,'-lcore',...readdirSync(stdx).filter(x=>x.endsWith('.dll')).map(x=>'-l:'+x),source,'-o',exe];
const env={...process.env,TMP:tmp,TEMP:tmp};
writeFileSync(join(root,'manifest.json'),JSON.stringify({core,coreSha256:hash(join(core,'libcore.a')),source,sourceSha256:hash(source),verifierSha256:hash(new URL(import.meta.url)),args},null,2));
const build=spawnSync('D:/Program Files/HuaWei/Cangjie/bin/cjc.exe',args,{cwd:repo,env,encoding:'utf8',windowsHide:true,timeout:120000});
writeFileSync(join(root,'build.log'),(build.stdout||'')+(build.stderr||''));writeFileSync(join(root,'build-exit.txt'),String(build.status));assert.equal(build.status,0,'probe build: '+root);
const dllDir=resolve(process.env.SACODE_DLL_DIR||'target/closure-b1a9811e86224a90a7fdc1ae2904db71/host-packed/bin');
for(const file of readdirSync(dllDir).filter(x=>x.endsWith('.dll')))copyFileSync(join(dllDir,file),join(root,file));
const events=[],results=[];
const frame=text=>`data: ${JSON.stringify({choices:[{index:0,delta:{content:text}}]})}\n\n`;
const server=createServer((req,res)=>{const mode=req.url.split('/')[1];events.push({mode,event:'request'});req.resume();res.on('close',()=>events.push({mode,event:'connection-closed',finished:res.writableFinished}));if(mode==='headers')return;res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(frame('first'));const timer=setTimeout(()=>res.end(frame('late')+'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":7}}\n\ndata: [DONE]\n\n'),mode==='detached'?500:5000);res.on('close',()=>clearTimeout(timer));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try {for(const mode of ['body','parent','detached','headers','timeout']){const run=await new Promise((done,reject)=>{const child=spawn(exe,[`http://127.0.0.1:${server.address().port}/${mode}/v1`,mode],{cwd:root,env:{...env,PATH:join(process.env.SystemRoot,'System32')},windowsHide:true});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);const timer=setTimeout(()=>child.kill(),10000);child.on('error',reject);child.on('exit',(code,signal)=>{clearTimeout(timer);done({mode,code,signal,stdout,stderr});});});results.push(run);writeFileSync(join(root,mode+'.log'),run.stdout+run.stderr);writeFileSync(join(root,mode+'.exit.txt'),String(run.code));assert.equal(run.code,0,mode+': '+root);assert.ok(run.stdout.includes('SSE_CANCEL_PASS:'+mode),mode);assert.equal(events.filter(x=>x.mode===mode&&x.event==='request').length,1,'禁止取消后重发');}console.log('SSE_CANCEL_PASS: 5 real HTTP cases');}
finally {server.closeAllConnections();await new Promise(r=>server.close(r));writeFileSync(join(root,'results.json'),JSON.stringify({results,events},null,2));console.log('SSE_CANCEL_EVIDENCE='+root);}

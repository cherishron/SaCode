import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
assert.equal(process.platform,'win32');
const isolated=process.argv.includes('--sandbox');
const base=join(tmpdir(),'SaCode-broker-verification');mkdirSync(base,{recursive:true});const root=mkdtempSync(join(base,'windows-broker-'));
const exe=join(root,'sacode-job-broker.exe'), compiler=join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const sources=['core/native/windows_job.cs','core/native/windows_appcontainer.cs','core/native/windows_job_broker.cs'].map(resolvePath=>resolve(resolvePath));
const built=spawnSync(compiler,['/nologo','/platform:x64','/target:exe','/r:System.Web.Extensions.dll',`/out:${exe}`,...sources],{windowsHide:true,encoding:'utf8',timeout:30000});
writeFileSync(join(root,'build.log'),(built.stdout||'')+(built.stderr||''));writeFileSync(join(root,'build-exit.txt'),String(built.status));assert.equal(built.status,0,root);
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');writeFileSync(join(root,'manifest.json'),JSON.stringify({sources:Object.fromEntries(sources.map(p=>[p,hash(p)])),verifier:hash(resolve('apps/desktop/test-support/windows-job-broker-verify.mjs')),executable:hash(exe),compiler},null,2));
const tool=join(root,'tool');mkdirSync(tool);copyFileSync(process.execPath,join(tool,'node.exe'));
const outside=join(root,'outside');mkdirSync(outside);writeFileSync(join(outside,'secret'),'private canary');
const results=[];const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
async function until(fn,why,ms=6000){const end=Date.now()+ms;while(Date.now()<end){if(fn())return;await sleep(20);}throw Error(why);}
async function run(mode){
  const work=join(root,mode);mkdirSync(work);const fixture=join(work,'fixture.cjs');
  writeFileSync(fixture, mode==='read-only'||mode==='sandbox-boundaries'?`const fs=require('fs');const result={};for(const [key,path,write] of [['insideRead','fixture.cjs',false],['insideWrite','new-file',true],['outsideRead',${JSON.stringify(join(outside,'secret'))},false],['outsideWrite',${JSON.stringify(join(outside,'new-file'))},true]]){try{write?fs.writeFileSync(path,'written'):fs.readFileSync(path);result[key]={allowed:true};}catch(e){result[key]={allowed:false,code:e.code};}}console.log(JSON.stringify(result));`:
    mode==='output'?`const fs=require('fs');fs.writeFileSync('ran','yes');fs.writeSync(1,Buffer.from('OUT:'+ '语'.repeat(100000)));fs.writeSync(2,Buffer.from('ERR:'+ '音'.repeat(100000)));process.exitCode=23;`:
    mode==='timeout-tree'?`const fs=require('fs'),{spawn}=require('child_process');const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:['ignore',1,2],windowsHide:true});p.unref();fs.writeFileSync('child',String(p.pid));process.exitCode=17;`:
    `require('fs').writeFileSync('ran','yes');setInterval(()=>{},1000);`);
  const sandboxOptions=isolated?['--sandbox',root,tool,mode==='read-only'?'read-only':'workspace-write',mode==='bad-image'?'0'.repeat(64):hash(join(tool,'node.exe'))]:[];
  const broker=spawn(exe,sandboxOptions,{cwd:work,windowsHide:true,stdio:['pipe','pipe','pipe']});let pending='',stderr='',exit;const frames=[];
  broker.stdout.on('data',b=>{pending+=b;let n;while((n=pending.indexOf('\n'))>=0){frames.push(JSON.parse(pending.slice(0,n)));pending=pending.slice(n+1);}});
  broker.stderr.on('data',b=>stderr+=b);broker.on('exit',(code,signal)=>exit={code,signal});broker.stdin.on('error',()=>{});
  const send=frame=>broker.stdin.write(JSON.stringify(frame)+'\n');const command=action=>send({version:1,executionId:'probe',action});
  try {
    const request={version:1,executionId:'probe',executable:isolated?join(tool,'node.exe'):process.execPath,argv:isolated?['-e',readFileSync(fixture,'utf8'),fixture]:[fixture],cwd:work,timeoutMs:mode==='timeout-tree'?1500:10000,outputLimit:1024};
    if(mode==='bad-fields')request.unexpected=true;
    if(mode==='bad-limit')request.outputLimit=0;
    send(request);await until(()=>frames.length>0||exit,'no suspended fact');
    if(mode.startsWith('bad-')){assert.equal(exit.code,1);if(mode==='bad-image')assert.match(stderr,/broker-executable-identity-changed/);assert.equal(frames.length,0);assert.equal(existsSync(join(work,'ran')),false);results.push({mode,passed:true,frames,exit,stderr});return;}
    assert.equal(frames[0].kind,'suspended');assert.equal(frames[0].sandboxed,isolated);assert.equal(frames[0].activeProcesses,1);assert.ok(BigInt(frames[0].creationFileTime)>0n);await sleep(100);assert.equal(existsSync(join(work,'ran')),false);
    if(mode==='stop-before-resume')command('stop');
    else if(mode==='wrong-identity')send({version:1,executionId:'other',action:'resume'});
    else if(mode==='owner-eof')broker.stdin.end();
    else {command('resume');if(mode==='stop'){await until(()=>existsSync(join(work,'ran')),'not resumed');command('stop');}}
    await until(()=>exit!==undefined,'broker failed to settle');
    assert.equal(alive(frames[0].pid),false,'owned root leaked');
    if(mode==='wrong-identity'||mode==='owner-eof'){assert.equal(exit.code,1);assert.equal(frames.some(f=>f.kind==='result'),false);assert.equal(existsSync(join(work,'ran')),false);}
    else {
      assert.equal(exit.code,0,stderr);const result=frames.at(-1);assert.equal(result.kind,'result');assert.equal(result.treeEmpty,true);assert.equal(result.outputComplete,true);assert.equal(result.exitObserved,true);assert.equal(result.sandboxed,isolated);assert.equal(result.sandboxCleanupConfirmed,true);
      for(const channel of ['stdout','stderr']) {
        let sequence=0;const chunks=[];const channelFrames=frames.filter(f=>f.channel===channel);for(const f of channelFrames){assert.equal(f.sequence,++sequence);if(f.kind==='output'){const b=Buffer.from(f.data,'base64');assert.equal(b.length,f.byteCount);assert.ok(b.length<=512);chunks.push(b);}}
        const end=channelFrames.at(-1);assert.equal(end.kind,'output-end');assert.equal(end.eof,true);assert.equal(end.byteCount,Buffer.concat(chunks).length);
        if(mode==='output'){assert.equal(end.totalBytes,300004);assert.equal(end.truncated,true);assert.equal(end.byteCount,1024);assert.equal(Buffer.concat(chunks).subarray(0,4).toString(),channel==='stdout'?'OUT:':'ERR:');}
      }
      if(mode==='read-only'||mode==='sandbox-boundaries'){assert.equal(result.exitCode,0);const bytes=Buffer.concat(frames.filter(f=>f.kind==='output'&&f.channel==='stdout').map(f=>Buffer.from(f.data,'base64')));const value=JSON.parse(bytes.toString());assert.equal(value.insideRead.allowed,true);assert.equal(value.insideWrite.allowed,mode!=='read-only');assert.equal(value.outsideRead.allowed,false);assert.equal(value.outsideWrite.allowed,false);assert.equal(existsSync(join(outside,'new-file')),false);assert.equal(readFileSync(join(outside,'secret'),'utf8'),'private canary');}
      if(mode==='output'){assert.equal(result.exitCode,23);assert.equal(result.cancelled,false);}
      if(mode==='timeout-tree'){assert.equal(result.exitCode,17);assert.equal(result.timedOut,true);const child=Number(readFileSync(join(work,'child'),'utf8'));await until(()=>!alive(child),'descendant leaked');}
      if(mode==='stop-before-resume'){assert.equal(result.resumed,false);assert.equal(result.cancelled,true);assert.equal(existsSync(join(work,'ran')),false);}
      if(mode==='stop'){assert.equal(result.cancelled,true);assert.equal(result.resumed,true);}
    }
    results.push({mode,passed:true,frames,exit,stderr});
  }finally{if(!exit){broker.kill();await until(()=>exit!==undefined,'own broker cleanup failed');}}
}
const modes=['output','stop-before-resume','stop','timeout-tree','wrong-identity','owner-eof','bad-fields','bad-limit',...(isolated?['read-only','sandbox-boundaries','bad-image']:[])];
try{for(const mode of modes)await run(mode);console.log('WINDOWS_BROKER_PASS: '+modes.length+' cases; sandbox='+isolated);}
finally{writeFileSync(join(root,'results.json'),JSON.stringify(results,null,2));console.log('WINDOWS_BROKER_EVIDENCE='+root);}

import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createServer,createConnection} from 'node:net';
import {tmpdir} from 'node:os';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
assert.equal(process.platform,'win32');const base=join(tmpdir(),'SaCode-sandbox-verification');mkdirSync(base,{recursive:true});const root=mkdtempSync(join(base,'windows-sandbox-'));
const tool=join(root,'tool'),outside=join(root,'outside');mkdirSync(tool);mkdirSync(outside);copyFileSync(process.execPath,join(tool,'node.exe'));writeFileSync(join(outside,'secret'),'outside private canary');
const compiler=join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),exe=join(root,'sandbox-probe.exe');
const sources=['core/native/windows_job.cs','core/native/windows_appcontainer.cs','core/test-support/windows-sandbox-probe.cs'].map(p=>resolve(p));
const build=spawnSync(compiler,['/nologo','/platform:x64','/target:exe',`/out:${exe}`,...sources],{windowsHide:true,encoding:'utf8',timeout:30000});
writeFileSync(join(root,'build.log'),(build.stdout||'')+(build.stderr||''));writeFileSync(join(root,'build-exit.txt'),String(build.status));assert.equal(build.status,0,root);
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');writeFileSync(join(root,'manifest.json'),JSON.stringify({sources:Object.fromEntries(sources.map(p=>[p,hash(p)])),verifier:hash(resolve('apps/desktop/test-support/windows-sandbox-verify.mjs')),probeSha:hash(exe),nodeSha:hash(join(tool,'node.exe')),compiler},null,2));
let connections=0;const server=createServer(socket=>{connections++;socket.destroy();});await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const results=[];
try {
  for(const mode of (process.argv.includes('--token-only')?['token-only']:['read-only','workspace-write'])) {
    const work=join(root,mode);mkdirSync(work);writeFileSync(join(work,'inside'),'inside canary');
    writeFileSync(join(work,'fixture.cjs'),`const fs=require('fs'),net=require('net'),cp=require('child_process');const outside=process.argv[2];const result={};function attempt(label,fn){try{fn();result[label]={allowed:true};}catch(e){result[label]={allowed:false,code:e.code};}}attempt('insideRead',()=>fs.readFileSync('inside'));attempt('insideWrite',()=>fs.writeFileSync('new-file','written'));attempt('outsideRead',()=>fs.readFileSync(outside+'/secret'));attempt('outsideWrite',()=>fs.writeFileSync(outside+'/new-file','escaped'));const child=cp.spawnSync(process.execPath,['-e',"const fs=require('fs');try{fs.readFileSync(process.argv[1]);console.log('DESCENDANT_ESCAPED');process.exitCode=9}catch(e){console.log('DESCENDANT_DENIED:'+e.code);process.exitCode=['EACCES','EPERM'].includes(e.code)?0:10}",outside+'/secret'],{encoding:'utf8',timeout:3000,stdio:'inherit',windowsHide:true});result.child={status:child.status,stdout:child.stdout,stderr:child.stderr,error:child.error?.code};const socket=net.connect({host:'127.0.0.1',port:Number(process.argv[3])});socket.setTimeout(2000);socket.on('connect',()=>{result.network={allowed:true};socket.destroy();});socket.on('timeout',()=>{result.network={allowed:false,code:'TIMEOUT'};socket.destroy();});socket.on('error',e=>{result.network={allowed:false,code:e.code};});socket.on('close',()=>console.log(JSON.stringify(result)));`);
    const controlBefore=connections;let controlConnected=false;
    if(mode!=='token-only')await new Promise((done,reject)=>{const control=createConnection({host:'127.0.0.1',port});control.setTimeout(2000);control.on('connect',()=>{controlConnected=true;control.end();});control.on('close',()=>controlConnected?done():reject(new Error('network-control-not-connected')));control.on('error',reject);control.on('timeout',()=>{control.destroy();reject(new Error('network-control-timeout'));});});
    const beforeConnections=connections;assert.ok(mode==='token-only'||(controlConnected&&beforeConnections===controlBefore+1),'normal network control must connect');const run=await new Promise(resolveRun=>{
      const p=spawn(exe,[root,tool,work,mode,outside,String(port),process.argv.includes('--ephemeral')?'ephemeral':'profile'],{windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('close',(code,signal)=>resolveRun({code,signal,stdout,stderr}));
    });
    writeFileSync(join(work,'run.log'),run.stdout+run.stderr);writeFileSync(join(work,'run-exit.txt'),String(run.code));
    if(run.code!==0){results.push({mode,exit:run.code,passed:false,stderr:run.stderr});}
    assert.equal(run.code,0,'sandbox run failed: '+work+'\n'+run.stderr);
    if(mode==='token-only'){assert.match(run.stdout,/APP_CONTAINER_TOKEN_VERIFIED/);assert.match(run.stdout,/SANDBOX_PROFILE_CLEANED:/);results.push({mode,passed:true,exit:run.code});continue;}
    const frame=JSON.parse(run.stdout.split(/\r?\n/).find(line=>line.startsWith('{')));results.push({mode,frame,controlConnected,controlConnections:beforeConnections-controlBefore,connections:connections-beforeConnections,exit:run.code});
    assert.equal(frame.insideRead.allowed,true);assert.equal(frame.insideWrite.allowed,mode==='workspace-write');assert.equal(frame.outsideRead.allowed,false);assert.equal(frame.outsideWrite.allowed,false);assert.equal(readFileSync(join(outside,'secret'),'utf8'),'outside private canary');assert.equal(existsSync(join(outside,'new-file')),false);assert.equal(existsSync(join(work,'new-file')),mode==='workspace-write');
    assert.equal(frame.network.allowed,false);assert.ok(['EACCES','EPERM','ETIMEDOUT','TIMEOUT'].includes(frame.network.code),'isolated network must fail with reachable normal control');assert.equal(connections,beforeConnections);
    assert.equal(frame.child.status,0,JSON.stringify(frame.child));assert.match(run.stdout,/DESCENDANT_DENIED:(EACCES|EPERM)/);assert.match(run.stdout,/SANDBOX_PROFILE_CLEANED:/);
  }
  console.log(process.argv.includes('--token-only')?'WINDOWS_APPCONTAINER_TOKEN_PASS: no ACL mutation, not filesystem admission':'WINDOWS_SANDBOX_PASS: two modes, real AppContainer, files, descendant, network');
}finally{
  server.close();
  // 清理只匹配本轮明确目录内的新增 AppContainer SID，不修改真实工作区或父目录。
  const cleanupScript=join(root,'cleanup.ps1');
  writeFileSync(cleanupScript,`$ErrorActionPreference='Stop'\n$taskRoot=$args[0]\nforeach($taskPart in @('tool','read-only','workspace-write')){\n $taskPath=Join-Path $taskRoot $taskPart\n if(Test-Path -LiteralPath $taskPath){\n  $taskAcl=Get-Acl -LiteralPath $taskPath\n  $taskRules=@($taskAcl.Access | Where-Object {-not $_.IsInherited -and $_.IdentityReference.Value -like 'S-1-15-2-*'})\n  foreach($taskRule in $taskRules){$taskAcl.RemoveAccessRuleSpecific($taskRule)}\n  if($taskRules.Count -gt 0){Set-Acl -LiteralPath $taskPath -AclObject $taskAcl}\n  $taskLeft=@((Get-Acl -LiteralPath $taskPath).Access | Where-Object {-not $_.IsInherited -and $_.IdentityReference.Value -like 'S-1-15-2-*'})\n  if($taskLeft.Count -gt 0){throw 'temporary SID cleanup failed'}\n  Write-Output ('ACL_CLEANED '+$taskPart)\n }\n}\n`);
  const cleanup=spawnSync('pwsh',['-NoProfile','-File',cleanupScript,root],{windowsHide:true,encoding:'utf8',timeout:15000});
  writeFileSync(join(root,'cleanup.log'),(cleanup.stdout||'')+(cleanup.stderr||'')+(cleanup.error?.message||''));writeFileSync(join(root,'cleanup-exit.txt'),String(cleanup.status));
  writeFileSync(join(root,'results.json'),JSON.stringify(results,null,2));console.log('WINDOWS_SANDBOX_EVIDENCE='+root);
  assert.equal(cleanup.status,0,'private ACL cleanup failed: '+root);
}

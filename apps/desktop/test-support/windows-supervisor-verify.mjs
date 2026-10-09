import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
assert.equal(process.platform,'win32');
const [coreArg,brokerArg,dllArg]=process.argv.slice(2);assert.ok(coreArg&&brokerArg&&dllArg,'需要明确私有 core、broker 和 DLL 目录');
const core=resolve(coreArg),broker=resolve(brokerArg),dlls=resolve(dllArg),base=resolve('apps/desktop/.tmp-test');mkdirSync(base,{recursive:true});
const root=mkdtempSync(join(base,'windows-supervisor-'));const env={...process.env,TMP:root,TEMP:root};
const stdx=readFileSync('apps/host/cjpm.toml','utf8').match(/path-option\s*=\s*\[\s*"([^"]+)"/)[1];
const exe=join(root,'probe.exe'),source=resolve('core/test-support/windows-supervisor-probe.cj');
const command=['-O0','--import-path',core,'--import-path',stdx,'-L',core,'-L',stdx,'-lcore',...readdirSync(stdx).filter(n=>n.endsWith('.dll')).sort().map(n=>'-l:'+n),source,'-o',exe];
const build=spawnSync('cjc',command,{env,windowsHide:true,encoding:'utf8',timeout:60000});
writeFileSync(join(root,'build.log'),(build.stdout||'')+(build.stderr||'')+(build.error?.message||''));writeFileSync(join(root,'build-exit.txt'),String(build.status));
assert.equal(build.status,0,'probe build: '+root);
for(const file of readdirSync(dlls).filter(n=>n.endsWith('.dll')))copyFileSync(join(dlls,file),join(root,file));
for(const key of Object.keys(env))if(key.toLowerCase()==='path')delete env[key];env.PATH=join(process.env.SystemRoot,'System32');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
writeFileSync(join(root,'manifest.json'),JSON.stringify({coreLibrary:core,coreSha:hash(join(core,'libcore.a')),brokerSha:hash(broker),probeSha:hash(exe),sourceSha:hash(source),executorSha:hash(resolve('core/src/windows_job_executor.cj')),supervisorSha:hash(resolve('core/src/execution_supervisor.cj')),verifierSha:hash(resolve('apps/desktop/test-support/windows-supervisor-verify.mjs')),compileCommand:['cjc',...command],runtimePath:env.PATH},null,2));
const results=[];
try {
  for(const mode of ['output','gate','missing','startup-fail','stop','live-output']){
    const work=join(root,mode);mkdirSync(work);const fixture=join(work,'fixture.cjs');
    writeFileSync(fixture,mode==='live-output'?`const fs=require('fs');fs.writeFileSync('ran','yes');fs.writeSync(1,'OUT');fs.writeSync(2,'ERR');setInterval(()=>{},1000);`:mode==='stop'?`require('fs').writeFileSync('ran','yes');setInterval(()=>{},1000);`:`const fs=require('fs');fs.writeFileSync('ran','yes');fs.writeSync(1,Buffer.from('OUT:'+'语'.repeat(100000)));fs.writeSync(2,Buffer.from('ERR:'+'音'.repeat(100000)));process.exitCode=23;`);
    const run=spawnSync(exe,[broker,process.execPath,fixture,mode],{cwd:work,env,windowsHide:true,encoding:'utf8',timeout:45000});
    writeFileSync(join(work,'run.log'),(run.stdout||'')+(run.stderr||'')+(run.error?.message||''));writeFileSync(join(work,'run-exit.txt'),String(run.status));
    results.push({mode,exit:run.status,signal:run.signal,error:run.error?.message,passed:run.status===0&&run.stdout.includes('WINDOWS_SUPERVISOR_PASS:'+mode)});
    assert.equal(results.at(-1).passed,true,mode+': '+root);
  }
  console.log('WINDOWS_SUPERVISOR_PASS: 6 real core cases');
}finally{writeFileSync(join(root,'results.json'),JSON.stringify(results,null,2));console.log('WINDOWS_SUPERVISOR_EVIDENCE='+root);}

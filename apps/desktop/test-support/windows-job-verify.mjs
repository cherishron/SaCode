import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
assert.equal(process.platform, 'win32');
const base = resolve('apps/desktop/.tmp-test'); mkdirSync(base, { recursive: true });
const root = mkdtempSync(join(base, 'windows-job-'));
const compiler = join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const sources = ['core/native/windows_job.cs', 'core/test-support/windows-job-probe.cs'].map(p => resolve(p));
const exe = join(root, 'job-probe.exe');
const env = { ...process.env, TMP: root, TEMP: root };
const built = spawnSync(compiler, ['/nologo', '/platform:x64', '/target:exe', `/out:${exe}`, ...sources], { env, windowsHide: true, encoding: 'utf8', timeout: 30000 });
writeFileSync(join(root, 'build.log'), (built.stdout || '') + (built.stderr || '') + (built.error?.message || ''));
writeFileSync(join(root, 'build-exit.txt'), String(built.status));
assert.equal(built.status, 0, 'native provider build failed: ' + root);
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
writeFileSync(join(root, 'manifest.json'), JSON.stringify({ sources: Object.fromEntries(sources.map(p => [p, sha(p)])), verifier:sha(resolve('apps/desktop/test-support/windows-job-verify.mjs')), executable: sha(exe), compiler }, null, 2));
const fixture = join(root, 'child-tree.cjs');
writeFileSync(fixture, `const fs=require('fs'),p=require('path'),{spawn}=require('child_process');const root=process.argv[2];const child=spawn(process.execPath,['-e',"setInterval(()=>{},1000)"],{detached:true,stdio:'ignore',windowsHide:true});child.unref();fs.writeFileSync(p.join(root,'pids.json'),JSON.stringify({root:process.pid,child:child.pid}));setInterval(()=>fs.writeFileSync(p.join(root,'heartbeat'),String(Date.now())),50);`);
const results = [];
const outputFixture = join(root, 'dual-output.cjs');
writeFileSync(outputFixture, `const fs=require('fs');fs.writeSync(1,Buffer.from('OUT:'+ '语'.repeat(100000)));fs.writeSync(2,Buffer.from('ERR:'+ '音'.repeat(100000)));process.exitCode=23;`);
const heldFixture=join(root,'held-pipes.cjs');
writeFileSync(heldFixture, `const fs=require('fs'),p=require('path'),{spawn}=require('child_process');const child=spawn(process.execPath,['-e',"setInterval(()=>{},1000)"],{detached:true,stdio:['ignore',1,2],windowsHide:true});child.unref();fs.writeFileSync(p.join(process.argv[2],'pids.json'),JSON.stringify({root:process.pid,child:child.pid}));process.exitCode=17;`);
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(fn, message, ms = 5000) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return; await sleep(25); } throw Error(message); }
try {
  for (const mode of ['stop-before-start', 'stop', 'broker-crash', 'dual-output','descendant-held-pipes']) {
    const work = join(root, mode); mkdirSync(work);
    const broker = spawn(exe, [process.execPath, mode === 'dual-output' ? outputFixture : mode==='descendant-held-pipes'?heldFixture:fixture, work], { cwd: work, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let text = '', stderr = '', exit; const frames = [];
    broker.stdout.on('data', b => { text += b; let i; while ((i = text.indexOf('\n')) >= 0) { frames.push(JSON.parse(text.slice(0, i))); text = text.slice(i + 1); } });
    broker.stderr.on('data', b => stderr += b); broker.on('exit', (code, signal) => exit = { code, signal });
    broker.stdin.on('error', () => {});
    try {
      await until(() => frames.length > 0 || exit, 'missing suspended fact'); assert.equal(exit, undefined);
      assert.equal(frames[0].phase, 'suspended'); assert.equal(frames[0].active, 1); assert.ok(BigInt(frames[0].creationFileTime) > 0n);
      await sleep(200); assert.equal(existsSync(join(work, 'pids.json')), false, 'child executed before resume');
      if (mode === 'stop-before-start') {
        broker.stdin.write('stop-before-start\n'); await until(() => exit !== undefined, 'suspended stop did not settle');
        assert.equal(exit.code, 0); assert.equal(frames.at(-1).phase, 'stopped-before-resume');assert.equal(frames.at(-1).active, 0);
        assert.equal(existsSync(join(work, 'pids.json')), false);assert.equal(alive(frames[0].pid), false);
        results.push({ mode, passed: true, frames, exit, stderr });continue;
      }
      broker.stdin.write('resume\n');
      if(mode === 'dual-output') {
        broker.stdin.write('wait\n');await until(() => exit !== undefined, 'dual output did not settle',15000);
        assert.equal(exit.code,0,stderr);assert.equal(frames.at(-1).exitCode,23);assert.equal(frames.at(-1).active,0);
        const output=frames.find(f=>f.phase==='output');assert.ok(output);
        for(const [channel,prefix] of [['stdout','OUT:'],['stderr','ERR:']]) {
          assert.equal(output[channel].total,300004);assert.equal(output[channel].eof,true);assert.equal(output[channel].truncated,true);
          const kept=Buffer.from(output[channel].base64,'base64');assert.equal(kept.length,1024);assert.equal(kept.subarray(0,4).toString(),prefix);
        }
        results.push({mode,passed:true,frames,exit,stderr});continue;
      }
      await until(() => existsSync(join(work, 'pids.json')), 'descendant not started');
      if(mode==='descendant-held-pipes') {
        broker.stdin.write('root-wait-stop\n');await until(()=>frames.some(f=>f.phase==='root-exited-tree-live')||exit,'missing root exit fact');
        assert.equal(exit,undefined,stderr);const rootExit=frames.find(f=>f.phase==='root-exited-tree-live');assert.equal(rootExit.exitCode,17);assert.equal(rootExit.active,1);assert.equal(rootExit.stdoutDone,false);assert.equal(rootExit.stderrDone,false);
        const ids=JSON.parse(readFileSync(join(work,'pids.json')));assert.equal(alive(ids.root),false);assert.equal(alive(ids.child),true);
        broker.stdin.write('stop\n');await until(()=>exit!==undefined,'held pipe stop did not settle');assert.equal(exit.code,0,stderr);
        assert.equal(frames.at(-1).exitCode,17);assert.equal(frames.at(-1).active,0);await until(()=>!alive(ids.child),'descendant survived stop');
        const output=frames.find(f=>f.phase==='output');assert.equal(output.stdout.eof,true);assert.equal(output.stderr.eof,true);
        results.push({mode,passed:true,frames,exit,ids,stderr});continue;
      }
      const ids = JSON.parse(readFileSync(join(work, 'pids.json'))); assert.equal(ids.root, frames[0].pid); assert.ok(alive(ids.root) && alive(ids.child));
      if (mode === 'stop') broker.stdin.write('stop\n'); else broker.kill();
      await until(() => exit !== undefined, 'broker did not end');
      await until(() => !alive(ids.root) && !alive(ids.child), 'owned tree remained alive');
      if (mode === 'stop') { assert.equal(exit.code, 0); assert.equal(frames.at(-1).active, 0); assert.equal(frames.at(-1).exitCode, 143);assert.ok(frames.find(f=>f.phase==='output')?.stdout.eof);assert.ok(frames.find(f=>f.phase==='output')?.stderr.eof); }
      results.push({ mode, passed: true, frames, exit, ids, stderr });
    } finally { if (!exit) { broker.kill(); await until(() => exit !== undefined, 'owned broker cleanup failed'); } }
  }
  console.log('WINDOWS_JOB_PASS: 5 cases, suspended admission, native identity, whole-job stop, broker crash, bounded dual drain, descendant-held EOF');
} finally {
  writeFileSync(join(root, 'results.json'), JSON.stringify(results, null, 2));
  console.log('WINDOWS_JOB_EVIDENCE=' + root);
}

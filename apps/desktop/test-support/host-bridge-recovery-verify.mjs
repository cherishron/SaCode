import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {fixtureHostEnv} from './fixture-env.mjs';
const require=createRequire(import.meta.url),{HostBridge}=require('../host-bridge.cjs');
assert.ok(process.env.SACODE_HOST&&existsSync(process.env.SACODE_HOST),'必须显式指定 Host');
const host=resolve(process.env.SACODE_HOST),root=mkdtempSync(resolve('apps/desktop/.tmp-test/bridge-recovery-'));
const bridge=new HostBridge(host,fixtureHostEnv(root,{PATH:join(process.env.SystemRoot,'System32'),TMP:root,TEMP:root}));
const facts={root,host,passed:false};
try{
 await bridge.start(root);facts.firstPid=bridge.proc.pid;
 const created=await bridge.request('goal/create',{sessionId:'current',objective:'桥接断连恢复只读验证'});
 const before=await bridge.request('goal/describe',{sessionId:'current'});
 assert.equal(before.id,created.id);assert.equal(before.phase,'active');
 const logBefore=readFileSync(join(root,'session.log'));
 const exit=new Promise(resolveExit=>bridge.proc.once('exit',(code,signal)=>resolveExit({code,signal})));
 bridge.killNow();facts.abruptExit=await exit;
 await assert.rejects(bridge.request('goal/describe',{sessionId:'current'}),/host-gone/);
 await bridge.start(root);facts.secondPid=bridge.proc.pid;assert.notEqual(facts.firstPid,facts.secondPid);
 const recovered=await bridge.request('goal/describe',{sessionId:'current'});
 assert.equal(recovered.id,before.id);assert.equal(recovered.phase,before.phase);
 assert.equal(recovered.roundsDone,0);assert.equal(recovered.activation,'disarmed');
 assert.deepEqual(readFileSync(join(root,'session.log')),logBefore,'只读恢复不能写起轮、重放或授权事实');
 facts.recovered=recovered;facts.gracefulExit=await bridge.stop();assert.equal(facts.gracefulExit.code,0);
 facts.passed=true;console.log('HOST_BRIDGE_RECOVERY_PASS');
}finally{
 if(bridge.proc?.exitCode===null&&bridge.proc?.signalCode===null)facts.cleanup=await bridge.stop();
 const hash=data=>createHash('sha256').update(data).digest('hex');
 writeFileSync(join(root,'manifest.json'),JSON.stringify({hostSha256:hash(readFileSync(host)),bridgeSha256:hash(readFileSync(new URL('../host-bridge.cjs',import.meta.url))),verifierSha256:hash(readFileSync(new URL(import.meta.url))),command:[process.execPath,...process.argv.slice(1)],scope:'真实 Host 异常退出与同一 Node 桥接对象显式重启；不是 Electron GUI 重连'},null,2));
 writeFileSync(join(root,'result.json'),JSON.stringify(facts,null,2));console.log('HOST_BRIDGE_RECOVERY_EVIDENCE='+root);
}

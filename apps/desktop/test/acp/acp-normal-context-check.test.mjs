import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const {verifyPackage,runNormalContextCheck}=createRequire(import.meta.url)('../../../../docs/qa/acp-normal-context-check.cjs');
function candidate(){
 const root=mkdtempSync(join(tmpdir(),'sacode-normal-package-'));
 const names=['runtime/sacode-host.exe','runtime/sacode.exe','apps/desktop/host-bridge.cjs','apps/desktop/paths.cjs','docs/qa/acp-normal-context-check.cjs'];
 for(const name of names){mkdirSync(dirname(join(root,name)),{recursive:true});writeFileSync(join(root,name),'fixture');}
 const manifest={version:1,purpose:'acp-protocol-only',sourceCommit:'a'.repeat(40),files:names.map(path=>({path,sha256:createHash('sha256').update(readFileSync(join(root,path))).digest('hex')}))};
 const save=()=>writeFileSync(join(root,'acp-verification-manifest.json'),JSON.stringify(manifest));save();return{root,manifest,save};
}
test('诊断包拒绝变更载荷、缺失文件和越界清单，不启动宿主',()=>{
 const f=candidate();assert.equal(verifyPackage(f.root).sourceCommit,'a'.repeat(40));
 writeFileSync(join(f.root,'runtime/sacode-host.exe'),'changed');assert.throws(()=>verifyPackage(f.root),/payload-mismatch/);
 const other=candidate();other.manifest.files[0].path='../outside';other.save();assert.throws(()=>verifyPackage(other.root),/manifest-invalid/);
 const missing=candidate();missing.manifest.files.pop();missing.save();assert.throws(()=>verifyPackage(missing.root),/manifest-incomplete/);
});
test('验收客户端经真实Host与受控协议夹具仅作检查，保留未验证边界',{timeout:30000},async()=>{
 assert.ok(process.env.SACODE_HOST,'需要本批Host');const f=candidate();
 copyFileSync(process.env.SACODE_HOST,join(f.root,'runtime/sacode-host.exe'));
 const {readdirSync}=await import('node:fs');for(const name of readdirSync(dirname(process.env.SACODE_HOST)))if(name.endsWith('.dll')){copyFileSync(join(dirname(process.env.SACODE_HOST),name),join(f.root,'runtime',name));f.manifest.files.push({path:'runtime/'+name,sha256:createHash('sha256').update(readFileSync(join(f.root,'runtime',name))).digest('hex')});}
 f.manifest.files[0].sha256=createHash('sha256').update(readFileSync(join(f.root,'runtime/sacode-host.exe'))).digest('hex');f.save();
 writeFileSync(join(f.root,'acp'),"require('node:readline').createInterface({input:process.stdin}).on('line',s=>{const q=JSON.parse(s);let result;if(q.method==='initialize')result={protocolVersion:1,agentCapabilities:{}};else if(q.method==='session/new')result={sessionId:'fixture'};else throw Error('must-not-send-task');console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));});");
 const report=await runNormalContextCheck({root:f.root,workspace:f.root,environment:{...process.env,SACODE_ACP_OPENCODE_EXECUTABLE:process.execPath}});
 assert.equal(report.protocolReady,true);assert.equal(report.scope,'protocol-only');assert.equal(report.modelTaskTested,false);assert.ok(['low','medium','high','system','untrusted'].includes(report.diagnostics.processIntegrity));
 const log=readFileSync(join(report.sessionDirectory,'session.log'),'utf8');assert.equal(log.includes('acp/task/start'),false);
});

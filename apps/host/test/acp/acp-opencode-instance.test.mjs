import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {openCodeInstanceFixture} from '../../../desktop/test-support/opencode-instance-fixture.mjs';
const {HostBridge}=createRequire(import.meta.url)('../../../desktop/host-bridge.cjs');
const options={timeout:60000,skip:process.platform!=='win32'||!process.env.SACODE_ACP_OPENCODE_TEST_EXECUTABLE};
function checked(report){
 assert.equal(report.protocolReady,true);assert.equal(report.modelTaskTested,false);assert.equal(report.diagnosticSaved,true);
 const meta=report.diagnostics.instanceMetadata;assert.ok(meta,'需要安装在隔离配置中的2.0.28只读适配器');
 assert.equal(meta.providerVersion,'2.0.28');assert.equal(meta.source,'opencode-v2-plugin');assert.equal(meta.price,'unknown');
 assert.equal(meta.defaultModel.availability,'listed');assert.ok(meta.agents.items.some(a=>a.availability==='not-listed'&&a.model?.modelId==='missing-fixture-model'));
 assert.equal('nonce' in meta,false);assert.equal(meta.configSources,'not-exposed');return meta;
}
test('真实OpenCode隔离实例经原生CLI读取主模型与Agent差异，不发送模型任务',options,async t=>{
 const f=await openCodeInstanceFixture(t);assert.equal((await f.cli('enable','0')).status,0);
 const result=await f.cli('probe');assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stdout),meta=checked(report);
 assert.equal(meta.directory,f.workspace);assert.equal(f.modelRequests(),0);assert.equal(f.log().includes('acp/task/start'),false);
 assert.equal(readdirSync(f.base).some(name=>name.startsWith('sacode-acp-metadata-')),false);
 const restored=await f.cli('diagnostics');assert.equal(restored.status,0);assert.deepEqual(JSON.parse(restored.stdout).record.report.diagnostics.instanceMetadata,meta);
});
test('真实OpenCode隔离实例经Host持久诊断和保留决定，配置风险不改开关',options,async t=>{
 const f=await openCodeInstanceFixture(t),bridge=new HostBridge(process.env.SACODE_HOST,f.environment);await bridge.start(f.workspace);t.after(()=>bridge.stop(10000));
 await bridge.request('workspace/set-directory',{sessionId:'current',directory:f.workspace});
 await bridge.request('acp/settings/set-enabled',{sessionId:'current',enabled:true,revision:0});
 const report=await bridge.request('acp/provider/probe',{sessionId:'current'},30000);checked(report);
 const history=await bridge.request('acp/diagnostics/describe',{sessionId:'current'});
 await bridge.request('acp/diagnostics/keep',{sessionId:'current',diagnosticId:history.record.diagnosticId,revision:history.record.revision});
 assert.equal((await bridge.request('acp/settings/describe',{sessionId:'current'})).enabled,true);
 assert.equal(f.modelRequests(),0);assert.equal(f.log().includes('acp/task/start'),false);assert.equal((await bridge.stop(10000)).forced,false);
});

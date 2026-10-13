import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const {HostBridge}=createRequire(import.meta.url)('../host-bridge.cjs');

test('真实Host声明五个ACP动作，未装配时明确拒绝而非空成功',{timeout:30000},async t=>{
  assert.ok(process.env.SACODE_HOST,'需要本批源码构建的Host');
  const root=mkdtempSync(join(tmpdir(),'sacode-acp-rpc-'));
  const bridge=new HostBridge(process.env.SACODE_HOST,{...process.env,SACODE_USER_SETTINGS_DIR:join(root,'settings')});
  await bridge.start(root);t.after(()=>bridge.stop());
  const hello=await bridge.request('initialize',{});
  const actions={
    create:{sessionId:'current',taskId:'task',requestId:'request',peerId:'opencode',taskText:'must not execute'},
    poll:{sessionId:'current',delegationId:'d1'},
    answer:{sessionId:'current',delegationId:'d1',approvalId:1,decision:'denied',optionId:'deny'},
    cancel:{sessionId:'current',delegationId:'d1',revision:1},
    close:{sessionId:'current',delegationId:'d1',revision:1},
  };
  for(const [action,args] of Object.entries(actions)){
    const method='acp/delegation/'+action;
    assert.ok(hello.capabilities.includes(method),method);
    await assert.rejects(bridge.request(method,args),/provider-unavailable:acp-runtime-not-attached/);
    await assert.rejects(bridge.request(method,{...args,sessionId:'foreign'}),/not-authorized:acp-session-changed/);
  }
  await bridge.stop();
  const log=existsSync(join(root,'session.log'))?readFileSync(join(root,'session.log'),'utf8'):'';
  assert.equal(log.includes('acp/task/start'),false);assert.equal(log.includes('acp/admission'),false);
});

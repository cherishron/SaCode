import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{HostBridge}=require('../../../desktop/host-bridge.cjs');
const {png}=require('../../../desktop/test-support/image-fixture.cjs');
const wire=value=>'\x1eSaCodeModel/1:'+JSON.stringify(value);

test('真实图片对象随工具结果身份回放，跨会话拒读且正常重启保留',{timeout:30000},async()=>{
  assert.ok(process.env.SACODE_HOST,'必须明确指定本轮Host');
  const root=process.env.SACODE_TEST_ROOT||fileURLToPath(new URL('../../../../target/tmp/tool-image-20261019',import.meta.url));
  mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'run-'));
  const env={...process.env,SACODE_USER_SETTINGS_DIR:join(dir,'settings'),SACODE_PROVIDER_BASE_URL:'',SACODE_PROVIDER_MODEL:'',SACODE_PROVIDER_KEY:''};
  let bridge=new HostBridge(process.env.SACODE_HOST,env);
  const verification={kind:'合成工具wire与真实持久PNG，不是实际桌面截图工具调用',directory:dir};
  try{
    await bridge.start(dir);
    const uploaded=await bridge.request('attachment/upload',{kind:'image',name:'工具截图夹具.png',mediaType:'image/png',data:png.toString('base64')});
    const ref=uploaded.attachment;
    assert.equal((await bridge.stop()).code,0);
    // 构造脱敏日志夹具，不通过只面向用户文本的RPC伪装内部工具事件。
    // 工具身份来自tool/call事件，结果使用生产wire格式；PNG对象仍由真实上传落盘。
    const escape=value=>value.replaceAll('\\','\\\\').replaceAll('\t','\\t').replaceAll('\n','\\n').replaceAll('\r','\\r');
    const call={id:'tool-image-call',type:'function',function:{name:'computer_screenshot',arguments:'{}'}};
    const result=wire({role:'tool',tool_call_id:'tool-image-call',content:'截图引用已保存',attachments:[ref]});
    writeFileSync(join(dir,'session.log'),'0\ttool/call\t'+escape(JSON.stringify(call))+'\n1\ttool/result\t'+escape(result)+'\n');
    bridge=new HostBridge(process.env.SACODE_HOST,env);await bridge.start(dir);
    const check=async()=>{
      const projection=await bridge.request('session/projection');
      const call=projection.toolCalls.find(c=>c.callId==='tool-image-call');
      assert.equal(call.name,'computer_screenshot');assert.equal(call.status,'completed');
      const row=projection.messageRows.find(r=>r.id===call.resultMessageId);
      assert.deepEqual(row.attachments,[ref]);
      assert.equal((await bridge.request('attachment/image-read',{sessionId:'current',attachmentId:ref.attachmentId})).data,png.toString('base64'));
      return {projection,attachment:ref};
    };
    Object.assign(verification,await check());
    const other=(await bridge.request('session/create',{title:'图片隔离'})).id;
    await bridge.request('session/select',{sessionId:other});
    await assert.rejects(bridge.request('attachment/image-read',{sessionId:other,attachmentId:ref.attachmentId}),/attachment-image-not-referenced/);
    await assert.rejects(bridge.request('attachment/image-read',{sessionId:'current',attachmentId:ref.attachmentId}),/attachment-session-changed/);
    await bridge.request('session/select',{sessionId:'current'});
    verification.firstStop=await bridge.stop();assert.equal(verification.firstStop.code,0);assert.equal(verification.firstStop.forced,false);
    bridge=new HostBridge(process.env.SACODE_HOST,env);await bridge.start(dir);
    await check();verification.restarted=true;
  }finally{
    verification.stop=await bridge.stop();
    writeFileSync(join(dir,'verification.json'),JSON.stringify(verification,null,2));
  }
});

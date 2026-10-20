import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {HostBridge}=require('../../../desktop/host-bridge.cjs');
const createFixture=require('../../../desktop/test/support/development-task-fixture.cjs');

test('Windows模型开发任务真实读改及精确审批，命令失败不冒充测试成功',{skip:process.platform!=='win32',timeout:30000},async()=>{
  assert.ok(process.env.SACODE_HOST,'必须明确指定本轮Host');
  const root=process.env.SACODE_TEST_ROOT||fileURLToPath(new URL('../../../../target/tmp/development-task-20261019',import.meta.url));
  mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'run-')),project=join(dir,'project');mkdirSync(project);
  const fixture=await createFixture({project,nodeExecutable:process.execPath});
  const bridge=new HostBridge(process.env.SACODE_HOST,{...process.env,SACODE_USER_SETTINGS_DIR:join(dir,'settings'),SACODE_PROVIDER_BASE_URL:fixture.baseUrl,SACODE_PROVIDER_MODEL:'development-fixture',SACODE_PROVIDER_KEY:'fixture-only'});
  const approvals=[];let result,projection;
  try{
    await bridge.start(dir);await bridge.request('workspace/set-directory',{directory:project});
    await bridge.request('session/submit',{eventType:'user/message',data:'修复sum.cjs相加错误，运行sum.test.cjs，并如实报告测试结算。'});
    await bridge.request('task/start');
    for(let i=0;i<1000;i++){
      result=await bridge.request('turn/poll');
      for(const event of bridge.notifications.filter(n=>n.method==='approval/asked'&&n.params?.source==='model')){
        const ticket=event.params;if(approvals.some(a=>a.id===ticket.approvalId))continue;
        projection=await bridge.request('session/projection');
        const call=projection.toolCalls.find(c=>c.status==='running'&&['edit','pwsh'].includes(c.name));
        assert.ok(call,'待审批必须关联真实运行工具');
        assert.deepEqual(JSON.parse(call.arguments),call.name==='edit'?fixture.edit:{command:fixture.command});
        approvals.push({id:ticket.approvalId,name:call.name,arguments:call.arguments});
        assert.equal((await bridge.request('approval/answer',{approvalId:ticket.approvalId,decision:'allowed-once'})).accepted,true);
      }
      if(result.settled)break;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(result.settled,true);assert.deepEqual(fixture.report().failures,[]);
    assert.equal(readFileSync(join(project,'sum.cjs'),'utf8'),fixture.after);
    assert.deepEqual(approvals.map(a=>a.name),['edit','pwsh']);
    projection=await bridge.request('session/projection');
    const shell=projection.toolCalls.find(c=>c.callId==='dev-test');
    const transcript=projection.messages.join('\n');
    const enforcing=/^(1|true|yes|on)$/i.test(process.env.SACODE_WINDOWS_ENFORCING||'')&&!!process.env.SACODE_WINDOWS_PROCESS_DLL;
    if(enforcing){
      // 显式选择加入 Windows 强制隔离：命令必须真实启动并产生真实结算，不得再折叠成泛化 io-error。
      assert.ok(!transcript.includes('io-error:shell-pwsh'),`强制隔离下命令未真实执行：${transcript}`);
      assert.ok(shell.arguments.includes('sum.test.cjs'),`命令参数必须落到真实 shell 调用：${shell.arguments}`);
      assert.match(result.text,/测试工具实际返回|未取得通过结算/,`必须给出真实命令回执：${result.text}`);
    }else{
      // 默认 fail-closed：沙箱后端缺失时必须安全失败，且 confine 的真实原因必须可归因（不再是裸 io-error）。
      assert.equal(shell.status,'failed');
      assert.match(transcript,/io-error:shell-pwsh/);
      assert.match(transcript,/SANDBOX_UNAVAILABLE/,`confine 真实原因必须透传：${transcript}`);
      assert.match(result.text,/测试未运行|未取得通过结算/);
    }
    assert.equal(fixture.report().requests,4,'安全拒绝后不能重试绕过');
  }finally{
    const stopped=await bridge.stop();
    await fixture.close();
    writeFileSync(join(dir,'verification.json'),JSON.stringify({result,toolCalls:projection?.toolCalls,approvals,provider:fixture.report(),stopped,testExecuted:false},null,2));
  }
});

test('Windows模型开发任务拒绝写入后文件保持不变，Host正常退出',{skip:process.platform!=='win32',timeout:30000},async()=>{
  assert.ok(process.env.SACODE_HOST,'必须明确指定本轮Host');
  const root=process.env.SACODE_TEST_ROOT||fileURLToPath(new URL('../../../../target/tmp/development-task-20261019',import.meta.url));
  mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'reject-')),project=join(dir,'project');mkdirSync(project);
  const fixture=await createFixture({project,nodeExecutable:process.execPath});
  const bridge=new HostBridge(process.env.SACODE_HOST,{...process.env,SACODE_USER_SETTINGS_DIR:join(dir,'settings'),SACODE_PROVIDER_BASE_URL:fixture.baseUrl,SACODE_PROVIDER_MODEL:'development-fixture',SACODE_PROVIDER_KEY:'fixture-only'});
  const approvals=[];let result,projection,stopped;
  try{
    await bridge.start(dir);await bridge.request('workspace/set-directory',{directory:project});
    await bridge.request('session/submit',{eventType:'user/message',data:'修复sum.cjs相加错误，运行sum.test.cjs，并如实报告测试结算。'});
    await bridge.request('task/start');
    for(let i=0;i<1000;i++){
      result=await bridge.request('turn/poll');
      for(const event of bridge.notifications.filter(n=>n.method==='approval/asked'&&n.params?.source==='model')){
        const ticket=event.params;if(approvals.some(a=>a.id===ticket.approvalId))continue;
        projection=await bridge.request('session/projection');
        const call=projection.toolCalls.find(c=>c.status==='running'&&c.name==='edit');
        assert.ok(call,'待审批必须关联真实运行工具');
        approvals.push({id:ticket.approvalId,name:call.name});
        const answer=await bridge.request('approval/answer',{approvalId:ticket.approvalId,decision:'denied'});
        assert.equal(answer.accepted,true,'拒绝也必须被真实受理');
      }
      if(result.settled)break;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(result.settled,true);assert.deepEqual(fixture.report().failures,[]);
    assert.equal(readFileSync(join(project,'sum.cjs'),'utf8'),fixture.before,'拒绝写入后文件必须保持不变');
    assert.deepEqual(approvals.map(a=>a.name),['edit']);
    assert.equal(fixture.report().requests,3,'拒绝后不得重试绕过');
    assert.match(result.text,/测试未运行|未取得通过结算|未成功/);
  }finally{
    stopped=await bridge.stop();await fixture.close();
    writeFileSync(join(dir,'verification.json'),JSON.stringify({result,approvals,provider:fixture.report(),stopped,testExecuted:false},null,2));
  }
  assert.equal(stopped.code,0,'Host必须正常退出');
});

test('Windows模型开发任务bash变体真实读改及精确审批，命令失败携带真实原因',{skip:process.platform!=='win32',timeout:30000},async()=>{
  assert.ok(process.env.SACODE_HOST,'必须明确指定本轮Host');
  const root=process.env.SACODE_TEST_ROOT||fileURLToPath(new URL('../../../../target/tmp/development-task-bash-20261019',import.meta.url));
  mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'run-')),project=join(dir,'project');mkdirSync(project);
  const fixture=await createFixture({project,nodeExecutable:process.execPath,shell:'bash'});
  const bridge=new HostBridge(process.env.SACODE_HOST,{...process.env,SACODE_USER_SETTINGS_DIR:join(dir,'settings'),SACODE_PROVIDER_BASE_URL:fixture.baseUrl,SACODE_PROVIDER_MODEL:'development-fixture',SACODE_PROVIDER_KEY:'fixture-only'});
  const approvals=[];let result,projection;
  try{
    await bridge.start(dir);await bridge.request('workspace/set-directory',{directory:project});
    await bridge.request('session/submit',{eventType:'user/message',data:'修复sum.cjs相加错误，运行sum.test.cjs，并如实报告测试结算。'});
    await bridge.request('task/start');
    for(let i=0;i<1000;i++){
      result=await bridge.request('turn/poll');
      for(const event of bridge.notifications.filter(n=>n.method==='approval/asked'&&n.params?.source==='model')){
        const ticket=event.params;if(approvals.some(a=>a.id===ticket.approvalId))continue;
        projection=await bridge.request('session/projection');
        const call=projection.toolCalls.find(c=>c.status==='running'&&['edit','bash'].includes(c.name));
        assert.ok(call,'待审批必须关联真实运行工具');
        assert.deepEqual(JSON.parse(call.arguments),call.name==='edit'?fixture.edit:{command:fixture.command});
        approvals.push({id:ticket.approvalId,name:call.name,arguments:call.arguments});
        assert.equal((await bridge.request('approval/answer',{approvalId:ticket.approvalId,decision:'allowed-once'})).accepted,true);
      }
      if(result.settled)break;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(result.settled,true);assert.deepEqual(fixture.report().failures,[]);
    assert.equal(readFileSync(join(project,'sum.cjs'),'utf8'),fixture.after);
    assert.deepEqual(approvals.map(a=>a.name),['edit','bash']);
    projection=await bridge.request('session/projection');
    const shell=projection.toolCalls.find(c=>c.callId==='dev-test');
    const transcript=projection.messages.join('\n');
    const enforcing=/^(1|true|yes|on)$/i.test(process.env.SACODE_WINDOWS_ENFORCING||'')&&!!process.env.SACODE_WINDOWS_PROCESS_DLL;
    if(enforcing){
      assert.ok(!transcript.includes('io-error:shell-bash'),`强制隔离下命令未真实执行：${transcript}`);
      assert.ok(shell.arguments.includes('sum.test.cjs'),`命令参数必须落到真实 shell 调用：${shell.arguments}`);
      assert.match(result.text,/测试工具实际返回|未取得通过结算/,`必须给出真实命令回执：${result.text}`);
    }else{
      // 默认 fail-closed：bash 变体同样必须安全失败，且 io-error 携带固定分类原因而非裸码或路径。
      assert.equal(shell.status,'failed');
      assert.match(transcript,/io-error:shell-bash/);
      // 诊断折叠修复后，io-error 必须携带固定分类串（SANDBOX_UNAVAILABLE / process-start-failed 等），
      // 不含本机路径或原始异常文案。
      assert.match(transcript,/io-error:shell-bash:(SANDBOX_UNAVAILABLE|process-start-failed|sandbox-confine-failed|SANDBOX_MODE_NOT_CONFINED|appcontainer-init-failed)/,`bash 变体 io-error 必须携带固定分类原因：${transcript}`);
      // 只检查 io-error 行不含本机路径，而非整个 transcript（正常 tool/result 可能含项目文件路径）。
      const ioErrorLines=transcript.split('\n').filter(l=>l.includes('io-error:shell-bash'));
      assert.doesNotMatch(ioErrorLines.join('\n'),/[A-Z]:[\\/]/,`io-error 行不得泄露本机路径：${ioErrorLines.join('\n')}`);
      assert.match(result.text,/测试未运行|未取得通过结算/);
    }
    assert.equal(fixture.report().requests,4,'安全拒绝后不能重试绕过');
  }finally{
    const stopped=await bridge.stop();
    await fixture.close();
    writeFileSync(join(dir,'verification.json'),JSON.stringify({result,toolCalls:projection?.toolCalls,approvals,provider:fixture.report(),stopped,testExecuted:false},null,2));
  }
});

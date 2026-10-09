import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {HostBridge} from '../host-bridge.cjs';

// 真实宿主的提醒面：四个动词全部落到仓颉核心，界面不留第二份状态。
const host=resolve(process.env.SACODE_HOST||fileURLToPath(new URL('../dist/host/bin/sacode-host.exe',import.meta.url)));

async function boot(){
  const root=mkdtempSync(join(tmpdir(),'sacode-tips-host-'));
  const settings=join(root,'user-settings');
  const bridge=new HostBridge(host,{...process.env,SACODE_USER_SETTINGS_DIR:settings,SACODE_PROVIDER_KEY:'',SACODE_PROVIDER_BASE_URL:''});
  await bridge.start(root);
  return {bridge,root,settings};
}

test('宿主声明并使用提醒动词，隐藏开关跨进程留存',async()=>{
  const {bridge,root,settings}=await boot();
  try{
    const init=await bridge.request('initialize');
    for(const verb of ['tips/get','tips/startup','tips/after-reply','tips/set-hidden']){
      assert.ok(init.capabilities.includes(verb),`initialize 未声明 ${verb}`);
    }
    const first=await bridge.request('tips/startup',{accessibility:false});
    assert.equal(first.id,'read',`首个会话应落在新手阶段第一条（实际 ${JSON.stringify(first)}）`);
    assert.ok(first.text.length>0&&!first.text.includes('%s'),'文案必须已填好占位');
    const second=await bridge.request('tips/startup',{accessibility:false});
    assert.notEqual(second.id,first.id,'连续两次取到同一条就不算轮换');

    // 没有可靠分子时不许编一个比例出来。
    const state=await bridge.request('tips/get',{accessibility:false});
    assert.equal(state.reliable,false);
    assert.equal(state.percent,-1);
    assert.equal((await bridge.request('tips/after-reply',{accessibility:false})).id,'','无读数时容量提醒必须闭嘴');

    // 读屏声明下同样空手，且不消耗历史。
    assert.equal((await bridge.request('tips/startup',{accessibility:true})).id,'');

    await bridge.request('tips/set-hidden',{accessibility:false,hidden:true});
    assert.equal((await bridge.request('tips/get',{accessibility:false})).hidden,true);
    assert.equal((await bridge.request('tips/startup',{accessibility:false})).id,'');
    await bridge.stop();

    await bridge.start(root);
    assert.equal((await bridge.request('tips/get',{accessibility:false})).hidden,true,'重启后隐藏偏好必须还在');
    const restored=await bridge.request('tips/set-hidden',{accessibility:false,hidden:false});
    assert.equal(restored.hidden,false);
    assert.ok((await bridge.request('tips/startup',{accessibility:false})).id.length>0,'重新打开立刻恢复');
    await bridge.stop();

    const history=join(settings,'tips-history.log');
    assert.ok(existsSync(history),'展示历史应落在用户设置目录');
    assert.ok(!readFileSync(history,'utf8').includes('user/message'),'历史文件里不得混入会话内容');
    const sessionLog=join(root,'session.log');
    if(existsSync(sessionLog)){
      assert.ok(!readFileSync(sessionLog,'utf8').includes('tips/'),'提醒不得写进会话日志');
    }
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('提醒参数守空：缺 hidden 直接回结构化错误',async()=>{
  const {bridge,root}=await boot();
  try{
    await assert.rejects(()=>bridge.request('tips/set-hidden',{accessibility:false}),/bad-tips-params/);
    // 参数被拒后状态不得半改：仍然可读，且隐藏态没被这次失败请求动过。
    assert.equal((await bridge.request('tips/get',{accessibility:false})).hidden,false);
  } finally { await bridge.stop(); rmSync(root,{recursive:true,force:true}); }
});

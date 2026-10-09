import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';

const root = path.resolve(import.meta.dirname, '../../..');
const daemonExe = process.env.SACODE_DAEMON || path.join(root, 'apps/daemon/target/release/bin/main.exe');
const hostExe = process.env.SACODE_HOST || path.join(root, 'apps/desktop/dist/team-recheck/bin/sacode-host.exe');
const env = {...process.env, SACODE_HOST: hostExe};
const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
env[pathKey] = ['C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx', 'D:/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative', env[pathKey]].join(path.delimiter);

async function withDaemon(run, host = hostExe, providerEnv = {}) {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-team-daemon-'));
  const proc = spawn(daemonExe, ['--port', '0'], {cwd, env:{...env, ...providerEnv, SACODE_USER_SETTINGS_DIR:path.join(cwd,'settings'), SACODE_HOST:host}, stdio:['ignore', 'pipe', 'pipe']});
  let out = '', err = '';
  let shutdown;
  proc.stdout.on('data', d => {out += d;});
  proc.stderr.on('data', d => {err += d;});
  const closed = new Promise(resolve => proc.on('close', resolve));
  try {
    const end = Date.now() + 10000;
    while (!/127\.0\.0\.1:(\d+)/.test(out) && proc.exitCode === null && Date.now() < end) await delay(20);
    assert.match(out, /127\.0\.0\.1:(\d+)/, err);
    const port = Number(out.match(/127\.0\.0\.1:(\d+)/)[1]);
    let id = 0;
    const rpc = async (method, params = {}, requestId = `client-${++id}`) => {
      const response = await fetch(`http://127.0.0.1:${port}/rpc`, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({jsonrpc:'2.0', id:requestId, method, params}), signal:AbortSignal.timeout(10000)});
      const body = await response.json();
      assert.equal(body.id, requestId, '内部请求编号不得泄漏');
      return body;
    };
    shutdown = () => rpc('daemon/shutdown');
    await run({rpc, cwd, port});
    const stopped = await shutdown();
    assert.equal(stopped.result.ok, true);
    await Promise.race([closed, delay(5000).then(() => {throw new Error('daemon 未优雅关闭');})]);
    assert.equal(proc.exitCode, 0, err);
  } finally {
    if (proc.exitCode === null && shutdown) {
      try { await shutdown(); await Promise.race([closed, delay(5000)]); } catch {}
    }
    if (proc.exitCode === null) proc.kill();
    if(host.includes('team-handshake-probe')) {
      try {process.kill(Number(await readFile(path.join(cwd,'fixture.pid'),'utf8')));} catch {}
    }
    await closed;
    await rm(cwd, {recursive:true, force:true});
  }
}

test('会话与团队共享同一宿主的当前会话与写租约', {timeout:30000}, async () => {
  await withDaemon(async ({rpc}) => {
    const initialized=await rpc('initialize');
    assert.ok(initialized.result.capabilities.includes('session/create'));
    const created=await rpc('session/create',{title:'统一宿主会话'});
    assert.equal(created.error,undefined,JSON.stringify(created));
    const sessionId=created.result.id;
    assert.ok(sessionId);
    const selected=await rpc('session/select',{sessionId});
    assert.equal(selected.error,undefined,JSON.stringify(selected));
    const described=await rpc('team/describe',{teamSessionId:sessionId});
    assert.equal(described.error,undefined,JSON.stringify(described));
    const workspace=await rpc('workspace/get');
    assert.equal(workspace.result.sessionId,sessionId);
    const task=await rpc('team/task/create',{teamSessionId:sessionId,title:'同一宿主团队任务',dependencies:[]});
    assert.ok(task.result.taskId);
    const flushed=await rpc('session/flush');
    assert.equal(flushed.error,undefined,JSON.stringify(flushed));
  });
});

test('握手超时会收束本次启动的宿主进程，不遗留存活子进程', {timeout:25000}, async () => {
  const fixture=path.join(root,'target/team-handshake-probe/target/release/bin/main.exe');
  let pid;
  try {
    await withDaemon(async ({rpc,cwd}) => {
      const rejected=await rpc('initialize');
      assert.ok(rejected.error);
      pid=Number(await readFile(path.join(cwd,'fixture.pid'),'utf8'));
      let alive=true;
      try {process.kill(pid,0);} catch {alive=false;}
      if(alive) {process.kill(pid);}
      assert.equal(alive,false,'握手失败后宿主仍存活');
    },fixture);
  } finally {
    if(pid) {try {process.kill(pid);} catch {}}
  }
});

test('宿主拒绝退出时 daemon 有界收束自持进程并成功退出', {timeout:25000}, async () => {
  const fixture=path.join(root,'target/team-handshake-probe/target/release/bin/main.exe');
  let pid;
  try {
    await withDaemon(async ({rpc,cwd}) => {
      assert.ok((await rpc('initialize')).result);
      pid=Number(await readFile(path.join(cwd,'fixture.pid'),'utf8'));
    },fixture,{SACODE_FIXTURE_MODE:'shutdown'});
    let alive=true; try {process.kill(pid,0);} catch {alive=false;}
    assert.equal(alive,false);
  } finally {if(pid) {try {process.kill(pid);} catch {}}}
});

test('慢宿主的团队请求达到上限后立即回压，不无限积压', {timeout:25000}, async () => {
  const fixture=path.join(root,'target/team-handshake-probe/target/release/bin/main.exe');
  await withDaemon(async ({rpc}) => {
    assert.ok((await rpc('initialize')).result);
    const requests=Array.from({length:40},()=>rpc('team/describe',{teamSessionId:'current'}));
    const replies=await Promise.all(requests);
    assert.ok(replies.some(reply=>reply.error?.message.includes('team-host-too-many-inflight')),'没有任何请求因达到在途上限被拒绝');
  },fixture,{SACODE_FIXTURE_MODE:'shutdown'});
});

test('daemon 拒绝超过1MiB的请求体且继续响应正常请求', {timeout:15000}, async () => {
  await withDaemon(async ({rpc,port}) => {
    const response=await fetch(`http://127.0.0.1:${port}/rpc`, {method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{text:'x'.repeat(1048576)}})});
    const rejected=await response.json();
    assert.equal(rejected.error.code,-32600);
    assert.match(rejected.error.message,/request-body-too-large/);
    assert.ok((await rpc('initialize')).result);
  }, '');
});

test('真实 CLI 经 daemon 创建团队任务并读取宿主持久事实', {timeout:30000}, async () => {
  const cliExe = process.env.SACODE_CLI || path.join(root,'apps/cli/target/release/bin/main.exe');
  await withDaemon(async ({rpc, cwd, port}) => {
    const run = args => new Promise((resolve, reject) => {
      const child = spawn(cliExe, ['team', ...args, '--remote', String(port), '--session', 'current'], {cwd, env, stdio:['ignore','pipe','pipe']});
      let stdout='', stderr='';
      const timer=setTimeout(() => {child.kill();reject(new Error('CLI 团队请求超时'));},12000);
      child.stdout.on('data',d=>{stdout+=d;}); child.stderr.on('data',d=>{stderr+=d;});
      child.on('error',e=>{clearTimeout(timer);reject(e);});
      child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
    });
    const created=await run(['task-create','--title','CLI 真实持久任务']);
    assert.equal(created.code,0,created.stderr);
    const taskId=JSON.parse(created.stdout).result.taskId;
    const described=await run(['describe']);
    assert.equal(described.code,0,described.stderr);
    assert.ok(JSON.parse(described.stdout).result.tasks.some(t=>t.id===taskId&&t.title==='CLI 真实持久任务'));
    const view=await rpc('team/describe',{teamSessionId:'current'});
    assert.ok(view.result.tasks.some(t=>t.id===taskId));
    assert.ok((await readFile(path.join(cwd,'.sacode-teams/current/session.log'),'utf8')).includes('CLI 真实持久任务'));
  });
});

test('daemon 未配置宿主保持原能力表并明确拒绝团队请求，转义编号不丢失', {timeout:15000}, async () => {
  await withDaemon(async ({rpc}) => {
    const initialized = await rpc('initialize', {}, '中文"编号\\尾');
    assert.deepEqual(initialized.result.capabilities, ['initialize', 'session/catalog']);
    const rejected = await rpc('team/describe', {teamSessionId:'current'}, -17);
    assert.match(rejected.error.message, /SACODE_HOST/);
    const unknown = await rpc('arbitrary/method');
    assert.equal(unknown.error.code, -32601);
  }, '');
});

test('daemon SSE 转发真实成员审批，精确应答后任务才能完成', {timeout:40000}, async () => {
  const provider = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const prior = body.messages.filter(m => m.role === 'tool').length;
    const name = prior === 0 ? 'team_task_claim' : 'team_task_complete';
    const args = prior === 0 ? {taskId:'task-1'} : {taskId:'task-1', result:'远程审批完成'};
    const delta = prior < 2 ? {tool_calls:[{index:0,id:`call-${prior}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]} : {content:'结束'};
    res.writeHead(200, {'content-type':'text/event-stream'});
    res.end('data: '+JSON.stringify({choices:[{index:0,delta,finish_reason:prior < 2 ? 'tool_calls' : 'stop'}]})+'\n\n'+'data: [DONE]\n\n');
  });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  try {
    await withDaemon(async ({rpc, port}) => {
      await rpc('initialize');
      const controller = new AbortController();
      const response = await fetch(`http://127.0.0.1:${port}/sse`, {signal:controller.signal});
      const reader = response.body.getReader();
      const frames = [];
      const drain = (async () => {
        const decoder = new TextDecoder(); let buffered = '';
        try {
          while (true) {
            const chunk = await reader.read(); if (chunk.done) break;
            buffered += decoder.decode(chunk.value, {stream:true});
            while (buffered.includes('\n\n')) {
              const end = buffered.indexOf('\n\n'); const block = buffered.slice(0,end); buffered = buffered.slice(end+2);
              if (block.startsWith('data: ')) frames.push(JSON.parse(block.slice(6)));
            }
          }
        } catch (e) { if (!controller.signal.aborted) throw e; }
      })();
      try {
        const member = (await rpc('team/member/create', {teamSessionId:'current',name:'远程审批成员',role:'worker'})).result;
        const task = (await rpc('team/task/create', {teamSessionId:'current',title:'需人工审批',dependencies:[]})).result;
        await rpc('team/task/assign', {teamSessionId:'current',taskId:task.taskId,memberId:member.memberId});
        for (const tool of ['team_task_claim','team_task_complete']) {
          const end = Date.now()+12000;
          while (!frames.some(f => f.method === 'approval/asked' && f.params.tool === tool) && Date.now()<end) await delay(20);
          const notice = frames.find(f => f.method === 'approval/asked' && f.params.tool === tool);
          assert.ok(notice, `SSE 未收到 ${tool}；快照=${JSON.stringify(await rpc('team/describe',{teamSessionId:'current'}))}；帧=${JSON.stringify(frames)}`);
          assert.equal(notice.params.memberId, member.memberId);
          const pending = (await rpc('team/describe',{teamSessionId:'current'})).result;
          assert.notEqual(pending.tasks[0].status, 'completed');
          const answered = await rpc('team/approval/answer',{teamSessionId:'current',memberId:member.memberId,approvalId:notice.params.approvalId,decision:'allowed-once'});
          assert.equal(answered.result.accepted, true);
        }
        const end = Date.now()+10000; let view;
        do { view=(await rpc('team/describe',{teamSessionId:'current'})).result; if(view.tasks[0].status==='completed')break; await delay(20); } while(Date.now()<end);
        assert.equal(view.tasks[0].result, '远程审批完成');
      } finally {controller.abort(); await drain;}
    }, hostExe, {SACODE_PROVIDER_BASE_URL:`http://127.0.0.1:${provider.address().port}`,SACODE_PROVIDER_MODEL:'team-fixture',SACODE_PROVIDER_KEY:'test-only-key'});
  } finally {provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve));}
});

test('daemon 团队 RPC 调用真实宿主并写入同一持久后端', {timeout:30000}, async () => {
  await withDaemon(async ({rpc, cwd}) => {
    const initial = await rpc('initialize');
    assert.ok(initial.result.capabilities.includes('team/describe'));
    const described = await rpc('team/describe', {teamSessionId:'current'});
    assert.equal(described.error, undefined, JSON.stringify(described));
    assert.ok(Array.isArray(described.result.members));
    const added = await rpc('team/member/create', {teamSessionId:'current', name:'远程成员', role:'worker'});
    assert.ok(added.result.memberId);
    const task = await rpc('team/task/create', {teamSessionId:'current', title:'远程真实任务', dependencies:[]});
    assert.ok(task.result.taskId);
    const view = await rpc('team/describe', {teamSessionId:'current'}, -17);
    assert.ok(view.result.members.some(m => m.id === added.result.memberId));
    assert.ok(view.result.tasks.some(t => t.id === task.result.taskId && t.status === 'pending'));
    const log = await readFile(path.join(cwd, '.sacode-teams/current/session.log'), 'utf8');
    assert.ok(log.includes('远程真实任务'));
    const denied = await rpc('team/task/complete', {teamSessionId:'current', taskId:task.result.taskId, result:'领导不能代交', actorSessionId:added.result.sessionId});
    assert.ok(denied.error);
    const unknown = await rpc('arbitrary/method');
    assert.equal(unknown.error.code, -32601);
    const concurrent = await Promise.all([rpc('team/task/create', {teamSessionId:'current',title:'并发甲',dependencies:[]}, 'same'), rpc('team/task/create', {teamSessionId:'current',title:'并发乙',dependencies:[]}, 'same')]);
    assert.notEqual(concurrent[0].result.taskId, concurrent[1].result.taskId);
  });
});

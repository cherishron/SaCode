import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

// 远程执行门禁（任务 4 的 Windows 半）在真 HTTP 面上的行为。
//
// 计划第 3 条要求的是「拒绝远程执行」而不是「把 enforcement 字符串改成好看的」，
// 所以这里验的是三件可观察的事：
//   ① 契约里 permission == execute 的那一族，认证过后仍被拒，拒因点名门禁本身；
//   ② 同一时刻 read/write 面照常工作——否则这条红是「 blanket 拒绝」换来的假绿；
//   ③ initialize 宣告的 sandboxEnforcement 与①用的是同一个值（宣告与分派同源）。
// 未认证的请求必须只拿到认证拒因，不能因为门禁在前就泄露策略差异。
const root = path.resolve(import.meta.dirname, '../../..');
const daemonExe = process.env.SACODE_DAEMON || path.join(root, 'apps/daemon/target/release/bin/main.exe');
const policyFile = path.join(root, 'docs/plans/remote-capability-contract.json');
const baseEnv = { ...process.env };
const pathKey = Object.keys(baseEnv).find(k => k.toLowerCase() === 'path') || 'PATH';
baseEnv[pathKey] = [
  process.env.SACODE_STDX_DLL_DIR || 'C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx',
  process.env.SACODE_RUNTIME_DLL_DIR || 'D:/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative',
  baseEnv[pathKey],
].join(path.delimiter);

const delay = ms => new Promise(r => setTimeout(r, ms));
const SANDBOX_REASON = 'sandbox-enforcement-unavailable';

// 名单回到契约本身取，不在这份测试里另抄一份——抄了就是一处会漂移的第二真源。
const contract = await readFile(policyFile, 'utf8').then(t => JSON.parse(t));
const EXECUTE_METHODS = contract.filter(c => c.permission === 'execute').map(c => c.method).sort();

async function boot(dir, extraEnv = {}) {
  const identity = path.join(dir, 'instance.id');
  const snapshot = `${identity}.devices.json`;
  const proc = spawn(daemonExe, ['--port', '0'], {
    cwd: dir,
    env: {
      ...baseEnv,
      SACODE_USER_SETTINGS_DIR: path.join(dir, 'settings'),
      SACODE_REMOTE_ACCESS: '1',
      SACODE_REMOTE_IDENTITY: identity,
      SACODE_REMOTE_POLICY: policyFile,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { err += d; });
  const end = Date.now() + 20000;
  while (!/127\.0\.0\.1:(\d+)/.test(out) && proc.exitCode === null && Date.now() < end) await delay(20);
  assert.match(out, /127\.0\.0\.1:(\d+)/, `daemon 未监听：stdout=${out} stderr=${err}`);
  const port = Number(out.match(/127\.0\.0\.1:(\d+)/)[1]);
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const post = (p, body, headers = {}) => fetch(url(p), {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body,
    signal: AbortSignal.timeout(10000),
  });
  const rpc = async (method, params = {}, headers = {}) => {
    const r = await post('/rpc', JSON.stringify({ jsonrpc: '2.0', id: 'gate-1', method, params }), headers);
    return { status: r.status, body: await r.text() };
  };
  // 建票必须在启动之后：放在启动前会被 loadSnapshot 顺带捞到，钉不住活路径。
  const ticket = await createTicket(snapshot, 'p-mobile');
  const enroll = await (await post('/auth/enroll',
    JSON.stringify({ enrollmentSecret: ticket, deviceName: 'gate-phone', kind: 'mobile' }))).json();
  const tok = await (await post('/auth/token',
    JSON.stringify({ deviceId: enroll.deviceId, credential: enroll.credential }))).json();
  const bearer = { authorization: `Bearer ${tok.accessToken}` };
  return { proc, rpc, post, bearer, identity, snapshot, err: () => err };
}

async function createTicket(snapshot, principal) {
  const proc = spawn(daemonExe, ['--manage', 'enroll-ticket', snapshot, principal], {
    env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { err += d; });
  // 有界等待：建票进程挂在并发负载下时，本条用例要红得能归因，而不是把整个
  // 测试文件冻在这儿（2026-10-10 并行跑远程全套时就是这样冻住的）。
  const code = await waitForExit(proc, 15000);
  assert.notEqual(code, null, `本地管理入口建票未在 15s 内退出：${err}`);
  assert.equal(code, 0, `本地管理入口建票失败 rc=${code}：${err}`);
  const lines = out.replace(/\r/g, '').trim().split('\n');
  const ticket = lines[lines.length - 1].trim();
  assert.match(ticket, /^[0-9a-f]{32}$/);
  return ticket;
}

async function waitForExit(proc, budgetMs) {
  const end = Date.now() + budgetMs;
  while (proc.exitCode === null && proc.signalCode === null && Date.now() < end) await delay(25);
  return proc.exitCode === null && proc.signalCode === null ? null : proc.exitCode;
}

// kill 是异步的，而 'close' 还要等 stdio 管道全关——daemon 名下有继承句柄的子孙时
// 那个事件可能永远不来，所以这里自己轮询退出态，超时再升级 SIGKILL，绝不无界等待。
async function stopDaemon(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill();
  let code = await waitForExit(proc, 4000);
  if (code === null && proc.exitCode === null && proc.signalCode === null) {
    proc.kill('SIGKILL');
    await waitForExit(proc, 4000);
  }
}

async function removeDir(dir) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await rm(dir, { recursive: true, force: true }); return; }
    catch (e) {
      if (e.code !== 'EBUSY' && e.code !== 'EPERM' && e.code !== 'ENOTEMPTY') throw e;
      await delay(150);
    }
  }
}

async function withDaemon(run) {
  const dir = await mkdtemp(path.join(root, 'target', 'sacode-exec-gate-'));
  let d = null;
  try {
    // boot 放进 try：它自己失败（daemon 没起来）时留下的进程与目录也得收，
    // 否则孤儿 daemon 会占住下一轮的快照。
    d = await boot(dir);
    return await run(d, dir);
  } finally {
    await stopDaemon(d ? d.proc : null);
    await removeDir(dir);
  }
}

test('契约里 execute 一族在没有 OS 强制后端时被整族拒绝', async () => {
  assert.equal(EXECUTE_METHODS.length, 8, `execute 一族应为 8 条，实得 ${JSON.stringify(EXECUTE_METHODS)}`);
  await withDaemon(async (d) => {
    for (const method of EXECUTE_METHODS) {
      const r = await d.rpc(method, { workspaceId: 'ws-1', sessionId: 's-1', operationId: `op-${method}` }, d.bearer);
      assert.equal(r.status, 200, `${method} 的 HTTP 层不该被门禁改动：${r.body}`);
      const doc = JSON.parse(r.body);
      assert.ok(doc.error, `${method} 必须被拒，实得 ${r.body}`);
      assert.equal(doc.error.code, -32001, `${method} 的拒因类别不对：${r.body}`);
      assert.equal(doc.error.message, `authz-denied:${SANDBOX_REASON}`,
        `${method} 要点名执行门禁，不能退回 scope 或 not-registered：${r.body}`);
    }
  });
});

test('门禁不是整面拒绝：read 与 write 照旧走到分派', async () => {
  await withDaemon(async (d) => {
    // session/catalog 需要显式 workspaceId（批次 I 实测：不带就吃 workspace-required），
    // 这里要的是「read 面照常能用」，所以把归属字段带上。
    const read = await d.rpc('session/catalog', { workspaceId: 'ws-1' }, d.bearer);
    const readDoc = JSON.parse(read.body);
    assert.ok(readDoc.result, `read 面必须照常可用，否则上面那条红是 blanket 拒绝：${read.body}`);
    assert.ok(!read.body.includes(SANDBOX_REASON), `read 面不该吃到门禁拒因：${read.body}`);

    const write = await d.rpc('session/create', { workspaceId: 'ws-1' }, d.bearer);
    assert.ok(!write.body.includes(SANDBOX_REASON),
      `write 面按契约不在门禁范围内（它的风险由归属与审批面管）：${write.body}`);
  });
});

test('未认证的 execute 请求只拿到认证拒因，不透露门禁存在', async () => {
  await withDaemon(async (d) => {
    const r = await d.rpc('execution/start', { workspaceId: 'ws-1', operationId: 'op-anon' });
    assert.ok(r.body.includes('missing-bearer'), `未认证要先归认证：${r.body}`);
    assert.ok(!r.body.includes(SANDBOX_REASON),
      `匿名请求不应读出「这台机器缺沙箱后端」这种策略信息：${r.body}`);
  });
});

test('initialize 宣告的 sandboxEnforcement 与门禁同源，且带 instanceId', async () => {
  await withDaemon(async (d, dir) => {
    const init = await d.rpc('initialize', {}, d.bearer);
    const doc = JSON.parse(init.body);
    const announce = doc.result.sandboxEnforcement;
    assert.ok(announce, `initialize 必须宣告 sandboxEnforcement：${init.body}`);
    assert.equal(announce.enforcing, false, `本构建没有 OS 强制后端，宣告不能是 true：${init.body}`);
    assert.equal(announce.mode, 'none');
    assert.ok(announce.limitations.some(l => l.includes('file')),
      `限制清单必须点名文件隔离：${JSON.stringify(announce)}`);
    assert.ok(announce.limitations.some(l => l.includes('network')),
      `限制清单必须点名网络隔离：${JSON.stringify(announce)}`);
    assert.match(doc.result.instanceId, /^[0-9a-f]{32}$/,
      `instanceId 要真是那份身份，不能是空串占位：${init.body}`);
    const onDisk = (await readFile(path.join(dir, 'instance.id'), 'utf8')).trim();
    assert.equal(doc.result.instanceId, onDisk, '宣告的 instanceId 必须与磁盘身份一致');

    // 宣告与行为必须互相咬住：说 enforcing=false，那 execute 就一定被拒。
    const exec = await d.rpc('execution/start', { workspaceId: 'ws-1', operationId: 'op-pair' }, d.bearer);
    assert.ok(exec.body.includes(SANDBOX_REASON),
      `宣告 false 却放行 execute，说明两处各写各的：${exec.body}`);
  });
});

test('拒绝不建幂等账、审计记录拒因但不带 params 值', async () => {
  await withDaemon(async (d, dir) => {
    const sentinel = 'SENTINEL-params-must-not-leak';
    const first = await d.rpc('task/start',
      { workspaceId: 'ws-1', operationId: 'op-once', prompt: sentinel }, d.bearer);
    const second = await d.rpc('task/start',
      { workspaceId: 'ws-1', operationId: 'op-once', prompt: sentinel }, d.bearer);
    assert.equal(first.body, second.body,
      `同一 operationId 两次结果必须一致：门禁若在建账之后，第二次会变成重放或冲突`);
    assert.ok(first.body.includes(SANDBOX_REASON), `两次都该是门禁拒：${first.body}`);

    const auditFile = (await readFile(path.join(dir, 'instance.id.audit.log'), 'utf8')).replace(/\r/g, '');
    assert.ok(auditFile.includes(SANDBOX_REASON), `拒绝要落审计：${auditFile.slice(-400)}`);
    assert.ok(!auditFile.includes(sentinel), '审计里不得出现 params 值');
    assert.ok(!auditFile.includes('Bearer'), '审计里不得出现认证头');
  });
});

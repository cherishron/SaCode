import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

// 服务端幂等账（设计 §5）的端到端反证：跑的是**真宿主**，副作用是真会话与真事件。
// 静态对账能证明「白名单里有这条」，证明不了「同一次操作只发生一次」，
// 所以这里用宿主自己的回执计数器（session/submit 的 result.events）和
// session/catalog 的条目数当观测量，并且每条重放用例都配一个
// 「换个 operationId 就会 +1」的阳性对照——否则「没变」也可能是根本没在跑。
const root = path.resolve(import.meta.dirname, '../../..');
const daemonExe = process.env.SACODE_DAEMON || path.join(root, 'apps/daemon/target/release/bin/main.exe');
const hostExe = process.env.SACODE_HOST_EXE || path.join(root, 'apps/desktop/dist/host/bin/sacode-host.exe');
const policyFile = path.join(root, 'docs/plans/remote-capability-contract.json');
const baseEnv = { ...process.env };
const pathKey = Object.keys(baseEnv).find(k => k.toLowerCase() === 'path') || 'PATH';
baseEnv[pathKey] = [
  process.env.SACODE_STDX_DLL_DIR || 'C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx',
  process.env.SACODE_RUNTIME_DLL_DIR || 'D:/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative',
  baseEnv[pathKey],
].join(path.delimiter);

const delay = ms => new Promise(r => setTimeout(r, ms));

// 刚 SIGKILL 的子进程还短暂占着夹具目录，立刻 rmdir 会 EBUSY——那是清理时序不是被测面。
async function rmBounded(dir) {
  const until = Date.now() + 8000;
  for (;;) {
    try { await rm(dir, { recursive: true, force: true }); return; }
    catch (e) { if (Date.now() >= until) throw e; await delay(200); }
  }
}

function requireExes() {
  assert.ok(existsSync(hostExe), `需要真实宿主产物：${hostExe} 不存在。先跑 node scripts/pack-host.mjs（记 BLOCKED，不是跳过）`);
  assert.ok(existsSync(daemonExe), `需要 daemon 产物：${daemonExe} 不存在。先跑 cd apps/daemon && cjpm build`);
}

async function boot(cwd) {
  requireExes();
  const ws = cwd.replace(/\\/g, '/');
  const proc = spawn(daemonExe, ['--port', '0'], {
    cwd,
    env: {
      ...baseEnv,
      SACODE_USER_SETTINGS_DIR: path.join(cwd, 'settings'),
      SACODE_REMOTE_ACCESS: '1',
      SACODE_REMOTE_IDENTITY: path.join(cwd, 'instance.id'),
      SACODE_REMOTE_POLICY: policyFile,
      SACODE_HOST: hostExe,
      SACODE_HOST_ARGS: JSON.stringify(['--workspace', ws]),
      SACODE_HOST_TIMEOUT_MS: '20000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { err += d; });
  const until = Date.now() + 20000;
  while (!/127\.0\.0\.1:(\d+)/.test(out) && proc.exitCode === null && Date.now() < until) await delay(20);
  assert.match(out, /127\.0\.0\.1:(\d+)/, `daemon 未监听：stdout=${out} stderr=${err}`);
  const port = Number(out.match(/127\.0\.0\.1:(\d+)/)[1]);
  const api = {
    ws,
    stderr: () => err,
    stop: async () => {
      const closed = new Promise(resolve => proc.on('close', resolve));
      proc.kill('SIGKILL');
      await Promise.race([closed, delay(3000)]);
    },
    url: p => `http://127.0.0.1:${port}${p}`,
  };
  return api;
}

// 建票走本机管理入口（网络面只有 /auth/enroll 与 /auth/token），principal 由调用方给，
// 好让「两台设备用同名 operationId」这条用例真的拿到两个 principalId。
async function device(d, cwd, principal, name) {
  const created = await new Promise(resolve => {
    const p = spawn(daemonExe, ['--manage', 'enroll-ticket', `${cwd}/instance.id.devices.json`, principal], { cwd, env: baseEnv });
    let o = '';
    let e = '';
    p.stdout.on('data', x => { o += x; });
    p.stderr.on('data', x => { e += x; });
    p.on('close', code => resolve({ code, o, e }));
  });
  assert.equal(created.code, 0, `建票应成功：${created.e}`);
  const ticket = created.o.replace(/\r/g, '').trim().split('\n')[1];
  const dev = JSON.parse(await (await fetch(d.url('/auth/enroll'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enrollmentSecret: ticket, deviceName: name, kind: 'desktop' }),
    signal: AbortSignal.timeout(15000),
  })).text());
  const tok = JSON.parse(await (await fetch(d.url('/auth/token'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: dev.deviceId, credential: dev.credential }),
    signal: AbortSignal.timeout(15000),
  })).text());
  return { bearer: `Bearer ${tok.accessToken}`, deviceId: dev.deviceId };
}

async function rpc(d, bearer, method, params, id) {
  const r = await fetch(d.url('/rpc'), {
    method: 'POST',
    headers: { authorization: bearer, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 交给断言去红 */ }
  assert.ok(json, `${method} #${id} 应答不是 JSON：${text.slice(0, 300)} stderr=${d.stderr().slice(0, 300)}`);
  return json;
}

async function catalogCount(d, bearer, ws) {
  // session/catalog 在契约里就带 workspaceId 资源键，空 params 会先被授权拒（-32001），
  // 那是夹具漏传，不是被测面。
  const r = await rpc(d, bearer, 'session/catalog', { workspaceId: ws }, 'cat');
  assert.ok(Array.isArray(r.result?.entries), `session/catalog 应答形状变了：${JSON.stringify(r).slice(0, 300)}`);
  return r.result.entries.length;
}

test('durable 写缺 operationId 在打到宿主之前就被拒，宿主侧一条会话都没建', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-idem-opid-'));
  const d = await boot(cwd);
  try {
    const { bearer } = await device(d, cwd, 'p-opid', 'opid');
    assert.equal(await catalogCount(d, bearer, d.ws), 0);
    const r = await rpc(d, bearer, 'session/create', { workspaceId: d.ws, title: 'no-op-id' }, 'k-1');
    assert.equal(r.error.code, -32017, `缺 operationId 必须按「账本没放行」回：${JSON.stringify(r)}`);
    assert.match(r.error.message, /operation-id-required/);
    // 阳性对照：补上 operationId 就真建出一条——证明上面那条不是宿主没在跑。
    const ok = await rpc(d, bearer, 'session/create', { workspaceId: d.ws, title: 'with-op-id', operationId: 'op-opid-1' }, 'k-2');
    assert.ok(ok.result?.id, `带 operationId 应建成：${JSON.stringify(ok)}`);
    assert.equal(await catalogCount(d, bearer, d.ws), 1);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('同 operationId 只换了字段顺序：重放原回执，宿主的事件计数没有再加', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-idem-replay-'));
  const d = await boot(cwd);
  try {
    const { bearer } = await device(d, cwd, 'p-replay', 'replay');
    const made = await rpc(d, bearer, 'session/create',
      { workspaceId: d.ws, title: 'replay-session', operationId: 'op-new-1' }, 'k-3');
    const sid = made.result.id;
    const first = await rpc(d, bearer, 'session/submit',
      { workspaceId: d.ws, sessionId: sid, operationId: 'op-sub-1', text: '同一条消息' }, 'k-4');
    assert.equal(first.result.events, 1, `首次提交应只追加一条：${JSON.stringify(first)}`);
    // 同一份内容，params 里键的顺序换了：规范化摘要相同，必须算重放而不是冲突。
    const again = await rpc(d, bearer, 'session/submit',
      { text: '同一条消息', sessionId: sid, workspaceId: d.ws, operationId: 'op-sub-1' }, 'k-5');
    assert.deepEqual(again.result, first.result, `重放应返回原回执：${JSON.stringify(again)}`);
    assert.equal(again.id, 'k-5', '重放的信封要带本次请求的 id，否则客户端等不到应答');
    // 阳性对照：换一个 operationId 就真再加一条——证明「events 仍是 1」是幂等而不是卡住。
    const other = await rpc(d, bearer, 'session/submit',
      { workspaceId: d.ws, sessionId: sid, operationId: 'op-sub-2', text: '同一条消息' }, 'k-6');
    assert.equal(other.result.events, 2, `换 operationId 必须真执行：${JSON.stringify(other)}`);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('同 operationId 换内容按冲突拒，且不落第二次副作用', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-idem-conflict-'));
  const d = await boot(cwd);
  try {
    const { bearer } = await device(d, cwd, 'p-conf', 'conf');
    const made = await rpc(d, bearer, 'session/create',
      { workspaceId: d.ws, title: 'conflict-session', operationId: 'op-conf-new' }, 'k-7');
    const sid = made.result.id;
    const first = await rpc(d, bearer, 'session/submit',
      { workspaceId: d.ws, sessionId: sid, operationId: 'op-conf-1', text: '第一版' }, 'k-8');
    assert.equal(first.result.events, 1, JSON.stringify(first));
    const second = await rpc(d, bearer, 'session/submit',
      { workspaceId: d.ws, sessionId: sid, operationId: 'op-conf-1', text: '第二版' }, 'k-9');
    assert.equal(second.error.code, -32018, `同键不同内容必须拒而不是返回旧回执：${JSON.stringify(second)}`);
    assert.match(second.error.message, /idempotency-conflict/);
    const third = await rpc(d, bearer, 'session/submit',
      { workspaceId: d.ws, sessionId: sid, operationId: 'op-conf-1', text: '第一版' }, 'k-10');
    // 被拒的那次没进账：同键同内容的第三次仍应拿到第一次的回执（事件计数不变）。
    assert.deepEqual(third.result, first.result, JSON.stringify(third));
    assert.equal(third.result.events, 1, `冲突拒掉的那次不能已经把事件加到 2：${JSON.stringify(third)}`);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('账本键带 principalId：另一台设备用同名 operationId 各建各的会话', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-idem-principal-'));
  const d = await boot(cwd);
  try {
    const a = await device(d, cwd, 'p-alpha', 'alpha');
    const b = await device(d, cwd, 'p-beta', 'beta');
    const ra = await rpc(d, a.bearer, 'session/create',
      { workspaceId: d.ws, title: 'shared-op-name', operationId: 'op-shared' }, 'k-11');
    const rb = await rpc(d, b.bearer, 'session/create',
      { workspaceId: d.ws, title: 'shared-op-name', operationId: 'op-shared' }, 'k-12');
    assert.ok(ra.result?.id && rb.result?.id, `两条都该真执行：${JSON.stringify(ra)} / ${JSON.stringify(rb)}`);
    assert.notEqual(ra.result.id, rb.result.id, '跨设备共享回执会把 A 的会话发给 B');
    assert.equal(await catalogCount(d, a.bearer, d.ws), 2);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('账本跨进程重启仍在：同一条 operationId 换一个新 daemon 也不会第二次落副作用', async () => {
  // §5「副作用与幂等账不能仅靠内存锁」。这条是那句的唯一运行证据：
  // 第二个 daemon 是另一个进程，内存账本是空的，能重放只可能因为它读了盘。
  // 设备换成同 principal 的新登记（键里是 principalId 不是 deviceId），
  // 免得把「凭据不跨进程持久」这条已知限制混进幂等结论里。
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-idem-restart-'));
  let d = await boot(cwd);
  const ws = d.ws;
  const made = await rpc(d, (await device(d, cwd, 'p-restart', 'r1')).bearer,
    'session/create', { workspaceId: ws, title: 'restart-session', operationId: 'op-r-new' }, 'k-30');
  const sid = made.result.id;
  const first = await rpc(d, (await device(d, cwd, 'p-restart', 'r1b')).bearer,
    'session/submit', { workspaceId: ws, sessionId: sid, operationId: 'op-r-1', text: '只该出现一次' }, 'k-31');
  assert.equal(first.result.events, 1, JSON.stringify(first));
  await d.stop();

  d = await boot(cwd);
  try {
    const again = await rpc(d, (await device(d, cwd, 'p-restart', 'r2')).bearer,
      'session/submit', { workspaceId: ws, sessionId: sid, operationId: 'op-r-1', text: '只该出现一次' }, 'k-32');
    assert.deepEqual(again.result, first.result, `换进程后仍要拿到原回执：${JSON.stringify(again)}`);
    assert.equal(again.result.events, 1, `重启后的重试不能把事件加到 2：${JSON.stringify(again)}`);
    // 真源核对：回执说是 1 条，磁盘上的会话日志也得真是 1 条。
    const proj = await rpc(d, (await device(d, cwd, 'p-restart', 'r3')).bearer,
      'session/projection', { workspaceId: ws, sessionId: sid }, 'k-33');
    assert.equal(proj.result.events, 1, `会话日志里的事件数才是最终判据：${JSON.stringify(proj)}`);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

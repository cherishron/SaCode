import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

// 设计 §4「撤销先更新服务端版本，再关闭匹配设备的全部 SSE」与 §6「先建立授权缓冲订阅，
// 读持久高水位，补读去重后交付」。这两条都发生在「已经开着的连接」上，
// 所以只能用真实 daemon + 真实流来验：静态清单和单模块测试都证不了「断连真的发生」。
//
// 两条反证各自的靶子：
//   - 撤销只挡下一个请求、不挡在途流 → 这条用例必须看到流自己结束并带上可恢复原因；
//   - 补读顺序写反（先读高水位再订阅）→ 中间落盘的事件既不在页里也不在缓冲里，
//     这一面只有「带游标重连能立刻看到 seq 1/2」这种直接读数能钉住。
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

async function rmBounded(dir) {
  const until = Date.now() + 8000;
  for (;;) {
    try { await rm(dir, { recursive: true, force: true }); return; }
    catch (e) { if (Date.now() >= until) throw e; await delay(200); }
  }
}

async function boot(cwd) {
  assert.ok(existsSync(hostExe), `需要真实宿主产物：${hostExe} 不存在。先跑 node scripts/pack-host.mjs（记 BLOCKED，不是跳过）`);
  assert.ok(existsSync(daemonExe), `需要 daemon 产物：${daemonExe} 不存在。先跑 cd apps/daemon && cjpm build`);
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
  return {
    ws,
    url: p => `http://127.0.0.1:${port}${p}`,
    stderr: () => err,
    stop: async () => {
      const closed = new Promise(resolve => proc.on('close', resolve));
      proc.kill('SIGKILL');
      await Promise.race([closed, delay(3000)]);
    },
  };
}

async function manage(cwd, args) {
  return new Promise(resolve => {
    const p = spawn(daemonExe, args, { cwd, env: baseEnv });
    let o = '';
    let e = '';
    p.stdout.on('data', d => { o += d; });
    p.stderr.on('data', d => { e += d; });
    p.on('close', code => resolve({ code, o, e }));
  });
}

async function device(d, cwd, principal, name) {
  const snapshot = `${cwd}/instance.id.devices.json`;
  const created = await manage(cwd, ['--manage', 'enroll-ticket', snapshot, principal]);
  assert.equal(created.code, 0, `建票应成功：${created.e}`);
  const ticket = created.o.replace(/\r/g, '').trim().split('\n')[1];
  const url = p => d.url(p);
  const dev = JSON.parse(await (await fetch(url('/auth/enroll'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enrollmentSecret: ticket, deviceName: name, kind: 'mobile' }),
    signal: AbortSignal.timeout(15000),
  })).text());
  const tok = JSON.parse(await (await fetch(url('/auth/token'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: dev.deviceId, credential: dev.credential }),
    signal: AbortSignal.timeout(15000),
  })).text());
  return { bearer: `Bearer ${tok.accessToken}`, deviceId: dev.deviceId, snapshot };
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
  try { json = JSON.parse(text); } catch { /* 交给断言 */ }
  assert.ok(json, `${method} #${id} 应答不是 JSON：${text.slice(0, 300)}`);
  return json;
}

// 建会话 → 选中 → 提交两条正文 → flush。返回 sid 与持久计数。
async function sessionWithTwoMessages(d, cwd, tag) {
  const dev = await device(d, cwd, `p-${tag}`, tag);
  const made = await rpc(d, dev.bearer, 'session/create',
    { workspaceId: d.ws, title: `sse-${tag}`, operationId: `op-${tag}-new` }, `${tag}-c`);
  assert.ok(made.result?.id, JSON.stringify(made));
  const sid = made.result.id;
  const sel = await rpc(d, dev.bearer, 'session/select', { workspaceId: d.ws, sessionId: sid }, `${tag}-sel`);
  assert.ok(sel.result?.selected, JSON.stringify(sel));
  for (const i of ['1', '2']) {
    const sub = await rpc(d, dev.bearer, 'session/submit', {
      workspaceId: d.ws, sessionId: sid, operationId: `op-${tag}-say-${i}`,
      eventType: 'user/message', data: `补读正文-${i}`,
    }, `${tag}-s${i}`);
    assert.ok(sub.result, JSON.stringify(sub));
  }
  const fl = await rpc(d, dev.bearer, 'session/flush',
    { workspaceId: d.ws, sessionId: sid, operationId: `op-${tag}-flush` }, `${tag}-f`);
  assert.ok(fl.result, JSON.stringify(fl));
  return { ...dev, sid, durable: fl.result.durable };
}

// 打开 /sse 并把帧原文攒起来；返回句柄可提前 abort，也可等它自己结束。
async function openStream(d, bearer, lastEventId) {
  const headers = { authorization: bearer, accept: 'text/event-stream' };
  if (lastEventId !== undefined) headers['Last-Event-ID'] = lastEventId;
  const ac = new AbortController();
  const started = Date.now();
  const r = await fetch(d.url('/sse'), { headers, signal: ac.signal }).catch(e => { throw e; });
  assert.equal(r.status, 200, `SSE 应建立：${r.status}`);
  const state = { text: '', ended: false, endError: null };
  const reading = (async () => {
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { state.ended = true; break }
      state.text += dec.decode(value, { stream: true });
    }
  })().catch(e => { state.ended = true; state.endError = e?.name || String(e); });
  return {
    state,
    closed: () => reading,
    abort: () => ac.abort(),
    async waitText(pattern, budgetMs) {
      const until = Date.now() + (budgetMs || 25000);
      while (Date.now() < until) {
        if (pattern.test(state.text)) return true;
        if (state.ended) return pattern.test(state.text);
        await delay(50);
      }
      return pattern.test(state.text);
    },
    async waitEnd(budgetMs) {
      const until = Date.now() + (budgetMs || 25000);
      while (!state.ended && Date.now() < until) await delay(50);
      await Promise.race([reading, delay(1000)]);
      return state.ended;
    },
    started,
  };
}

test('带 Last-Event-ID 重连：先补读游标之后的持久事件，再进直播', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-sse-backfill-'));
  const d = await boot(cwd);
  try {
    const s = await sessionWithTwoMessages(d, cwd, 'backfill');
    assert.ok(s.durable >= 3, `夹具前提：至少三条持久事件（标题 + 两条正文），实得 ${s.durable}`);
    const stream = await openStream(d, s.bearer, `${s.sid}|0`);
    const got = await stream.waitText(/id: .*\|1\n/);
    stream.abort();
    assert.equal(got, true,
      `带游标 0 重连必须马上拿到 seq 1、2；实际帧：${JSON.stringify(stream.state.text.slice(0, 900))}`);
    assert.match(stream.state.text, /id: .*\|2\n/, '游标之后的每一条都要补，不能只补第一条');
    assert.match(stream.state.text, /event: durable/, '持久帧要带类别标记');
    assert.match(stream.state.text, /"sessionId":"[^"]+"/, '持久帧要带资源归属');
    // 补读只补游标之后的：把 seq 0 再交一次，客户端就会重复渲染第一条。
    assert.equal(/id: .*\|0\n/.test(stream.state.text), false,
      `游标 0 之后不该再交 seq 0：${stream.state.text.slice(0, 400)}`);
    await stream.waitEnd(5000);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('首订阅不带游标就只给直播：不把整本历史当补读塞给新客户端', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-sse-fresh-'));
  const d = await boot(cwd);
  try {
    const s = await sessionWithTwoMessages(d, cwd, 'fresh');
    const stream = await openStream(d, s.bearer, undefined);
    // 连接建立本身要看得见（: connected 注释行），否则「没有 durable 帧」可能只是没连上。
    assert.equal(await stream.waitText(/connected/), true, `连接没建起来：${JSON.stringify(stream.state.text)}`);
    await delay(500);
    assert.equal(/id: /.test(stream.state.text), false,
      `新客户端不该收到任何带游标的补读帧：${stream.state.text.slice(0, 500)}`);
    stream.abort();
    await stream.waitEnd(5000);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('撤销设备会关掉它在途的 SSE，并在流里给出可恢复原因', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-sse-revoke-'));
  const d = await boot(cwd);
  try {
    const dev = await device(d, cwd, 'p-revoke', 'revoke');
    const stream = await openStream(d, dev.bearer, undefined);
    assert.equal(await stream.waitText(/connected/), true, `连接没建起来：${JSON.stringify(stream.state.text)}`);
    // 撤销走的是另一个进程改盘（本机管理入口），daemon 只能靠重认把它送进已建连接。
    const rev = await manage(cwd, ['--manage', 'revoke-device', dev.snapshot, dev.deviceId]);
    assert.equal(rev.code, 0, `撤销应成功：${rev.e}`);
    const ended = await stream.waitEnd(20000);
    assert.equal(ended, true,
      `撤销后这条在途流必须自己结束（否则撤销只挡住下一个请求）；stderr=${d.stderr().slice(-400)}`);
    assert.match(stream.state.text, /"reason":"revoked"/,
      `关闭要带可恢复原因，实际帧：${JSON.stringify(stream.state.text.slice(-600))}`);
    // 撤销之后同一 token 不能再建流：请求面与流面必须同判。
    const again = await fetch(d.url('/sse'), {
      headers: { authorization: dev.bearer, accept: 'text/event-stream' },
      signal: AbortSignal.timeout(8000),
    });
    assert.equal(again.status, 401, `被撤销设备的 token 不该再建得起流：${again.status}`);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('未认证的 SSE 既不订阅也不泄露订阅计数', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-sse-noauth-'));
  const d = await boot(cwd);
  try {
    const r = await fetch(d.url('/sse'), {
      headers: { accept: 'text/event-stream' },
      signal: AbortSignal.timeout(8000),
    });
    assert.equal(r.status, 401, `无 bearer 必须 401：${r.status}`);
    const body = await r.text();
    assert.match(body, /authentication-required/);
    assert.equal(/sseSubscribers/.test(body), false, `未认证响应不得泄露订阅规模：${body}`);
    const dev = await device(d, cwd, 'p-probe', 'probe');
    const stream = await openStream(d, dev.bearer, undefined);
    // 正向对照：同一面在认证后真的建得起流，上面那个 401 才不是「端点根本不存在」。
    assert.equal(await stream.waitText(/connected/), true,
      `认证过的连接建不起来，上面的 401 就不能算拒绝证据：${JSON.stringify(stream.state.text)}`);
    stream.abort();
    await stream.waitEnd(5000);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

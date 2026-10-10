import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

// 批次 U：显式会话归属的跨工作区行为（计划 §7 第 157 行前半「跨项目读/写拒绝」）。
// 2026-10-10 探针结论：当前 daemon 的授权面只检查 method-level 的 permission/scope，
// 客户端可以把 workspaceId 参数写成任何字符串，宿主的写目标是它启动时固定的那一个
// 工作区目录。所以「跨工作区」在当前架构下不是被拒绝，而是被**接受并落到唯一工作区**。
// 这四条现状用例把现状钉死——今天必须全绿，证明「客户端可控的 workspaceId
// 参数不会让 daemon 崩」。同时把「应该拒但没拒」的形状如实记录下来：
// 未来一旦按规格 §7 补了「按 sessionId 查它真实所属工作区再和请求参数对齐」的核对，
// 前三条会立刻翻红——那是**正确的红灯**：它们会变成验证「显式归属真的被核了」的
// 独占受害用例。届时这条测试文件不需要重写，只需把「今天允许」的判据反转到断言 error。
// 第五条（approval/answer scope 门禁）是**已经生效的**语义，独立于 workspaceId 参数。
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
  assert.ok(existsSync(hostExe), `需要真实宿主产物：${hostExe}`);
  assert.ok(existsSync(daemonExe), `需要 daemon 产物：${daemonExe}`);
  const ws = cwd.split(path.sep).join('/');
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
  let out = ''; let err = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { err += d; });
  const until = Date.now() + 20000;
  while (!/127\.0\.0\.1:(\d+)/.test(out) && proc.exitCode === null && Date.now() < until) await delay(20);
  assert.match(out, /127\.0\.0\.1:(\d+)/, `daemon 未监听：stdout=${out} stderr=${err}`);
  const port = Number(out.match(/127\.0\.0\.1:(\d+)/)[1]);
  return {
    ws,
    url: p => `http://127.0.0.1:${port}${p}`,
    stop: async () => {
      const closed = new Promise(resolve => proc.on('close', resolve));
      proc.kill('SIGKILL');
      await Promise.race([closed, delay(3000)]);
    },
  };
}

async function device(d, cwd, principal, name) {
  const created = await new Promise(resolve => {
    const p = spawn(daemonExe, ['--manage', 'enroll-ticket', `${cwd}/instance.id.devices.json`, principal], { cwd, env: baseEnv });
    let o = ''; let e = '';
    p.stdout.on('data', x => { o += x; });
    p.stderr.on('data', x => { e += x; });
    p.on('close', code => resolve({ code, e, o }));
  });
  assert.equal(created.code, 0, `建票应成功：${created.e}`);
  const ticket = created.o.replace(/\r/g, '').trim().split('\n')[1];
  const dev = JSON.parse(await (await fetch(d.url('/auth/enroll'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enrollmentSecret: ticket, deviceName: name, kind: 'mobile' }),
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
  let json; try { json = JSON.parse(text); } catch { json = null; }
  assert.ok(json, `${method} #${id} 应答不是 JSON：${text.slice(0, 300)}`);
  return json;
}

async function sessionWithMessages(d, cwd, tag) {
  const dev = await device(d, cwd, `p-${tag}`, tag);
  const c = await rpc(d, dev.bearer, 'session/create',
    { workspaceId: d.ws, title: `own-${tag}`, operationId: `op-${tag}-c` }, `${tag}-c`);
  assert.ok(c.result?.id, JSON.stringify(c));
  const sid = c.result.id;
  const sel = await rpc(d, dev.bearer, 'session/select',
    { workspaceId: d.ws, sessionId: sid }, `${tag}-sel`);
  assert.ok(sel.result?.selected, JSON.stringify(sel));
  const sub = await rpc(d, dev.bearer, 'session/submit',
    { workspaceId: d.ws, sessionId: sid, operationId: `op-${tag}-say`, text: `内容-${tag}` }, `${tag}-sub`);
  assert.ok(sub.result, JSON.stringify(sub));
  const fl = await rpc(d, dev.bearer, 'session/flush',
    { workspaceId: d.ws, sessionId: sid, operationId: `op-${tag}-flush` }, `${tag}-fl`);
  assert.ok(fl.result, JSON.stringify(fl));
  return { ...dev, sid, durable: fl.result.durable };
}

test('跨工作区 session/create 今天落到真实工作区（现状钉死，未来应红）', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-own-cx-'));
  const d = await boot(cwd);
  try {
    const dev = await device(d, cwd, 'p-xcreate', 'xcreate');
    const r = await rpc(d, dev.bearer, 'session/create',
      { workspaceId: 'workspace-that-does-not-exist', title: 'should-be-rejected',
        operationId: 'op-xcreate-1' }, 'cx-1');
    assert.ok(r.result?.id, `跨工作区 create 今天居然被拒了，形状变了：${JSON.stringify(r)}`);
    assert.equal(r.result.workspaceId, undefined,
      `回执不该伪造声称的 workspaceId：${JSON.stringify(r)}`);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('跨工作区 session/select 今天选中真实工作区的会话（现状钉死，未来应红）', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-own-sel-'));
  const d = await boot(cwd);
  try {
    const s = await sessionWithMessages(d, cwd, 'sel');
    const r = await rpc(d, s.bearer, 'session/select',
      { workspaceId: 'totally-wrong-workspace', sessionId: s.sid,
        operationId: 'op-sel-1' }, 'sel-1');
    assert.ok(r.result?.selected === true,
      `跨工作区 select 今天居然被拒了，形状变了：${JSON.stringify(r)}`);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('跨工作区 session/events 今天按 sessionId 归属过滤，不看 workspaceId（现状钉死，未来应红）', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-own-evt-'));
  const d = await boot(cwd);
  try {
    const s = await sessionWithMessages(d, cwd, 'evt');
    const r = await rpc(d, s.bearer, 'session/events',
      { workspaceId: 'different-workspace-entirely', sessionId: s.sid,
        afterSeq: '0', limit: '20' }, 'evt-1');
    // 现状：events 走 SessionEventReplay，按 sessionId 定位日志文件，workspaceId 参数被忽略。
    // 数据隔离靠 sessionId 的 opaque 性——攻击者拿到 sessionId 才能读，
    // 拿不到就 404 或回空页。这**不是**按 workspaceId 判范围。
    assert.ok(r.result?.events, JSON.stringify(r));
    assert.ok(Array.isArray(r.result.events), JSON.stringify(r));
    // 至少能拿到 durable 计数中的**任意一条**——证明「跨工作区」真的拿到了数据，不是空页。
    assert.ok(r.result.events.length >= 1,
      `跨工作区 events 今天居然回空页了，说明形状变了：${JSON.stringify(r)}（durable=${s.durable}）`);
    // 反向锁：另一个 sessionId 拿不到这条会话的正文（按 sessionId 归属是**唯一**在生效的）。
    const other = await rpc(d, s.bearer, 'session/events',
      { workspaceId: d.ws, sessionId: 'sessions/does-not-exist',
        afterSeq: '0', limit: '20' }, 'evt-2');
    assert.ok(other.result?.events === undefined || other.result.events.length === 0,
      `陌生 sessionId 不该读到内容：${JSON.stringify(other)}`);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('跨工作区 session/submit 今天写入真实工作区（现状钉死，未来应红）', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-own-sub-'));
  const d = await boot(cwd);
  try {
    const s = await sessionWithMessages(d, cwd, 'sub');
    const r = await rpc(d, s.bearer, 'session/submit',
      { workspaceId: 'another-workspace-string', sessionId: s.sid,
        operationId: 'op-sub-cross', text: '跨界正文' }, 'sub-1');
    assert.ok(r.result, JSON.stringify(r));
    assert.equal(typeof r.result.events, 'number', JSON.stringify(r));
    assert.ok(r.result.events > 0, `跨工作区 submit 应该还是写了正文：${JSON.stringify(r)}`);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('approval/answer 的 scope 门禁独立于 workspaceId：无 approval scope 直接拒', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-own-appr-'));
  const d = await boot(cwd);
  try {
    const dev = await device(d, cwd, 'p-appr', 'appr');
    const c = await rpc(d, dev.bearer, 'session/create',
      { workspaceId: d.ws, title: 'appr-session', operationId: 'op-appr-c' }, 'ap-1');
    assert.ok(c.result?.id, JSON.stringify(c));
    const sid = c.result.id;
    const r = await rpc(d, dev.bearer, 'approval/answer',
      { workspaceId: 'any-workspace', sessionId: sid, operationId: 'op-appr-1',
        approvalId: 'totally-invented-id', decision: 'allowed-once' }, 'ap-2');
    assert.equal(r.error?.code, -32001, JSON.stringify(r));
    assert.match(r.error?.message ?? '', /scope-required/, JSON.stringify(r));
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

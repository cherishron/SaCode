import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

// 批次 U+V：显式会话归属的跨工作区行为（计划 §7 第 157 行后半「跨项目读/写拒绝」）。
// 2026-10-10 批次 U 探针结论：daemon 的授权面只检查 method-level 的 permission/scope，
// 客户端可以把 workspaceId 参数写成任何字符串。批次 V 在 `remote_gate.cj` 里加了
// 一条显式门禁：`SACODE_WORKSPACE_ID` 环境变量非空时，请求里的 workspaceId 必须
// 与它逐字一致，否则拒 `workspace-not-bound`。这样「跨工作区」从「被接受」变成
// 「被明确拒绝」，符合规格 §7「按会话定位服务并隔离执行上下文」。
//
// 这一批做的四件事：
//   1. 本测试文件 boot 时显式设 SACODE_WORKSPACE_ID=ws，把门禁开起来——
//      前四条断言从「今天居然被拒了」翻成「必须拒」，即批次 U 的「未来红灯」
//      现在**是红**。
//   2. 变异反证（MUT-V）：注释掉 remote_gate.cj 里 workspace-not-bound 分支，
//      这四条应该立刻变绿——证明测试真的在测这条门禁，不是假绿。
//   3. approval/answer 的 scope 门禁仍是**当下就生效的语义**，独立于 workspaceId
//      参数——它的独占变异仍由批次 U 那一半反证。
//   4. 审计面与脱敏面（remote-audit-integrity.test.mjs）的 `ws-1` 用法不在这批改
//      ——那些测试不开 SACODE_WORKSPACE_ID，走的是「归属核验关闭」的历史路径，
//      语义上就是「不启用归属检查时参数是自由串」，与门禁的默认空值语义一致。
//      若将来审计面也被纳入归属核验，得同步换那些夹具里的 ws-1 为 d.ws。
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
      SACODE_WORKSPACE_ID: 'ws',
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
    { workspaceId: 'ws', title: `own-${tag}`, operationId: `op-${tag}-c` }, `${tag}-c`);
  assert.ok(c.result?.id, JSON.stringify(c));
  const sid = c.result.id;
  const sel = await rpc(d, dev.bearer, 'session/select',
    { workspaceId: 'ws', sessionId: sid }, `${tag}-sel`);
  assert.ok(sel.result?.selected, JSON.stringify(sel));
  const sub = await rpc(d, dev.bearer, 'session/submit',
    { workspaceId: 'ws', sessionId: sid, operationId: `op-${tag}-say`, text: `内容-${tag}` }, `${tag}-sub`);
  assert.ok(sub.result, JSON.stringify(sub));
  const fl = await rpc(d, dev.bearer, 'session/flush',
    { workspaceId: 'ws', sessionId: sid, operationId: `op-${tag}-flush` }, `${tag}-fl`);
  assert.ok(fl.result, JSON.stringify(fl));
  return { ...dev, sid, durable: fl.result.durable };
}

test('跨工作区 session/create 必须被 workspace-not-bound 拒', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-own-cx-'));
  const d = await boot(cwd);
  try {
    const dev = await device(d, cwd, 'p-xcreate', 'xcreate');
    const r = await rpc(d, dev.bearer, 'session/create',
      { workspaceId: 'workspace-that-does-not-exist', title: 'should-be-rejected',
        operationId: 'op-xcreate-1' }, 'cx-1');
    assert.equal(r.error?.code, -32001, JSON.stringify(r));
    assert.match(r.error?.message ?? '', /workspace-not-bound/, JSON.stringify(r));
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('跨工作区 session/select 必须被 workspace-not-bound 拒', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-own-sel-'));
  const d = await boot(cwd);
  try {
    const s = await sessionWithMessages(d, cwd, 'sel');
    const r = await rpc(d, s.bearer, 'session/select',
      { workspaceId: 'totally-wrong-workspace', sessionId: s.sid,
        operationId: 'op-sel-1' }, 'sel-1');
    assert.equal(r.error?.code, -32001, JSON.stringify(r));
    assert.match(r.error?.message ?? '', /workspace-not-bound/, JSON.stringify(r));
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('跨工作区 session/events 必须被 workspace-not-bound 拒', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-own-evt-'));
  const d = await boot(cwd);
  try {
    const s = await sessionWithMessages(d, cwd, 'evt');
    const r = await rpc(d, s.bearer, 'session/events',
      { workspaceId: 'different-workspace-entirely', sessionId: s.sid,
        afterSeq: '0', limit: '20' }, 'evt-1');
    assert.equal(r.error?.code, -32001, JSON.stringify(r));
    assert.match(r.error?.message ?? '', /workspace-not-bound/, JSON.stringify(r));
    // 反向锁：另一台设备用**正确的** workspaceId 拿同一会话仍然要能读——
    // 说明这条门禁只按参数值判，不按设备判；同一 workspace 里的设备可互通。
    // 这里 s.bearer 是 sel 设备的 token，但它的 workspaceId='ws' 是本机绑定的，应放行。
    const own = await rpc(d, s.bearer, 'session/events',
      { workspaceId: 'ws', sessionId: s.sid,
        afterSeq: '0', limit: '20' }, 'evt-2');
    assert.ok(own.result?.events, JSON.stringify(own));
    assert.ok(Array.isArray(own.result.events), JSON.stringify(own));
    assert.ok(own.result.events.length >= 1,
      `同工作区读应该成功：${JSON.stringify(own)}`);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('跨工作区 session/submit 必须被 workspace-not-bound 拒', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-own-sub-'));
  const d = await boot(cwd);
  try {
    const s = await sessionWithMessages(d, cwd, 'sub');
    const r = await rpc(d, s.bearer, 'session/submit',
      { workspaceId: 'another-workspace-string', sessionId: s.sid,
        operationId: 'op-sub-cross', text: '跨界正文' }, 'sub-1');
    assert.equal(r.error?.code, -32001, JSON.stringify(r));
    assert.match(r.error?.message ?? '', /workspace-not-bound/, JSON.stringify(r));
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
      { workspaceId: 'ws', title: 'appr-session', operationId: 'op-appr-c' }, 'ap-1');
    assert.ok(c.result?.id, JSON.stringify(c));
    const sid = c.result.id;
    const r = await rpc(d, dev.bearer, 'approval/answer',
      { workspaceId: 'ws', sessionId: sid, operationId: 'op-appr-1',
        approvalId: 'totally-invented-id', decision: 'allowed-once' }, 'ap-2');
    assert.equal(r.error?.code, -32001, JSON.stringify(r));
    assert.match(r.error?.message ?? '', /scope-required/, JSON.stringify(r));
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

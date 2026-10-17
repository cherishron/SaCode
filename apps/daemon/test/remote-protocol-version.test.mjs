import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

// 批次 AB 取证：锁「今天 daemon 仍宣告 protocolVersion 0.1」这个当前面事实。
// AA 归档文档 §7 解锁顺序里对应 AA.1 的前置半（AA.1 全半是「加门禁 + 升客户端
// + 3 条 test」，本文件只交付其中的「3 条 test」+ 一条向后兼容基线）。
//
// 规格 §5 明令「0.1 与新显式归属协议 0.2 不混用；版本不匹配明确拒绝，不猜字段」——
// 但同段前置条件是「核心/Host 方法登记完成前」，也就是任务 7 显式会话归属
// 落到 HEAD 之前，门禁不该开。今天的真状态：
//
//   - 客户端 params 顶层的 workspaceId/sessionId/operationId 已经被 gate 按
//     0.2 的显式归属检查过（批次 R、U、V 全部靠这一维判 denyReason）；
//   - initialize 回包却仍写死 `"protocolVersion":"0.1"`；
//   - 请求侧没有 `protocolVersion` 字段，所以严格 gate 会拒掉所有既有测试。
//
// 这个不对称是任务 7 剩余的真实成本。本用例不修 bug、不加门禁——门禁要等
// `apps/host/src/main.cj` 与 `apps/daemon/src/host_proxy.cj`（并发会话硬持有）
// 落库后再上，且必须同步升级 clients（desktop/mobile/CLI 的 /rpc 请求体）。
// 现在做的是**把 0.1 宣告这件事钉成事实**，让「哪天有人顺手改成 0.2」被看见，
// 而不是让宣告与请求侧门禁悄悄错位到看不出。
//
// 断言三档，每档都有理由：
//   1. initialize 现在真的回 `"protocolVersion":"0.1"`——反向锁：如果哪天翻成
//      0.2 而门禁没跟上，这一条会变红，正好把「宣告改了但门禁没跟上」抓到。
//   2. 请求体里塞 `"protocolVersion":"0.1"`（客户端显式声明旧版）——今天不被拒，
//      因为门禁还不存在。这条用例锁定「0.1 请求当前仍被接受」这个事实，
//      日后加门禁时应该主动改这条断言的方向（红先 → 翻绿）。
//   3. 请求体里塞 `"protocolVersion":"0.2"` 走 0.2 显式归属路径——今天也不被拒
//      （同理），门禁上后同样要主动改。
//
// 这三条共同反证的是「协议版本协商是双向门禁」——今天两个方向都没有，所以
// 客户端声明跟服务端宣告互相看不见；等 gate 上线时，这条测试要按新门禁
// 重排三档，不能留着旧绿冒充新绿。

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

async function waitForExit(proc, budgetMs) {
  const end = Date.now() + budgetMs;
  while (proc.exitCode === null && proc.signalCode === null && Date.now() < end) await delay(25);
  return proc.exitCode === null && proc.signalCode === null ? null : proc.exitCode;
}

async function stopDaemon(proc) {
  if (!proc || (proc.exitCode !== null || proc.signalCode !== null)) return;
  proc.kill();
  if (await waitForExit(proc, 4000) === null) {
    proc.kill('SIGKILL');
    await waitForExit(proc, 4000);
  }
}

async function removeDir(dir) {
  for (let i = 0; i < 20; i += 1) {
    try { await rm(dir, { recursive: true, force: true }); return; }
    catch (e) { if (e.code !== 'EBUSY' && e.code !== 'EPERM' && e.code !== 'ENOTEMPTY') throw e; await delay(150); }
  }
}

async function createTicket(snapshot, principal) {
  const proc = spawn(daemonExe, ['--manage', 'enroll-ticket', snapshot, principal], {
    env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = ''; let err = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { err += d; });
  const end = Date.now() + 15000;
  while (proc.exitCode === null && proc.signalCode === null && Date.now() < end) await delay(25);
  assert.notEqual(proc.exitCode, null, '建票子进程没在 15 秒内退出');
  assert.equal(proc.exitCode, 0, `本地管理入口建票失败 rc=${proc.exitCode}：${err}`);
  const lines = out.replace(/\r/g, '').trim().split('\n');
  const ticket = lines[lines.length - 1].trim();
  assert.match(ticket, /^[0-9a-f]{32}$/, `票据形状不对：${JSON.stringify(lines)}`);
  return ticket;
}

async function boot(dir) {
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
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = ''; let err = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { err += d; });
  const end = Date.now() + 20000;
  while (!/127\.0\.0\.1:(\d+)/.test(out) && proc.exitCode === null && Date.now() < end) await delay(20);
  assert.match(out, /127\.0\.0\.1:(\d+)/, `daemon 未监听：stdout=${out} stderr=${err}`);
  const port = Number(out.match(/127\.0\.0\.1:(\d+)/)[1]);
  const post = (p, body, headers = {}) => fetch(`http://127.0.0.1:${port}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body,
    signal: AbortSignal.timeout(10000),
  });
  const rpc = async (method, params = {}, headers = {}) => {
    const r = await post('/rpc', JSON.stringify({ jsonrpc: '2.0', id: 'pv-1', method, params }), headers);
    return { status: r.status, body: await r.text() };
  };
  const ticket = await createTicket(snapshot, 'p-pv');
  const enroll = await (await post('/auth/enroll',
    JSON.stringify({ enrollmentSecret: ticket, deviceName: 'pv-phone', kind: 'mobile' }))).json();
  const tok = await (await post('/auth/token',
    JSON.stringify({ deviceId: enroll.deviceId, credential: enroll.credential }))).json();
  const bearer = { authorization: `Bearer ${tok.accessToken}` };
  return { proc, rpc, post, bearer, port };
}

async function withDaemon(run) {
  const dir = await mkdtemp(path.join(root, 'target', 'sacode-pv-'));
  let d = null;
  try {
    d = await boot(dir);
    return await run(d, dir);
  } finally {
    await stopDaemon(d ? d.proc : null);
    await removeDir(dir);
  }
}

test('initialize 今天宣告 protocolVersion 0.1——不混用规格未满足时的当前面事实', async () => {
  await withDaemon(async (d) => {
    const init = await d.rpc('initialize', {}, d.bearer);
    assert.ok(init.body.length > 0, 'initialize 必须有应答');
    // 关键判定：今天的真状态是 0.1。
    assert.ok(init.body.includes('"protocolVersion":"0.1"'),
      `initialize 应回 protocolVersion 0.1：${init.body.slice(0, 200)}`);
    // 反向锁：不能因为「capabilities 空」而白拿绿——0.1 宣告必须伴随
    // 实际可用的能力面（至少包含 initialize 与 session/catalog）。
    assert.ok(init.body.includes('initialize') && init.body.includes('session/catalog'),
      `capabilities 面不能空：${init.body.slice(0, 300)}`);
  });
});

test('请求体带顶层 "protocolVersion":"0.1" 今天不被门禁拒绝（当前无协商）', async () => {
  await withDaemon(async (d) => {
    // 客户端把 protocolVersion 放在 JSON-RPC envelope 顶层——这是规格 §5
    // 「显式协商字段」最可能的形状。0.2 归属字段仍走 params 顶层。今天
    // daemon 不看 envelope 顶层的 protocolVersion，这条字段是纯装饰。
    const r = await d.post('/rpc', JSON.stringify({
      jsonrpc: '2.0', id: 'pv-01', method: 'session/catalog',
      protocolVersion: '0.1',
      params: { workspaceId: 'ws-1', operationId: 'op-pv-01' },
    }), d.bearer);
    const text = await r.text();
    assert.equal(r.status, 200,
      `带顶层 protocolVersion 0.1 的 envelope 今天必须通过：${r.status} ${text.slice(0, 200)}`);
    assert.ok(!text.includes('-32004'),
      `今天不该出现 -32004 protocol-version-mismatch：${text.slice(0, 200)}`);
  });
});

test('请求体带顶层 "protocolVersion":"0.2" 也走同一 0.1 通道（当前无协商）', async () => {
  await withDaemon(async (d) => {
    // 0.2 声明 + 0.2 显式归属字段：门禁上后这条应翻成通过；今天它跟 0.1 声明
    // 表现一样。两条用例并列就是「无门禁」的形态证据——同一份请求侧字段
    // 被两种声明共用，服务端不看。
    const r = await d.post('/rpc', JSON.stringify({
      jsonrpc: '2.0', id: 'pv-02', method: 'session/catalog',
      protocolVersion: '0.2',
      params: { workspaceId: 'ws-1', operationId: 'op-pv-02' },
    }), d.bearer);
    const text = await r.text();
    assert.equal(r.status, 200,
      `带顶层 protocolVersion 0.2 的 envelope 今天也必须通过：${r.status} ${text.slice(0, 200)}`);
    assert.ok(!text.includes('-32004'),
      `今天不该出现 -32004 protocol-version-mismatch：${text.slice(0, 200)}`);
  });
});

test('缺顶层 protocolVersion 字段的既有形态今天仍通过（向后兼容基线）', async () => {
  await withDaemon(async (d) => {
    // 前 15 份 remote-*.test.mjs 里 65 处 method 调用没有一处带 protocolVersion。
    // 这条锁「缺字段 = 放行」这一向后兼容基线：将来加门禁时不能一刀切让所有
    // 既有客户端挂掉，必须有迁移窗口。这个基线一旦破坏，就是「客户端协商
    // 没同步升级」的直接证据。
    const r = await d.rpc('session/catalog',
      { workspaceId: 'ws-1', operationId: 'op-pv-legacy' },
      d.bearer);
    assert.equal(r.status, 200,
      `缺 protocolVersion 的既有客户端形态今天必须通过：${r.status} ${r.body.slice(0, 200)}`);
  });
});

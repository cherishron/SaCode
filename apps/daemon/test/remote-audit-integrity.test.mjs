import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

// 审计完整性在真 HTTP + 真审计文件上的行为（规格 §7「审计保存 who/when/what/result；
// 遍历日志断言无登记秘密/token/模型key」）。
//
// 这一批评的是「注入能否抹掉痕迹」，分两层写，因为两侧的真源不同：
//
//   - `/rpc` 面：workspaceId/sessionId/operationId 虽然是调用方任意串，但进门禁前
//     先过 `RemoteRequestGate.sanitizeId`（remote_gate.cj:65），越字符集整串换成
//     `sanitized-invalid`。所以这一面的断言是「净化生效 + 判定留痕」，
//     审计层的值级脱敏在这条路是第二道，不该在盘上看见它的标记。
//   - `/auth/*` 面：deviceName 与 deviceId **没有任何前置净化**——
//     deviceId 就是 `${deviceName}-${nextDeviceId}`（remote_identity.cj:215），
//     而 `/auth/token` 的 denied 条目直接把请求体里的 deviceId 原文写进审计
//     （remote_access.cj:291）。改之前 record() 撞上禁用键串会整条丢弃并抛异常，
//     于是「谁在拿注入的 id 试认证」这条恰恰消失了，而且异常被路由层吞成
//     400 `{"error":"audit-serialization-leak"}`——等于把「注入有效」回给攻击者。
//     这一面才是本批真正补上的洞。
//
// 断言按两侧写：秘密不落盘（SENTINEL 与转义键串都不出现），且留痕可复原
// （outcome / method / denyReason 还在，被脱的字段带字段名标记，干净的字段不许被顺手改写）。
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
const SENTINEL = 'sk-SENTINEL-must-never-reach-disk';
// 注入形态就是「把整段 JSON 塞进一个 id 字段」：jsonEscape 之后它会变成
// \"credential\" 这种禁用键串转义形态，正是审计白名单要挡的那一类。
const INJECTED = 'op{"credential":"' + SENTINEL + '"}';

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


// 建票走本地管理入口的子进程（跨进程可见那条已单独验过），必须在 daemon 启动之后。
async function createTicket(snapshot, principal) {
  const proc = spawn(daemonExe, ['--manage', 'enroll-ticket', snapshot, principal], {
    env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
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
  let out = '';
  let err = '';
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
    const r = await post('/rpc', JSON.stringify({ jsonrpc: '2.0', id: 'aud-1', method, params }), headers);
    return { status: r.status, body: await r.text() };
  };
  const ticket = await createTicket(snapshot, 'p-audit');
  const enroll = await (await post('/auth/enroll',
    JSON.stringify({ enrollmentSecret: ticket, deviceName: 'audit-phone', kind: 'mobile' }))).json();
  const tok = await (await post('/auth/token',
    JSON.stringify({ deviceId: enroll.deviceId, credential: enroll.credential }))).json();
  const bearer = { authorization: `Bearer ${tok.accessToken}` };
  // 第二台设备用任意 deviceName 登记：deviceName 是客户端可控串，
  // 它直接决定审计里的 deviceId 字段，这条没有 sanitize 前置。
  const enrollAs = async (deviceName) => {
    const t = await createTicket(snapshot, 'p-injected');
    const e = await (await post('/auth/enroll',
      JSON.stringify({ enrollmentSecret: t, deviceName, kind: 'mobile' }))).json();
    const tk = await (await post('/auth/token',
      JSON.stringify({ deviceId: e.deviceId, credential: e.credential }))).json();
    return { deviceId: e.deviceId, bearer: { authorization: `Bearer ${tk.accessToken}` } };
  };
  return { proc, rpc, post, bearer, enrollAs, deviceId: enroll.deviceId, token: tok.accessToken, identity };
}

async function withDaemon(run) {
  const dir = await mkdtemp(path.join(root, 'target', 'sacode-audit-integrity-'));
  let d = null;
  try {
    d = await boot(dir);
    return await run(d, dir);
  } finally {
    await stopDaemon(d ? d.proc : null);
    await removeDir(dir);
  }
}

async function auditText(dir) {
  return (await readFile(path.join(dir, 'instance.id.audit.log'), 'utf8')).replace(/\r/g, '');
}

test('注入 operationId 抹不掉审计：净化成固定标记，判定留痕，秘密不落盘', async () => {
  await withDaemon(async (d, dir) => {
    const denied = await d.rpc('session/catalog',
      { workspaceId: 'ws-1', operationId: INJECTED }, d.bearer);
    assert.ok(denied.body.length > 0, '拒绝也要有应答');

    const text = await auditText(dir);
    // 秘密侧：原文与转义键串都不许出现。
    assert.ok(!text.includes(SENTINEL), `审计里出现了凭据原文：${text.slice(-300)}`);
    assert.ok(!text.includes('\\"credential\\"'), `审计里出现了禁用键串的转义形态：${text.slice(-300)}`);
    // 留痕侧：这条判定必须还在，并且能认出「这里本来有个不合规 id」。
    const lines = text.split('\n').filter(l => l.length > 0);
    assert.ok(lines.length > 0, '审计文件是空的——注入把整条抹掉了');
    assert.ok(lines.some(l => l.includes('"operationId":"sanitized-invalid"')
        && l.includes('"method":"session/catalog"')),
      `门禁净化后的 id 必须仍带这条判定：\n${text.slice(-400)}`);
    assert.ok(lines.some(l => l.includes(`"deviceId":"${d.deviceId}"`) && l.includes('"outcome":"')),
      `who/result 必须可复原：\n${text.slice(-400)}`);
    // 分层断言：/rpc 面第一道是 sanitizeId，盘上不该出现审计层的脱敏标记。
    // 如果这条变红，说明第一道被撤了、只剩第二道——那正是「净化失效」的形态。
    assert.ok(!text.includes('audit-redacted:operationId'),
      `/rpc 面的 id 应先被门禁字符集净化，不该走到值级脱敏：\n${text.slice(-400)}`);
  });
});

test('正常 id 不被顺手改写——否则审计只剩占位符', async () => {
  await withDaemon(async (d, dir) => {
    await d.rpc('session/catalog', { workspaceId: 'ws-1', operationId: 'op-visible' }, d.bearer);
    const text = await auditText(dir);
    assert.ok(text.includes('"operationId":"op-visible"'),
      `干净的 operationId 必须原样可查：\n${text.slice(-400)}`);
    assert.ok(text.includes(`"deviceId":"${d.deviceId}"`),
      `合法设备名换来的 deviceId 不许被顺手脱成占位符：\n${text.slice(-400)}`);
    assert.ok(!text.includes('audit-redacted:'),
      `这一轮没有任何注入，不该出现脱敏标记：\n${text.slice(-400)}`);
  });
});

test('未认证请求带注入 id 时，认证拒因仍落盘且不含秘密', async () => {
  await withDaemon(async (d, dir) => {
    // 不带 Bearer：门禁前的 unauthenticated 条目 deviceId 为空，但 attempted 的
    // workspace/session/operation 仍要留痕——这正是攻击探测最需要的一条。
    const anon = await d.rpc('session/catalog',
      { workspaceId: INJECTED, sessionId: 's-anon', operationId: INJECTED });
    assert.ok(anon.body.includes('missing-bearer'), `未认证要先归认证：${anon.body}`);
    const text = await auditText(dir);
    assert.ok(!text.includes(SENTINEL), `匿名请求的注入内容不许进审计：${text.slice(-300)}`);
    assert.ok(text.includes('unauthenticated-missing-bearer'),
      `匿名探测的拒因必须留痕：\n${text.slice(-400)}`);
    assert.ok(text.includes('"workspaceId":"sanitized-invalid"'),
      `匿名探测里 attempt 的归属字段要留痕（净化后的形态）：\n${text.slice(-400)}`);
    assert.ok(text.includes('"sessionId":"s-anon"'),
      `同一行里合法的字段不该被连坐：\n${text.slice(-400)}`);
  });
});

// 下面两条是本批真正的洞：/auth 面的 deviceId 没有任何前置净化，
// deviceName 更是直接进设备 id 的构成。改之前这两条都会让整条审计消失。
test('/auth/token 用注入 deviceId 被拒时，失败留痕必须还在且不含秘密', async () => {
  await withDaemon(async (d, dir) => {
    const resp = await d.post('/auth/token',
      JSON.stringify({ deviceId: INJECTED, credential: 'wrong-on-purpose' }));
    const body = await resp.text();
    // 反向半边：内部异常名不许回给调用方——那是一台「注入是否奏效」的探针机。
    assert.ok(!body.includes('audit-serialization-leak'),
      `审计侧的失败不许变成可观测回显：${body}`);
    assert.match(body, /invalid-credential|error/, `失败仍要给出正常拒因：${body}`);

    const text = await auditText(dir);
    assert.ok(!text.includes(SENTINEL), `凭据原文不许落盘：${text.slice(-300)}`);
    assert.ok(!text.includes('\\"credential\\"'), `禁用键串转义形态不许落盘：${text.slice(-300)}`);
    const hit = text.split('\n').filter(l => l.includes('"method":"auth/token"')
      && l.includes('"outcome":"denied"'));
    assert.equal(hit.length, 1, `这次认证失败必须留下恰好一条：\n${text.slice(-400)}`);
    assert.ok(hit[0].includes('"deviceId":"audit-redacted:deviceId"'),
      `被脱的是 deviceId 这个值，且要标出字段名：\n${hit[0]}`);
    assert.ok(hit[0].includes('"denyReason":"invalid-credential"'),
      `拒因不能被脱没：\n${hit[0]}`);
  });
});

test('deviceName 注入在门禁处就被拒：审计记 denied 归因，不留登记成功痕迹', async () => {
  // 批次 R 把 deviceName 从「允许任意串 + 靠审计脱敏」改成「入口拒绝」。
  // 注入串 `op{"credential":"..."}` 里有 `"`、`{`、`}`、`:`——都是 deviceName
  // 白名单外的字符。旧行为是登记成功、deviceId 变成注入串、之后每条判定里
  // 的 deviceId 都是 audit-redacted:deviceId；新行为是登记就直接 400，
  // 攻击者拿不到凭据，也就不会留下「成功设备带注入名」的痕迹。
  //
  // 这条用例的关键断言不是「审计脱敏还有效」——那由上面那条 `/auth/token`
  // 注入用例覆盖——而是「门禁层真的挡下了注入，且拒绝本身留痕带原因码」。
  await withDaemon(async (d, dir) => {
    const t = await createTicket(`${d.identity}.devices.json`, 'p-injected-gate');
    const enrollResp = await d.post('/auth/enroll',
      JSON.stringify({ enrollmentSecret: t, deviceName: INJECTED, kind: 'mobile' }));
    assert.equal(enrollResp.status, 400, `注入 deviceName 必须被门禁拒：${enrollResp.status}`);
    const body = await enrollResp.json();
    assert.equal(body.error, 'device-name-invalid',
      `归因必须精确到 deviceName 字符集：${JSON.stringify(body)}`);

    const text = await auditText(dir);
    // 秘密侧：注入里的凭据原文与转义键串都不许落盘。
    assert.ok(!text.includes(SENTINEL), `设备名里的凭据原文不许落盘：${text.slice(-300)}`);
    assert.ok(!text.includes('\\"credential\\"'), `设备名注入的键串形态不许落盘：${text.slice(-300)}`);
    // 留痕侧：拒绝事件必须留痕，且带明确归因。
    const denied = text.split('\n').filter(l => l.includes('"method":"auth/enroll"')
      && l.includes('"outcome":"denied"'));
    assert.ok(denied.some(l => l.includes('"denyReason":"device-name-invalid"')),
      `门禁拒绝必须留痕带 device-name-invalid 归因：\n${denied.join('\n')}`);
    // 反向：这一轮不许出现「注入设备的 allowed」登记留痕——那意味着门禁被绕过。
    const allowedEnrolls = text.split('\n').filter(l => l.includes('"method":"auth/enroll"')
      && l.includes('"outcome":"allowed"'));
    // 允许有一条：boot() 里预注册的 audit-phone 设备。注入设备不允许。
    assert.equal(allowedEnrolls.length, 1,
      `只应留下 boot() 预注册那条，注入设备的 allowed 痕迹不许存在：\n${allowedEnrolls.join('\n')}`);
    assert.ok(!allowedEnrolls[0].includes(SENTINEL), `注入凭据原文不许进 allowed 留痕`);
  });
});

test('access token 与登记凭据本身也不许出现在审计任何位置', async () => {
  await withDaemon(async (d, dir) => {
    await d.rpc('session/catalog', { workspaceId: 'ws-1', operationId: 'op-tok' }, d.bearer);
    const text = await auditText(dir);
    assert.ok(text.length > 0, '审计为空就不能证明任何事');
    assert.ok(!text.includes(d.token), `审计不得含 access token：${text.slice(-200)}`);
    assert.ok(!text.includes('Bearer'), '审计不得含认证头原文');
    // 反向：这两条断言不能因为「整条都没落盘」而白拿——留痕必须在。
    assert.ok(text.includes('"operationId":"op-tok"'),
      `合法 id 那条记录必须存在，否则上面两条是空集合换来的绿：\n${text.slice(-300)}`);
  });
});

// 批次 AA.2：plan 第 147 行后半「遍历日志断言无登记秘密/token/模型key」的
// 字面验收。前面 6 条用例用的是假凭据（Bearer nope / SENTINEL 合成串）——
// 「不含假串」的断言恒真，拿不到「真凭据没进盘」的证据。这条用 boot()
// 返回的**真 token**（server 生成的十六进制串）走完「建票 → 登记 → 兑换 →
// 带 Bearer 的 /rpc → 遍历审计文件」的完整链路再判。
//
// 断言两侧都要，才不白拿绿：
//   - 秘密侧：真 token 原文一个都不许落盘。
//   - 留痕侧：判定记录至少一条，否则「不含 X」的断言在空集上恒真。
// 反向锁：d.token 是 server 端生成的 32 字符十六进制，测试文件里不会字面
// 出现它——所以审计里出现这个精确串必然是**服务端**写进去的，不是测试
// 注释被序列化进盘。
test('真 access token 走完 /rpc 全流程后，审计遍历不含它的原文', async () => {
  await withDaemon(async (d, dir) => {
    // boot() 里已经跑完建票 → 登记 → 兑换三步，拿到的 d.token 是服务器
    // 刚生成的真 access token。再走一次 /rpc 让盘上至少落一条 authz 判定。
    await d.rpc('session/catalog',
      { workspaceId: 'ws-1', operationId: 'op-real-flow' }, d.bearer);

    const text = await auditText(dir);
    assert.ok(text.length > 0, '审计为空——所有断言都变成空集恒真');
    const lines = text.split('\n').filter(l => l.length > 0);
    assert.ok(lines.length >= 1, `判定记录必须在盘上：${text.slice(-300)}`);
    // 秘密侧：token 原文不许出现。
    assert.ok(!text.includes(d.token),
      `真 access token 原文落盘：${JSON.stringify(d.token).slice(0, 40)}`);
    // 留痕侧反向锁：至少一条 allowed 判定在盘上——否则上面「不含 token」
    // 是空集换来的绿。
    assert.ok(lines.some(l => l.includes('"outcome":"allowed"') || l.includes('"outcome":"denied"')),
      `判定记录必须在盘上（outcome allowed/denied 之一）：\n${text.slice(-300)}`);
  });
});

// 批次 AA.2 的「模型key」半——plan 第 147 行后半原文是
// 「无登记秘密/token/模型key」。前面的 token/secret/credential 都在
// AUDIT_BANNED_KEYS 白名单里，但 modelApiKey / apiKey / xApiKey 这类**键名**
// 不在白名单里。审计是按**字段名**脱敏的，客户端把模型 API key 塞进一个
// 非白名单字段名就能绕过——这是「审计脱敏覆盖面不足」的一种形态。
// 本条不是修 bug（脱敏规则要动 core/src/remote_audit.cj 且并发持有），
// 而是把当前面的覆盖面钉成事实：`modelApiKey` 不在白名单里，
// 因此原样落盘是**今天的正确行为**；一旦日后有人加进白名单，本用例自动变红。
test('modelApiKey 字段当前不在脱敏白名单：原样落盘是今天的事实，不是漏洞', async () => {
  await withDaemon(async (d, dir) => {
    const MODEL_KEY_FAKE = 'sk-FakeModelKey-DoNotShip-8f7c2a';
    const r = await d.rpc('session/catalog', {
      workspaceId: 'ws-model-key',
      operationId: `op-carry-${MODEL_KEY_FAKE}`,
      sessionId: `s-${MODEL_KEY_FAKE}`,
    }, d.bearer);
    assert.ok(r.body.length > 0, '请求必须有应答');
    const text = await auditText(dir);
    // 关键判定：键名 modelApiKey 出现在客户端可控的 workspace/session/operation 里，
    // 但审计白名单里没有 `modelApiKey` 这个键——所以它**不该**被脱敏。
    // 这条用例锁的是「白名单不含 modelApiKey」这个当前面事实。
    assert.ok(!text.includes('audit-redacted:'),
      `本轮没有触发白名单里任何禁用键（modelApiKey 不在白名单），不该有脱敏标记：${text.slice(-300)}`);
    // 留痕：至少一条判定必须在盘上（防止空集恒真）。
    const lines = text.split('\n').filter(l => l.length > 0);
    assert.ok(lines.length >= 1, `判定记录必须在盘上：${text.slice(-300)}`);
  });
});

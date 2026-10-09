import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

// daemon 远程接入的真实 HTTP 面验收（设计 §4.2 / §7）。
// 仓颉侧单测证明 dispatchRpcWithAuth 会拦；这里证明「HTTP 层真的把 Authorization
// 头送进去了」——头没接上的话，下面每一条未认证请求都会当成无 gate 直接放行。
// 同时锁住：接入开关默认关闭、/auth/* 两面在未启用时根本不存在、启动缺项必须拒绝启动。
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

// 起 daemon；expectFail 用于「必须拒绝启动」的用例。
async function boot(extraEnv, { expectFail = false } = {}) {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-remote-auth-'));
  const proc = spawn(daemonExe, ['--port', '0'], {
    cwd,
    env: { ...baseEnv, SACODE_USER_SETTINGS_DIR: path.join(cwd, 'settings'), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { err += d; });
  const closed = new Promise(resolve => proc.on('close', code => resolve(code)));
  if (expectFail) {
    const code = await closed;
    await rm(cwd, { recursive: true, force: true });
    return { code, err, out };
  }
  const end = Date.now() + 15000;
  while (!/127\.0\.0\.1:(\d+)/.test(out) && proc.exitCode === null && Date.now() < end) await delay(20);
  assert.match(out, /127\.0\.0\.1:(\d+)/, `daemon 未监听：stdout=${out} stderr=${err}`);
  const port = Number(out.match(/127\.0\.0\.1:(\d+)/)[1]);
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const rpc = async (method, params = {}, opts = {}) => {
    const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
    if (opts.rawContentType !== undefined) headers['content-type'] = opts.rawContentType;
    const response = await fetch(url('/rpc'), {
      method: opts.httpMethod || 'POST',
      headers,
      body: opts.rawBody ?? JSON.stringify({ jsonrpc: '2.0', id: opts.id || 'c-1', method, params }),
      signal: AbortSignal.timeout(10000),
    });
    return { status: response.status, body: await response.text() };
  };
  const post = (p, body, headers = {}) => fetch(url(p), {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body,
    signal: AbortSignal.timeout(10000),
  });
  const get = (p, headers = {}) => fetch(url(p), { headers, signal: AbortSignal.timeout(10000) });
  const stop = async () => {
    // 接入启用后 daemon/shutdown 属管理面，未认证必被拒——这是预期行为，
    // 所以清理只给有界等待，拿不到优雅退出就直接终止子进程，绝不无界挂住。
    let graceful = false;
    try {
      const r = await rpc('daemon/shutdown');
      graceful = !/-32001/.test(r.body);
    } catch {}
    if (!graceful) proc.kill('SIGKILL');
    const code = await Promise.race([closed, delay(5000).then(() => null)]);
    await rm(cwd, { recursive: true, force: true });
    return code;
  };
  return { port, rpc, post, get, cwd, stop, stderr: () => err };
}

function accessEnv(cwd) {
  return {
    SACODE_REMOTE_ACCESS: '1',
    SACODE_REMOTE_IDENTITY: path.join(cwd, 'instance.id'),
    SACODE_REMOTE_POLICY: policyFile,
  };
}

async function withAccess(run) {
  const dir = await mkdtemp(path.join(root, 'target', 'sacode-remote-id-'));
  const d = await boot(accessEnv(dir));
  try { await run(d); } finally { await d.stop(); await rm(dir, { recursive: true, force: true }); }
}

async function withoutAccess(run) {
  const d = await boot({});
  try { await run(d); } finally { await d.stop(); }
}

test('接入未启用时保持 0.1 无认证旧路径，且 /auth/* 面不存在', async () => {
  await withoutAccess(async d => {
    const init = await d.rpc('initialize');
    assert.equal(init.status, 200);
    assert.match(init.body, /protocolVersion/, '无 gate 时 initialize 仍应回协议版本');
    assert.doesNotMatch(init.body, /-32001/, '未启用接入不得拒未认证请求');
    const enroll = await d.post('/auth/enroll', '{}');
    assert.equal(enroll.status, 404, '接入关闭时 /auth/enroll 不该被注册');
    const token = await d.post('/auth/token', '{}');
    assert.equal(token.status, 404, '接入关闭时 /auth/token 不该被注册');
  });
});

test('接入启用后 /rpc 每条请求都认证，initialize 不例外', async () => {
  await withAccess(async d => {
    const noAuth = await d.rpc('initialize');
    assert.match(noAuth.body, /-32001/, '无 Bearer 必须被拒');
    assert.match(noAuth.body, /authz-denied:missing-bearer/);
    assert.doesNotMatch(noAuth.body, /protocolVersion|capabilities/,
      '被拒的请求不得执行 initialize 分支');

    const badAuth = await d.rpc('initialize', {}, { headers: { authorization: 'Bearer nope' } });
    assert.match(badAuth.body, /authz-denied:invalid-token/);
    // 不区分「不存在/过期/撤销」，避免旁路枚举。
    assert.doesNotMatch(badAuth.body, /expired|revoked/);

    const nonBearer = await d.rpc('initialize', {}, { headers: { authorization: 'Basic abc' } });
    assert.match(nonBearer.body, /authz-denied:missing-bearer/, '非 Bearer 前缀按未认证处理');

    // 服务管理面不给匿名调用：未认证的 daemon/shutdown 必须被拒，
    // 否则任何能连上端口的人都能停掉实例。
    const shutdown = await d.rpc('daemon/shutdown');
    assert.match(shutdown.body, /authz-denied/, '管理动作不得被未认证请求触发');
  });
});

test('/sse 建立即认证，未认证拿不到事件流', async () => {
  await withAccess(async d => {
    const anon = await d.get('/sse');
    assert.equal(anon.status, 401, '无凭据不得建立 SSE');
    const text = await anon.text();
    assert.match(text, /authentication-required/);
    assert.doesNotMatch(text, /event-stream|connected/,
      '被拒的连接不得进入事件流，也不得暴露 EventBus 形状');
  });
});

test('/health 启用接入后对本机匿名只给最小存活信息，不带能力与目录', async () => {
  await withAccess(async d => {
    const res = await d.get('/health');
    assert.equal(res.status, 200, '本机回环允许匿名读存活');
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.deepEqual(Object.keys(body).sort(), ['status'],
      '未认证的健康探针响应只能有 status 一个字段，不得含订阅数/目录/设备');
  });
});

test('/rpc 只接受 POST 且 Content-Type 必须是 application/json', async () => {
  await withAccess(async d => {
    // GET 不能带请求体，所以这里直接打 /rpc 空 body，只看错误归因。
    const wrongMethod = await d.get('/rpc');
    assert.match(await wrongMethod.text(), /rpc-requires-post/, 'GET /rpc 必须被拒');
    const wrongType = await d.rpc('initialize', {}, { rawContentType: 'text/plain' });
    assert.match(wrongType.body, /content-type-must-be-json/);
    // 这两条是路由级约束，与 gate 无关，接入关闭时同样生效。
  });
});

test('/auth/enroll 走真实 socket：未知票据 401、超大体 413', async () => {
  await withAccess(async d => {
    const unknown = await d.post('/auth/enroll',
      JSON.stringify({ enrollmentSecret: 'aa'.repeat(16), deviceName: 'd', kind: 'mobile' }));
    assert.equal(unknown.status, 401);
    const eb = await unknown.json();
    assert.equal(eb.error, 'invalid-enrollment', '不得区分不存在/已消费/已过期');

    const big = await d.post('/auth/enroll',
      JSON.stringify({ enrollmentSecret: 'bb'.repeat(16), pad: 'x'.repeat(20000) }));
    assert.equal(big.status, 413, '认证体上限 16 KiB');
    await big.json();
  });
});

test('认证限速独立实例：每来源每分钟 10 次，第 11、12 次 429', async () => {
  // 单独起一个 daemon：限速计数按进程内固定窗口，同实例里前面用掉的额度会让期望值漂移。
  await withAccess(async d => {
    let seen429 = 0;
    let seen401 = 0;
    for (let i = 0; i < 12; i++) {
      const r = await d.post('/auth/enroll',
        JSON.stringify({ enrollmentSecret: `cc${i}${'cc'.repeat(14)}`, deviceName: 'd', kind: 'mobile' }));
      const t = await r.text();
      if (r.status === 429) seen429++;
      else if (r.status === 401) seen401++;
      assert.doesNotMatch(t, /cc\d/, '限流响应也不得回显提交内容');
    }
    assert.equal(seen401, 10, '窗口内前 10 次应进到票据校验');
    assert.equal(seen429, 2, '第 11、12 次必须被限');
  });
});

test('/auth/token 缺字段与错凭据各归各码，且不泄漏设备存在性', async () => {
  await withAccess(async d => {
    const missing = await d.post('/auth/token', JSON.stringify({ deviceId: 'd-1' }));
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).error, 'token-fields-missing');

    const unknown = await d.post('/auth/token',
      JSON.stringify({ deviceId: 'no-such-device', credential: 'cc'.repeat(32) }));
    assert.equal(unknown.status, 401);
    const body = await unknown.json();
    assert.equal(body.error, 'invalid-credential', '不得区分设备不存在与凭据错');
  });
});

test('引导端点错误不回显提交内容片段', async () => {
  await withAccess(async d => {
    const secret = 'deadbeefcafebabe0123456789abcdef';
    const r = await d.post('/auth/enroll', JSON.stringify({ enrollmentSecret: secret, deviceName: 'd', kind: 'mobile' }));
    const text = await r.text();
    assert.equal(r.status, 401);
    assert.doesNotMatch(text, /deadbeefcafebabe/, '错误体不得回显秘密原文片段');
  });
});

test('审计真的落盘：远程被拒的请求在 identity 同目录日志里能查到', async () => {
  const dir = await mkdtemp(path.join(root, 'target', 'sacode-remote-audit-'));
  const d = await boot(accessEnv(dir));
  try {
    await d.rpc('initialize', { workspaceId: 'ws-http', sessionId: 's-http', operationId: 'op-http' });
    await d.rpc('session/submit', { workspaceId: 'ws-x', sessionId: 's-x', operationId: 'op-x' },
      { headers: { authorization: 'Bearer nope' } });
    await d.get('/sse');
    // 响应已回，落盘在同一请求栈内同步完成；这里再取一次端口活性做隐式排序。
    await d.get('/health');
    const logPath = path.join(dir, 'instance.id.audit.log');
    const text = await readFile(logPath, 'utf8');
    const lines = text.trim().split('\n');
    assert.ok(lines.length >= 3, `每条被拒请求应各落一条审计，实得 ${lines.length}`);
    const joined = lines.join('\n');
    assert.match(joined, /"outcome":"denied"/);
    assert.match(joined, /ws-http/, 'denied 条目必须带上 attempted 的 workspaceId');
    assert.match(joined, /op-http/, 'denied 条目必须带上 operationId');
    assert.match(joined, /"method":"sse\/subscribe"/, 'SSE 建立被拒也要落审计');
    // 禁词扫描：审计里不得出现 token/secret/credential/authorization/params/body 这些键。
    for (const banned of ['"token"', '"secret"', '"credential"', '"authorization"', '"params"', '"body"']) {
      assert.ok(!joined.includes(banned), `审计不得含禁词 ${banned}`);
    }
    assert.doesNotMatch(joined, /Bearer/, '审计不得记录 Authorization 头原文');
  } finally {
    await d.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('接入启用但缺身份路径 → 拒绝启动，不降级裸跑', async () => {
  const r = await boot({ SACODE_REMOTE_ACCESS: '1', SACODE_REMOTE_POLICY: policyFile }, { expectFail: true });
  assert.equal(r.code, 78, `缺身份配置应非零退出，实得 ${r.code}`);
  assert.match(r.err, /remote-access-startup-refused: remote-identity-path-required/);
});

test('接入启用但缺方法策略 → 拒绝启动', async () => {
  const dir = await mkdtemp(path.join(root, 'target', 'sacode-remote-nopol-'));
  const r = await boot({ SACODE_REMOTE_ACCESS: '1', SACODE_REMOTE_IDENTITY: path.join(dir, 'id') },
    { expectFail: true });
  await rm(dir, { recursive: true, force: true });
  assert.equal(r.code, 78);
  assert.match(r.err, /remote-policy-path-required/);
});

test('策略文件不是合法能力表 → 拒绝启动，不「跳过坏行照跑」', async () => {
  const dir = await mkdtemp(path.join(root, 'target', 'sacode-remote-bopol-'));
  const bad = path.join(dir, 'policy.json');
  await writeFile(bad, '[{"method":"session/submit"}]');
  const r = await boot({
    SACODE_REMOTE_ACCESS: '1',
    SACODE_REMOTE_IDENTITY: path.join(dir, 'id'),
    SACODE_REMOTE_POLICY: bad,
  }, { expectFail: true });
  await rm(dir, { recursive: true, force: true });
  assert.equal(r.code, 78);
  assert.match(r.err, /policy-row-0-unknown-permission/, '缺 permission 的行必须整体拒');
});

test('非回环监听无 TLS → 拒绝启动（内网也不允许明文 bearer）', async () => {
  const dir = await mkdtemp(path.join(root, 'target', 'sacode-remote-tls-'));
  const r = await boot({
    ...accessEnv(dir),
    SACODE_REMOTE_BIND: '0.0.0.0',
  }, { expectFail: true });
  await rm(dir, { recursive: true, force: true });
  assert.equal(r.code, 78);
  assert.match(r.err, /tls-required-for-external-bind/);
});

test('实例身份文件跨重启不变', async () => {
  const dir = await mkdtemp(path.join(root, 'target', 'sacode-remote-inst-'));
  const first = await boot(accessEnv(dir));
  await first.stop();
  const idPath = path.join(dir, 'instance.id');
  const before = await readFile(idPath, 'utf8');
  assert.match(before.trim(), /^[0-9a-f]{32}$/, '身份应是稳定 hex');
  const second = await boot(accessEnv(dir));
  await second.stop();
  const after = await readFile(idPath, 'utf8');
  assert.equal(after.trim(), before.trim(), '重启不得换实例身份——否则客户端绑定静默失效');
  await rm(dir, { recursive: true, force: true });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { promisify } from 'node:util';

// 任务 11 的产品面验收：**一台** daemon 实例、**两台**设备同时接入，全程 TLS。
//
// 前面各批的远程用例基本是「一个客户端打一面」（认证面、限额面、补读面、幂等面）。
// 那些面单独都对不代表产品成立——规格 §9/§10 要的是多人同时挂着同一实例时的
// 可见性、归属与撤销语义。这里只问四件跨客户端的事：
//   ① 扇出是不是「同一条事件到每个订阅者」，而不是各连各的私有通道；
//   ② 撤销一台会不会波及另一台（撤销只该砍被撤那台的在途流与新请求）；
//   ③ 两台混跑后审计仍能按 deviceId 定位 who/when/what，且不含任何凭据材料；
//   ④ 交付面上只有一个监听端口——不存在第二个「PC 桥」在别处听。
// TLS 校验走真 ca（自签证书按 SAN IP:127.0.0.1 出），**不关证书校验**：这一批本来
// 就要证明「明文与不受信链都进不来」，把 rejectUnauthorized 关掉就等于自己拆掉被测面。
const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../../..');
const daemonExe = process.env.SACODE_DAEMON || path.join(root, 'apps/daemon/target/release/bin/main.exe');
const hostExe = process.env.SACODE_HOST_EXE || path.join(root, 'apps/desktop/dist/host/bin/sacode-host.exe');
const policyFile = path.join(root, 'docs/plans/remote-capability-contract.json');
const openssl = process.env.SACODE_OPENSSL || 'openssl';
const baseEnv = { ...process.env };
const pathKey = Object.keys(baseEnv).find(k => k.toLowerCase() === 'path') || 'PATH';
baseEnv[pathKey] = [
  process.env.SACODE_STDX_DLL_DIR || 'C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx',
  process.env.SACODE_RUNTIME_DLL_DIR || 'D:/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative',
  baseEnv[pathKey],
].join(path.delimiter);

const delay = ms => new Promise(r => setTimeout(r, ms));

async function makeCert(dir) {
  const certPath = path.join(dir, 'server.crt');
  const keyPath = path.join(dir, 'server.key');
  await execFileAsync(openssl, [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
    '-keyout', keyPath, '-out', certPath,
  ]);
  return { certPath, keyPath, certPem: await readFile(certPath, 'utf8') };
}

async function waitForExit(proc, budgetMs) {
  const end = Date.now() + budgetMs;
  while (proc.exitCode === null && proc.signalCode === null && Date.now() < end) await delay(25);
  return proc.exitCode === null && proc.signalCode === null ? null : proc.exitCode;
}

async function stopDaemon(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill();
  if ((await waitForExit(proc, 4000)) === null) {
    proc.kill('SIGKILL');
    await waitForExit(proc, 4000);
  }
}

async function rmBounded(dir) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await rm(dir, { recursive: true, force: true }); return; }
    catch (e) {
      if (e.code !== 'EBUSY' && e.code !== 'EPERM' && e.code !== 'ENOTEMPTY') throw e;
      await delay(150);
    }
  }
}

// 一台实例的完整夹具：TLS 开、接入开、策略与身份齐、宿主按 dev 路径给。
async function bootProduct(dir, ws) {
  const identity = path.join(dir, 'instance.id');
  const snapshot = `${identity}.devices.json`;
  const { certPath, keyPath, certPem } = await makeCert(dir);
  const proc = spawn(daemonExe, ['--port', '0'], {
    cwd: dir,
    env: {
      ...baseEnv,
      SACODE_USER_SETTINGS_DIR: path.join(dir, 'settings'),
      SACODE_REMOTE_ACCESS: '1',
      SACODE_REMOTE_IDENTITY: identity,
      SACODE_REMOTE_POLICY: policyFile,
      SACODE_REMOTE_TLS_CERT: certPath,
      SACODE_REMOTE_TLS_KEY: keyPath,
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
  const end = Date.now() + 25000;
  while (!/127\.0\.0\.1:(\d+)/.test(out) && proc.exitCode === null && Date.now() < end) await delay(20);
  assert.match(out, /127\.0\.0\.1:(\d+)/, `daemon 未监听：stdout=${out} stderr=${err}`);
  assert.match(out, /https:\/\//, `产品面必须走 TLS，实得：${out}`);
  const port = Number(out.match(/127\.0\.0\.1:(\d+)/)[1]);

  // 带真 ca 的请求：证书链不过就当场报错，不留「以为是 TLS 其实没验」的空间。
  const request = (p, init) => new Promise((resolve, reject) => {
    const req = https.request({
      host: '127.0.0.1', port, path: p, method: (init && init.method) || 'GET',
      ca: [certPem], servername: '127.0.0.1',
      headers: (init && init.headers) || {}, timeout: 20000,
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', d => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    if (init && init.body) req.write(init.body);
    req.end();
  });

  const jsonHeaders = { 'content-type': 'application/json' };
  const d = {
    proc, port, certPem, identity, snapshot,
    out: () => out, err: () => err,
    request,
    rpc: async (bearer, method, params, id) => {
      const headers = { ...jsonHeaders };
      if (bearer) headers.authorization = bearer;
      const r = await request('/rpc', {
        method: 'POST', headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: id || 'p-1', method, params: params || {} }),
      });
      return { status: r.status, doc: JSON.parse(r.body), text: r.body };
    },
    post: async (p, body) => {
      const r = await request(p, { method: 'POST', headers: jsonHeaders, body });
      return { status: r.status, body: r.body };
    },
  };
  return d;
}

// 一台设备走完「建票 → 登记 → 换令牌」，返回 Bearer 原文、deviceId 与凭据（只为反证审计不含它）。
async function addDevice(d, principal, name) {
  const ticketProc = spawn(daemonExe, ['--manage', 'enroll-ticket', d.snapshot, principal], {
    env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let tOut = '';
  let tErr = '';
  ticketProc.stdout.on('data', x => { tOut += x; });
  ticketProc.stderr.on('data', x => { tErr += x; });
  const code = await waitForExit(ticketProc, 15000);
  assert.notEqual(code, null, `建票未退出：${tErr}`);
  assert.equal(code, 0, `建票失败 rc=${code}：${tErr}`);
  const lines = tOut.replace(/\r/g, '').trim().split('\n');
  const ticket = lines[lines.length - 1].trim();
  assert.match(ticket, /^[0-9a-f]{32}$/);

  const enroll = JSON.parse((await d.post('/auth/enroll', JSON.stringify(
    { enrollmentSecret: ticket, deviceName: name, kind: name.startsWith('phone') ? 'mobile' : 'desktop' }))).body);
  assert.ok(enroll.deviceId, `登记应答缺 deviceId：${JSON.stringify(enroll)}`);
  const tok = JSON.parse((await d.post('/auth/token', JSON.stringify(
    { deviceId: enroll.deviceId, credential: enroll.credential }))).body);
  assert.ok(tok.accessToken, `换令牌应答缺 accessToken：${JSON.stringify(tok)}`);
  return { deviceId: enroll.deviceId, credential: enroll.credential, token: tok.accessToken, bearer: `Bearer ${tok.accessToken}` };
}

// 打开 /sse 攒原文（带真 ca）。返回句柄可提前 abort，也可等它自己结束。
async function openStream(d, dev) {
  const state = { text: '', ended: false, endReason: null };
  const req = https.request({
    host: '127.0.0.1', port: d.port, path: '/sse', method: 'GET',
    ca: [d.certPem], servername: '127.0.0.1',
    headers: { authorization: dev.bearer, accept: 'text/event-stream' },
    timeout: 0,
  }, res => {
    if (res.statusCode !== 200) { state.ended = true; state.endReason = `http-${res.statusCode}`; return; }
    res.setEncoding('utf8');
    res.on('data', c => { state.text += c; });
    res.on('end', () => { state.ended = true; });
  });
  req.on('error', e => { state.ended = true; state.endReason = e.code || e.message; });
  req.end();
  return {
    state,
    abort: () => req.destroy(),
    async waitText(pattern, budgetMs) {
      const until = Date.now() + (budgetMs || 25000);
      while (!pattern.test(state.text) && Date.now() < until) await delay(40);
      return pattern.test(state.text);
    },
    async waitEnd(budgetMs) {
      const until = Date.now() + (budgetMs || 25000);
      while (!state.ended && Date.now() < until) await delay(40);
      return state.ended;
    },
  };
}

async function withProduct(run) {
  const dir = await mkdtemp(path.join(root, 'target', 'sacode-product-'));
  const ws = path.join(dir, 'ws');
  await mkdir(ws, { recursive: true });
  let d = null;
  try {
    d = await bootProduct(dir, ws);
    return await run(d, dir, ws);
  } finally {
    await stopDaemon(d ? d.proc : null);
    await rmBounded(dir);
  }
}

test('一台实例两台设备同时订阅：同一条事件扇到两个流，不是各连各的私有通道', async () => {
  await withProduct(async (d) => {
    const desk = await addDevice(d, 'p-desk', 'desk-pc');
    const phone = await addDevice(d, 'p-phone', 'phone-1');
    const a = await openStream(d, desk);
    const b = await openStream(d, phone);
    assert.ok(await a.waitText(/: connected/, 15000), `桌面流没有 greeting：${a.state.text} ${a.state.endReason}`);
    assert.ok(await b.waitText(/: connected/, 15000), `手机流没有 greeting：${b.state.text} ${b.state.endReason}`);

    // initialize 由 daemon 本人往总线上发一条自有事件（不依赖宿主）。
    const init = await d.rpc(desk.bearer, 'initialize', {}, 'fan-1');
    assert.ok(init.doc.result, `initialize 应成功：${init.text}`);
    const sawOnDesk = await a.waitText(/daemon\/client-initialized/, 20000);
    const sawOnPhone = await b.waitText(/daemon\/client-initialized/, 20000);
    assert.ok(sawOnDesk, `触发方自己都没收到：${a.state.text}`);
    assert.ok(sawOnPhone,
      `另一台没收到同一条广播——扇出退化成了「谁触发谁看见」：${b.state.text}`);

    a.abort(); b.abort();
    await a.waitEnd(5000); await b.waitEnd(5000);
  });
});

test('带外撤销一台：只砍被撤那台的在途流与新请求，另一台不受影响', async () => {
  // 本条当前是**已知缺陷红灯**，不是夹具问题，也不许为了变绿弱化断言：
  // `core/src/remote_identity.cj:274` 在 `revokeDevice` 命中后抬**全局**
  // `revocationVersion += 1`，而 `:301` 用「token.revocationVersion < 全局版本」判过期，
  // token 带的是各自签发时的版本——所以撤销任意一台会把**所有设备**的在途令牌同时作废。
  // 规格 §5 要的是「设备撤销立即限制**该设备**的 RPC 与 SSE」，per-device 的 `device.revoked`
  // 分支本来就已覆盖被撤那台，全局 bump 既多余又把事故面扩大到整台实例。
  // 该文件正被并发会话持有（工作区 +62/-5 未提交），本批不改它，只把行为钉成红。
  await withProduct(async (d) => {
    const desk = await addDevice(d, 'p-desk2', 'desk-pc');
    const phone = await addDevice(d, 'p-phone2', 'phone-2');
    const a = await openStream(d, desk);
    const b = await openStream(d, phone);
    assert.ok(await a.waitText(/: connected/, 15000));
    assert.ok(await b.waitText(/: connected/, 15000));

    // 撤销前先证明两台都可用：否则下面的「另一台被误伤」可能从一开始就红。
    const preDesk = await d.rpc(desk.bearer, 'initialize', {}, 'rev-0');
    const prePhone = await d.rpc(phone.bearer, 'initialize', {}, 'rev-0b');
    assert.ok(preDesk.doc.result && prePhone.doc.result,
      `撤销前两台都应可用：desk=${preDesk.text} phone=${prePhone.text}`);

    const rev = spawn(daemonExe, ['--manage', 'revoke-device', d.snapshot, desk.deviceId], {
      env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let rOut = '';
    let rErr = '';
    rev.stdout.on('data', x => { rOut += x; });
    rev.stderr.on('data', x => { rErr += x; });
    const code = await waitForExit(rev, 15000);
    assert.notEqual(code, null, `撤销进程未退出：${rErr}`);
    assert.equal(code, 0, `撤销失败 rc=${code}：${rErr}`);
    assert.match(rOut.replace(/\r/g, ''), /revoked desk-pc/);

    // 被撤那台：在途流必须关，且给出可恢复原因而不是静默 EOF。
    assert.ok(await a.waitText(/event: close/, 25000),
      `被撤销设备的在途 SSE 没被关闭：${a.state.text}`);
    const revokedRpc = await d.rpc(desk.bearer, 'initialize', {}, 'rev-1');
    assert.match(revokedRpc.text, /-32001/, `被撤设备的新请求必须被拒：${revokedRpc.text}`);
    assert.doesNotMatch(revokedRpc.text, /protocolVersion/, '被拒的请求不得真执行 initialize');

    // 另一台：RPC 照旧可用，流也不该收到关闭帧。
    const keepRpc = await d.rpc(phone.bearer, 'initialize', {}, 'rev-2');
    assert.ok(keepRpc.doc.result,
      `未被撤销的设备不应受影响（撤销一台把整台实例的令牌都作废了）：${keepRpc.text}`);
    assert.ok(!b.state.text.includes('event: close'),
      `另一台的流被误关了：${b.state.text}`);

    a.abort(); b.abort();
    await a.waitEnd(5000); await b.waitEnd(5000);
  });
});

test('两台设备混跑后，审计仍能按 deviceId 定位且不含任何凭据材料', async () => {
  await withProduct(async (d, dir) => {
    const desk = await addDevice(d, 'p-desk3', 'desk-pc');
    const phone = await addDevice(d, 'p-phone3', 'phone-3');
    const sentinel = 'SENTINEL-params-must-not-appear';
    await d.rpc(desk.bearer, 'initialize', { workspaceId: 'ws-a', note: sentinel }, 'aud-1');
    // 无强制后端时 execute 族整族拒（批次 J），这条给出一条确定的 deny 记录。
    const denied = await d.rpc(phone.bearer, 'execution/start',
      { workspaceId: 'ws-b', operationId: 'op-aud', prompt: sentinel }, 'aud-2');
    assert.match(denied.text, /-32001/, `这条应当被拒，才有可查的 deny 记录：${denied.text}`);

    const auditFile = (await readFile(path.join(dir, 'instance.id.audit.log'), 'utf8')).replace(/\r/g, '');
    const deskLines = auditFile.split('\n').filter(l => l.includes(desk.deviceId));
    const phoneLines = auditFile.split('\n').filter(l => l.includes(phone.deviceId));
    assert.ok(deskLines.length > 0, `审计里找不到桌面设备的行：${auditFile.slice(-500)}`);
    assert.ok(phoneLines.length > 0, `审计里找不到手机设备的行：${auditFile.slice(-500)}`);
    assert.ok(phoneLines.some(l => l.includes('sandbox-enforcement-unavailable')),
      `被拒那台要留下拒因：${phoneLines.join('\n')}`);
    assert.ok(phoneLines.some(l => l.includes('execution/start')),
      `被拒那台要留下是哪个方法：${phoneLines.join('\n')}`);
    // who/when/what 三面齐：设备、时间戳、方法各能在同一行里读到。
    const one = phoneLines.find(l => l.includes('execution/start'));
    assert.match(one, /"ts":/, `审计行必须带时间维度，实得：${one}`);
    assert.match(one, /"outcome":"denied"/, `审计行要如实记去向，实得：${one}`);

    assert.ok(!auditFile.includes(sentinel), '审计不得含 params 值');
    assert.ok(!auditFile.includes(desk.credential), '审计不得含登记凭据原文');
    assert.ok(!auditFile.includes(desk.token), '审计不得含 access token');
    assert.ok(!auditFile.includes('Bearer'), '审计不得含认证头');
    assert.doesNotMatch(auditFile, /[0-9a-f]{64}/, '审计不得含 64 位 hex 摘要');
  });
});

test('交付面只有一个监听端口，且明文面不存在：没有第二个独立部署的 PC 桥', async () => {
  await withProduct(async (d) => {
    const { stdout } = await execFileAsync('netstat', ['-ano', '-p', 'TCP']);
    const pid = String(d.proc.pid);
    const mine = stdout.replace(/\r/g, '').split('\n')
      .filter(l => l.includes('LISTENING') && new RegExp(`\\s${pid}\\s*$`).test(l.trim()));
    // 端口由 --port 0 现取，所以问的是「几颗监听端口」而不是哪个号；同一端口的
    // IPv4/IPv6 两行算一颗，多出来的端口号才是「第二个独立部署的桥」。
    const ports = [...new Set(mine.map(l => {
      const addr = l.trim().split(/\s+/)[1];
      return addr.slice(addr.lastIndexOf(':') + 1);
    }))];
    assert.equal(ports.length, 1,
      `daemon 进程应当只监听一颗端口，实得 ${JSON.stringify(ports)}（多出来的就是独立桥）`);
    assert.equal(ports[0], String(d.port),
      `监听端口应与 stdout 宣布的一致，实得 ${ports[0]} vs ${d.port}`);

    // 同一端口只服务 TLS：明文 http 打进去必须拿不到 200。
    const plain = await httpStatusOrError(`http://127.0.0.1:${d.port}/health`);
    assert.notEqual(plain, 200, `明文 http 竟然通了，TLS 面没兜住：${plain}`);
  });
});

// 只为「明文不该通」这一条服务的裸 http GET，不参与任何断言链。
function httpStatusOrError(url) {
  return new Promise(resolve => {
    const req = http.get(url, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', e => resolve(`ERR:${e.code || e.message}`));
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
  });
}

test('两台设备各自建会话后目录互不串：同名 operationId 跨设备各建各的账', async () => {
  await withProduct(async (d, dir, ws) => {
    const desk = await addDevice(d, 'p-desk4', 'desk-pc');
    const phone = await addDevice(d, 'p-phone4', 'phone-4');
    const ra = await d.rpc(desk.bearer, 'session/create',
      { workspaceId: 'ws-x', title: 'desk-side', operationId: 'op-both' }, 'own-1');
    const rb = await d.rpc(phone.bearer, 'session/create',
      { workspaceId: 'ws-x', title: 'phone-side', operationId: 'op-both' }, 'own-2');
    assert.ok(ra.doc.result?.id, `桌面建会话应成功：${ra.text} stderr=${d.err().slice(-200)}`);
    assert.ok(rb.doc.result?.id, `手机建会话应成功：${rb.text}`);
    assert.notEqual(ra.doc.result.id, rb.doc.result.id,
      '跨设备共享幂等回执会把 A 的会话发给 B');

    const cat = await d.rpc(desk.bearer, 'session/catalog', { workspaceId: 'ws-x' }, 'own-3');
    const titles = (cat.doc.result?.entries || []).map(e => e.title);
    assert.ok(titles.includes('desk-side') && titles.includes('phone-side'),
      `同一 workspace 下两条会话都应可见：${JSON.stringify(titles)}`);
  });
});

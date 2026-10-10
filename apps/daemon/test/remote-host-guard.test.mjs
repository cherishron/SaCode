import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

// §7 的 Host / DNS rebinding 那一档，在真 HTTP 面上的行为。
//
// 为什么 Origin「出现即拒」不够：客户端可以根本不带 Origin，而把 attacker.example
// 解析到 127.0.0.1 之后，连接本身就是本机回环——此时唯一还留下的判据是它自称在访问谁。
//
// 这套用例必须同时钉住两侧，缺一侧都是假绿：
//   正向：不在允许集里的 Host 被拒，且拒因点名 host-not-allowed（不是 missing-bearer
//         或 method-not-registered——归因混了就等于没这条门禁）；
//   反向：带端口、无端口、大小写这些**同一个主机的不同写法**都必须走到门禁之外，
//         否则这条门禁只是把正常客户端挡在门外。
// 覆盖面按真实分派形状写：/rpc 的抛出被 errRpc 映射成 HTTP 200 + JSON-RPC -32600，
// /sse 的拒绝是 403 且不建流。/health 不走 jsonBodyOf，所以它不是这条门禁的现场——
// 只在需要端口锚点时用它，别把它当成 Host 检查已生效的证据。
const root = path.resolve(import.meta.dirname, '../../..');
const daemonExe = process.env.SACODE_DAEMON || path.join(root, 'apps/daemon/target/release/bin/main.exe');
const baseEnv = { ...process.env };
const pathKey = Object.keys(baseEnv).find(k => k.toLowerCase() === 'path') || 'PATH';
baseEnv[pathKey] = [
  process.env.SACODE_STDX_DLL_DIR || 'C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx',
  process.env.SACODE_RUNTIME_DLL_DIR || 'D:/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative',
  baseEnv[pathKey],
].join(path.delimiter);

const delay = ms => new Promise(r => setTimeout(r, ms));
const HOST_DENY = 'host-not-allowed';
const RPC_BODY = JSON.stringify({ jsonrpc: '2.0', id: 'host-1', method: 'initialize', params: {} });

function request(port, { method = 'POST', path: p = '/rpc', host, headers = {}, body = RPC_BODY }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, method, path: p,
      // 显式给 host 头：Node 只在缺省时用连接地址填，给了就以它为准。
      headers: { host, 'content-type': 'application/json', ...headers },
      signal: AbortSignal.timeout(10000),
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', d => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: text.replace(/\r/g, '') }));
    });
    req.on('error', reject);
    if (body !== undefined && method !== 'GET') req.write(body);
    req.end();
  });
}

async function boot(dir, extraEnv = {}) {
  const proc = spawn(daemonExe, ['--port', '0'], {
    cwd: dir,
    env: { ...baseEnv, SACODE_USER_SETTINGS_DIR: path.join(dir, 'settings'), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { err += d; });
  const end = Date.now() + 20000;
  while (!/daemon on \S+:\/\/[^\s]+:(\d+)/.test(out) && proc.exitCode === null && Date.now() < end) await delay(20);
  const m = out.match(/daemon on \S+:\/\/[^\s]+:(\d+)/);
  assert.ok(m, `daemon 未监听：stdout=${out} stderr=${err}`);
  const port = Number(m[1]);
  const rpc = (host, headers = {}) => request(port, { host, headers });
  const stream = (host) => request(port, { method: 'GET', path: '/sse', host, body: undefined });
  return { proc, port, rpc, stream, err: () => err };
}

// 裸 socket 才能发出 Node 的 http 客户端不会发的形态：缺 Host、重复 Host、HTTP/1.0。
// 这些形态正是要区分「传输层挡的」和「本仓门禁挡的」的那一批。
function rawRequest(port, headerLines, body) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1');
    let acc = '';
    let settled = false;
    const finish = () => {
      if (settled) { return; }
      settled = true;
      s.destroy();
      resolve(acc.replace(/\r/g, ''));
    };
    let idle = null;
    s.setTimeout(8000);
    s.on('data', d => {
      acc += d;
      if (idle) clearTimeout(idle);
      // 收到响应后静置 250ms 再收：400 的短正文与 JSON-RPC 错误正文都会在这一窗内到齐。
      idle = setTimeout(finish, 250);
    });
    s.on('timeout', finish);
    s.on('close', finish);
    s.on('error', e => { if (!settled) { settled = true; reject(e); } });
    s.write(`${headerLines.join('\r\n')}\r\n\r\n${body}`);
  });
}

async function waitForExit(proc, budgetMs) {
  const end = Date.now() + budgetMs;
  while (proc.exitCode === null && proc.signalCode === null && Date.now() < end) await delay(25);
  return proc.exitCode !== null || proc.signalCode !== null ? 0 : null;
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

async function withDaemon(run, extraEnv = {}) {  const dir = await mkdtemp(path.join(root, 'target', 'sacode-host-guard-'));
  let d = null;
  try {
    d = await boot(dir, extraEnv);
    return await run(d, dir);
  } finally {
    await stopDaemon(d ? d.proc : null);
    await removeDir(dir);
  }
}

test('回环主机的不同写法都不该被门禁拒——否则这条只是在挡自己人', async () => {
  await withDaemon(async (d) => {
    for (const host of [`127.0.0.1:${d.port}`, '127.0.0.1', `localhost:${d.port}`, `LOCALHOST:${d.port}`, '[::1]:80']) {
      const r = await d.rpc(host);
      assert.equal(r.status, 200, `Host=${JSON.stringify(host)} 的 HTTP 层不该被改动：${r.body}`);
      assert.ok(!r.body.includes(HOST_DENY),
        `Host=${JSON.stringify(host)} 是同一台本机的不同写法，不该吃到 Host 门禁：${r.body}`);
    }
  });
});

test('把别的主机名打到本机回环被拒，拒因点名门禁本身', async () => {
  await withDaemon(async (d) => {
    // 这条就是重绑定的形状：连接是本机，Host 自称是别人的域。
    const r = await d.rpc('attacker.example');
    assert.ok(r.body.includes(HOST_DENY), `重绑定请求必须被点名拒绝，实得 ${r.status} ${r.body}`);
    // 后缀拼贴：里面确实含着 127.0.0.1，但它不是那个主机。
    const suffix = await d.rpc('127.0.0.1.attacker.example');
    assert.ok(suffix.body.includes(HOST_DENY), `后缀拼贴必须拒：${suffix.body}`);
    // 对照组必须仍在同一轮里成立，否则上面两条可以是「整面拒绝」换来的。
    const ok = await d.rpc(`127.0.0.1:${d.port}`);
    assert.ok(!ok.body.includes(HOST_DENY), `对照组被连带拒了，说明这条红是 blanket 拒绝：${ok.body}`);
  });
});

test('缺 Host / 重复 Host / 堆叠 Host 由传输层先挡，绝不走到分派', async () => {
  await withDaemon(async (d) => {
    const body = RPC_BODY;
    const len = Buffer.byteLength(body);
    const cases = [
      ['完全没有 Host 头', [`POST /rpc HTTP/1.1`, 'Content-Type: application/json', `Content-Length: ${len}`]],
      ['Host 值为空', [`POST /rpc HTTP/1.1`, 'Host: ', 'Content-Type: application/json', `Content-Length: ${len}`]],
      ['两个 Host 头', [`POST /rpc HTTP/1.1`, `Host: 127.0.0.1:${d.port}`, 'Host: attacker.example',
        'Content-Type: application/json', `Content-Length: ${len}`]],
      ['单个 Host 里堆两个值', [`POST /rpc HTTP/1.1`, `Host: 127.0.0.1:${d.port}, attacker.example`,
        'Content-Type: application/json', `Content-Length: ${len}`]],
    ];
    for (const [label, lines] of cases) {
      const resp = await rawRequest(d.port, lines, body);
      // 这一档的判据是「没走到分派」：响应里既没有 JSON-RPC 结果，也没有本机身份字段。
      // 谁给的拒因由传输层决定（实测 stdx 回 `Host should be and only one.` /
      // `Host should be only one.` / `Malformed host header.`），所以这里不钉死那句英文，
      // 只钉「这条请求没有产生任何业务效果」。
      assert.ok(!/"result"/.test(resp), `${label} 不该走到分派：${resp.slice(0, 200)}`);
      assert.ok(!resp.includes('"protocolVersion"'), `${label} 不该拿到 initialize 结果：${resp.slice(0, 200)}`);
    }
  });
});

test('HTTP/1.0 不带 Host 时传输层不管，这条由本仓门禁挡下', async () => {
  // 上一条里三种畸形形态 stdx 自己在解析层就 400 了；HTTP/1.0 是唯一「没有 Host 但解析器
  // 接受」的形态——实测它会走到我们的检查。也就是说没有 hostViolation 时，
  // 一条匿名 HTTP/1.0 请求是可以直接进分派的，这条必须钉住。
  await withDaemon(async (d) => {
    const len = Buffer.byteLength(RPC_BODY);
    const resp = await rawRequest(d.port, [
      'POST /rpc HTTP/1.0', 'Content-Type: application/json', `Content-Length: ${len}`,
    ], RPC_BODY);
    assert.ok(resp.includes(HOST_DENY),
      `HTTP/1.0 缺 Host 要由本仓门禁点名拒绝，实得：${resp.slice(0, 220)}`);
    assert.ok(!/"result"/.test(resp), `拒了就不能同时走到分派：${resp.slice(0, 220)}`);
  });
});

test('Host 拒因不与认证或方法未登记混在一起', async () => {
  await withDaemon(async (d) => {
    const r = await d.rpc('attacker.example');
    assert.ok(r.body.includes(HOST_DENY),
      `拒因必须是 host-not-allowed，不能混成认证或分派问题：${r.status} ${r.body}`);
    assert.ok(!r.body.includes('missing-bearer'),
      `接入未启用时本来没有认证这道归因；启用时 Host 也在 gate 之前，两条才不会串：${r.body}`);
    assert.ok(!r.body.includes('method-not-registered'), `不能被归成分派问题：${r.body}`);
    // 同一个请求换个合法 Host 就能走到分派——证明拒的是主机名，不是请求本身。
    const ok = await d.rpc(`127.0.0.1:${d.port}`);
    assert.ok(!ok.body.includes(HOST_DENY), `同请求的合法 Host 版本必须照旧：${ok.body}`);
  });
});

test('SACODE_REMOTE_ALLOWED_HOSTS 加白 LAN 主机名，没加的仍拒', async () => {
  await withDaemon(async (d) => {
    const named = await d.rpc(`phone.lan:${d.port}`);
    assert.ok(!named.body.includes(HOST_DENY), `显式加白的主机名必须可用：${named.body}`);
    // 大小写与端口是同一主机的不同写法，加白以后两侧都要认。
    const upper = await d.rpc('PHONE.LAN');
    assert.ok(!upper.body.includes(HOST_DENY), `大小写变体不该被拒：${upper.body}`);
    const notListed = await d.rpc('tablet.lan');
    assert.ok(notListed.body.includes(HOST_DENY), `没加白的一律拒：${notListed.body}`);
  }, { SACODE_REMOTE_ALLOWED_HOSTS: 'phone.lan, tablet2.lan ' });
});

test('bind=0.0.0.0 不等于放行任意主机名，且启动要说出来', async () => {
  await withDaemon(async (d) => {
    const asAny = await d.rpc(`0.0.0.0:${d.port}`);
    assert.ok(asAny.body.includes(HOST_DENY),
      `0.0.0.0 是「所有网卡」而不是一个能被 Host 指名道姓的主机，不能进允许集：${asAny.body}`);
    const evil = await d.rpc('evil.example');
    assert.ok(evil.body.includes(HOST_DENY), `非回环主机名在没有显式配置时仍须拒：${evil.body}`);
    const loop = await d.rpc(`127.0.0.1:${d.port}`);
    assert.ok(!loop.body.includes(HOST_DENY),
      `回环写法必须仍然可用，否则这条门禁会把本机客户端一起挡掉：${loop.body}`);
    assert.ok(d.err().includes('remote-host-warning'),
      `绑定到所有网卡又没配主机名，必须在 stderr 说出来：${d.err().slice(0, 200)}`);
  }, { SACODE_REMOTE_BIND: '0.0.0.0' });
});

test('/sse 的 Host 拒发生在订阅之前，一条流位都不占', async () => {
  await withDaemon(async (d) => {
    const r = await d.stream('attacker.example');
    assert.equal(r.status, 403, `流面同样要挡在订阅前，实得 ${r.status} ${r.body}`);
    assert.ok(r.body.includes(HOST_DENY), `拒因要点名 Host 门禁：${r.body}`);
    // 订阅成功的形状是 `: connected` 问候帧；它出现即说明检查排在订阅之后。
    assert.ok(!r.body.includes(': connected'), `不该已经建流：${r.body.slice(0, 160)}`);
  });
});

test('Origin 与 Host 两条检查共存：合法 Host 带 Origin 仍按 Origin 拒', async () => {
  await withDaemon(async (d) => {
    const r = await d.rpc(`127.0.0.1:${d.port}`, { origin: 'http://evil.example' });
    assert.ok(r.body.includes('origin-not-allowed'),
      `Origin 出现即拒这条不能因为加了 Host 而失效：${r.body}`);
    assert.ok(!r.body.includes(HOST_DENY), `Origin 在前，不该串成 Host 拒因：${r.body}`);
    // 反向：恶意的 Origin 配上恶意的 Host 时，报的仍是 Origin（顺序即归因）。
    const both = await d.rpc('attacker.example', { origin: 'http://evil.example' });
    assert.ok(both.body.includes('origin-not-allowed') && !both.body.includes(HOST_DENY),
      `两条门禁的归因必须可分：${both.body}`);
  });
});

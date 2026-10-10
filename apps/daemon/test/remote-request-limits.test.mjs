import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

// 设计 §7「请求安全」里结构那一档的端到端反证：跑的是真 daemon（接入已启用），
// 观测量是 HTTP 面上的 JSON-RPC 错误对象与磁盘上那份审计日志。
// 白盒 cj 单测能证明扫描器判得对，证明不了「拒绝发生在授权与审计之前」——
// 那要打到真进程才算数，所以这里三条排序用例各配一条阳性对照：
// 少了对照，「审计里没有它」也可能只是审计根本没在写。
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

async function rmBounded(dir) {
  const until = Date.now() + 8000;
  for (;;) {
    try { await rm(dir, { recursive: true, force: true }); return; }
    catch (e) { if (Date.now() >= until) throw e; await delay(200); }
  }
}

// 这批用例不需要真宿主：结构门禁要么在转发之前就拒，要么打在 daemon 自己的
// initialize / session/catalog 上。缺 SACODE_HOST 反而是有利的——任何
// 「-32010 宿主未配置」都不会冒充成结构拒绝。
async function boot(cwd) {
  assert.ok(existsSync(daemonExe), `需要 daemon 产物：${daemonExe} 不存在。先跑 cd apps/daemon && cjpm build`);
  const proc = spawn(daemonExe, ['--port', '0'], {
    cwd,
    env: {
      ...baseEnv,
      SACODE_USER_SETTINGS_DIR: path.join(cwd, 'settings'),
      SACODE_REMOTE_ACCESS: '1',
      SACODE_REMOTE_IDENTITY: path.join(cwd, 'instance.id'),
      SACODE_REMOTE_POLICY: policyFile,
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
    ws: cwd.replace(/\\/g, '/'),
    auditFile: path.join(cwd, 'instance.id.audit.log'),
    stderr: () => err,
    stop: async () => {
      const closed = new Promise(resolve => proc.on('close', resolve));
      proc.kill('SIGKILL');
      await Promise.race([closed, delay(3000)]);
    },
    url: p => `http://127.0.0.1:${port}${p}`,
  };
}

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

// 发**原文**正文：这几条用例的输入本身就是要畸形的，JSON.stringify 会把夹具自己改写掉。
async function raw(d, body, bearer = '', extraHeaders = {}) {
  const headers = { 'content-type': 'application/json', ...extraHeaders };
  if (bearer) headers.authorization = bearer;
  const r = await fetch(d.url('/rpc'), { method: 'POST', headers, body, signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 交给断言去红 */ }
  return { status: r.status, json, text };
}

function nested(depth, open, close) {
  return open.repeat(depth) + close.repeat(depth);
}

async function readAudit(d) {
  if (!existsSync(d.auditFile)) return '';
  return (await readFile(d.auditFile, 'utf8')).replace(/\r/g, '');
}

test('顶层 batch 数组按「不支持批量」拒，同一条拆成对象信封就打到分派', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-schema-batch-'));
  const d = await boot(cwd);
  try {
    const { bearer } = await device(d, cwd, 'p-batch', 'batch');
    const r = await raw(d, JSON.stringify([{ jsonrpc: '2.0', id: 'b-1', method: 'initialize', params: {} }]), bearer);
    assert.equal(r.json?.error?.code, -32600, `batch 要按无效请求回：${r.text}`);
    assert.match(r.json.error.message, /batch-not-allowed/, `归因要说清是批量不被支持，不是帧写坏了：${r.text}`);
    // 阳性对照：同一帧去掉外层数组就正常应答——证明拒的是「批量」这层信封。
    const ok = await raw(d, JSON.stringify({ jsonrpc: '2.0', id: 'b-2', method: 'initialize', params: {} }), bearer);
    assert.ok(ok.json?.result, `对象信封应能应答：${ok.text}`);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('无 id 的业务通知按「通知不允许」拒，补上 id 的同一帧能被应答', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-schema-notify-'));
  const d = await boot(cwd);
  try {
    const { bearer } = await device(d, cwd, 'p-notify', 'notify');
    const r = await raw(d, JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: {} }), bearer);
    assert.equal(r.json?.error?.code, -32600, `通知要按无效请求回：${r.text}`);
    assert.match(r.json.error.message, /notification-not-allowed/, `归因不能停在含糊的 invalid request：${r.text}`);
    const ok = await raw(d, JSON.stringify({ jsonrpc: '2.0', id: 'n-1', method: 'initialize', params: {} }), bearer);
    assert.ok(ok.json?.result, `带 id 的同一帧应能应答：${ok.text}`);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('超长方法名进不了授权表也进不了审计；未知但合法的方法名两边都留下了痕', async () => {
  // 排序证据：结构门禁在 gate.check 之前。方法名是要写进审计行的裸字符串，
  // 让它带 200 字节进审计就是给日志喂垃圾；所以「审计里没有它」是本条的正身。
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-schema-method-'));
  const d = await boot(cwd);
  try {
    const { bearer } = await device(d, cwd, 'p-method', 'method');
    const longName = 'a'.repeat(200);
    const denied = await raw(d, JSON.stringify({ jsonrpc: '2.0', id: 'm-1', method: longName, params: {} }), bearer);
    assert.equal(denied.json?.error?.code, -32600, `超长方法名要按无效请求回：${denied.text}`);
    assert.match(denied.json.error.message, /method-name-invalid/);
    // 阳性对照：一条合法但未登记的方法名，既被拒（授权面）又被记进审计（证明审计真在写）。
    const unknown = await raw(d, JSON.stringify({ jsonrpc: '2.0', id: 'm-2', method: 'no/such-method', params: {} }), bearer);
    assert.match(unknown.json?.error?.message || '', /authz-denied/, `未登记方法应走授权拒绝：${unknown.text}`);
    const audit = await readAudit(d);
    assert.match(audit, /no\/such-method/, `阳性对照没落进审计，那下面的「不含它」就是假绿：${audit.slice(0, 400)}`);
    assert.ok(!audit.includes(longName), `被结构拒掉的方法名不该出现在审计里：${audit.slice(0, 400)}`);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('结构门禁在认证之前，未认证也先按结构归因', async () => {
  // §7 这几条是路由/结构级约束，不依赖 gate；先结构后认证意味着匿名请求
  // 也只能拿到结构结论，拿不到「哪台设备被拒」这类授权面信息。
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-schema-order-'));
  const d = await boot(cwd);
  try {
    const deep = await raw(d,
      `{"jsonrpc":"2.0","id":"o-1","method":"initialize","params":{"probe":${nested(33, '[', ']')}}}`);
    assert.match(deep.json?.error?.message || '', /structure-too-deep/, `超深要在认证之前先拒：${deep.text}`);
    const batch = await raw(d, '[{"jsonrpc":"2.0","id":"o-2","method":"initialize"}]');
    assert.match(batch.json?.error?.message || '', /batch-not-allowed/);
    // 阳性对照：正文合法但没带凭据的同一台匿名客户端，拿到的必须是认证归因，不是结构归因。
    const noAuth = await raw(d, JSON.stringify({ jsonrpc: '2.0', id: 'o-3', method: 'initialize', params: {} }));
    assert.match(noAuth.json?.error?.message || '', /authz-denied/, `无凭据该回认证拒绝：${noAuth.text}`);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('params 嵌到 33 层拒、20 层放行到下一道判法', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-schema-depth-'));
  const d = await boot(cwd);
  try {
    const { bearer } = await device(d, cwd, 'p-depth', 'depth');
    const tooDeep = await raw(d,
      `{"jsonrpc":"2.0","id":"d-1","method":"session/catalog","params":{"workspaceId":"${d.ws}","probe":${nested(33, '[', ']')}}}`,
      bearer);
    assert.equal(tooDeep.json?.error?.code, -32600, `超深要按无效请求回：${tooDeep.text}`);
    assert.match(tooDeep.json.error.message, /structure-too-deep/);
    // 阳性对照：换成 20 层（连信封 2 层共 22 层）就必须打到 catalog 本身。
    const inside = await raw(d,
      `{"jsonrpc":"2.0","id":"d-2","method":"session/catalog","params":{"workspaceId":"${d.ws}","probe":${nested(20, '[', ']')}}}`,
      bearer);
    assert.ok(Array.isArray(inside.json?.result?.entries), `界内不能顺带被拒：${inside.text}`);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('带 Origin 的 /rpc、/auth/enroll、/sse 一律拒，去掉 Origin 后同一请求照常', async () => {
  // §7「外部 CORS 默认不开放」。本产品没有浏览器客户端，所以判据就是「有 Origin 即拒」；
  // 反过来没有 Origin 不算放行理由——那三条仍要各自撞上认证/授权。
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-schema-origin-'));
  const d = await boot(cwd);
  try {
    const rpc = await raw(d, JSON.stringify({ jsonrpc: '2.0', id: 'x-1', method: 'initialize', params: {} }),
      '', { origin: 'http://evil.example' });
    assert.match(rpc.json?.error?.message || '', /origin-not-allowed/, `/rpc 带 Origin 必须拒：${rpc.text}`);
    // 每个响应的正文只读一次：Response.body 是一次性的，读第二遍会抛
    // 「Body is unusable」，那是夹具错，不是被测面。
    const enroll = await fetch(d.url('/auth/enroll'), {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
      body: '{}', signal: AbortSignal.timeout(15000),
    });
    const enrollText = await enroll.text();
    assert.equal(enroll.status, 400, `认证面同样拒 Origin：${enrollText}`);
    assert.match(enrollText, /origin-not-allowed/);
    const sse = await fetch(d.url('/sse'), {
      method: 'GET', headers: { origin: 'http://evil.example' }, signal: AbortSignal.timeout(15000),
    });
    const sseText = await sse.text();
    assert.equal(sse.status, 403, `/sse 带 Origin 要拒在路由级：${sseText}`);
    assert.match(sseText, /origin-not-allowed/);
    // 阳性对照：同三个面去掉 Origin 后各自回到原本的判法（认证/参数），不是静默放行。
    const noOriginRpc = await raw(d, JSON.stringify({ jsonrpc: '2.0', id: 'x-2', method: 'initialize', params: {} }));
    assert.match(noOriginRpc.json?.error?.message || '', /authz-denied/, `无 Origin 走认证归因：${noOriginRpc.text}`);
    const noOriginEnroll = await fetch(d.url('/auth/enroll'), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000),
    });
    const noOriginEnrollText = await noOriginEnroll.text();
    assert.ok(!noOriginEnrollText.includes('origin-not-allowed'), `去掉 Origin 后不该还是 Origin 门禁：${noOriginEnrollText}`);
    assert.equal(noOriginEnroll.status, 400, `空正文要打到登记逻辑本身并因参数拒：${noOriginEnrollText}`);
    const noOriginSse = await fetch(d.url('/sse'), { method: 'GET', signal: AbortSignal.timeout(15000) });
    assert.equal(noOriginSse.status, 401, `无 Origin 的 /sse 要停在认证，不是 Origin 门禁：${await noOriginSse.text()}`);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// daemon 侧的宿主代理：六个 worktree 方法 + 会话/工作区/起轮方法构成**有限白名单**，
// 逐条转发到真实子进程宿主；宿主通知桥进 EventBus/SSE。
// 这里用 Node 协议夹具当宿主，只证「进程驱动、按 id 配对、有界等待、shutdown」这四件事
// 归 daemon 这一层的语义，不冒充仓颉宿主的业务验收。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const daemon = process.env.SACODE_DAEMON || path.join(root, 'apps/daemon/target/release/bin/main.exe');
const env = { ...process.env };
const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
env[pathKey] = [process.env.SACODE_STDX_DLL_DIR || 'C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx', process.env.SACODE_RUNTIME_DLL_DIR || 'D:/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative', env[pathKey]].join(path.delimiter);

// 两种宿主形状都要验：本仓 NDJSON 宿主（apps/host/src/main.cj 读侧「空行即退出」，
// 没有 host/shutdown 这个动词）与实现协议层 host/shutdown 的宿主（extjs 那一类）。
// 代理的结算阶梯顺序错了，这两条就会分别变红。
const fixtureSource = `const readline = require('node:readline');
const fs = require('node:fs');
const mode = process.argv[2] || 'host';
const out = x => process.stdout.write(JSON.stringify(x) + '\\n');
const received = [];
let strayArmed = false;
const settle = via => fs.writeFileSync('宿主结算.json', JSON.stringify({ methods: received.map(x => x.method), via }));
const line = readline.createInterface({ input: process.stdin });
line.on('line', text => {
  if (!text.trim()) { settle('empty-line'); process.exit(0); }
  let r; try { r = JSON.parse(text); } catch (e) { process.stderr.write('坏帧：' + text + '\\n'); return; }
  received.push(r);
  fs.appendFileSync('宿主收到的方法.txt', r.method + '\\n');
  if (r.method === 'host/shutdown') {
    if (mode === 'protocol') {
      out({ jsonrpc: '2.0', id: r.id, result: { ok: true, inflight: 0 } });
      settle('protocol');
      setTimeout(() => process.exit(0), 20);
      return;
    }
    out({ jsonrpc: '2.0', id: r.id, error: { code: -32601, message: 'method not found' } });
    return;
  }
  const name = r.params && r.params.name;
  if (mode === 'crash' && name === '崩溃') { process.exit(3); }
  if (name === '无主') { strayArmed = true; }
  const reply = () => {
    out({ jsonrpc: '2.0', method: 'session/event', params: { sessionId: r.params.sessionId, event: { type: 'worktree/entered', data: '真实通知' } } });
    if (name === '失败') { out({ jsonrpc: '2.0', id: r.id, error: { code: -32001, message: '业务拒绝', data: { kept: true } } }); return; }
    if (name === '静默') { return; }
    out({ jsonrpc: '2.0', id: r.id, result: { method: r.method, params: r.params, cwd: process.cwd() } });
    if (strayArmed) { strayArmed = false; out({ jsonrpc: '2.0', id: 987654, result: { ghost: true } }); }
  };
  setTimeout(reply, name === '慢' ? 1200 : 0);
});`;

function childRun(command, args, cwd, extra = {}) {
  const child = spawn(command, args, { cwd, env: { ...env, ...extra }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout += b; });
  child.stderr.on('data', b => { stderr += b; });
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`daemon 超时：${stderr}`)); }, 25000);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
  });
  return { child, done, output: () => ({ stdout, stderr }) };
}

async function runningDaemon(cwd, body, options = {}) {
  const fixture = path.join(cwd, '协议夹具.cjs');
  await writeFile(fixture, fixtureSource);
  const extra = {
    SACODE_HOST: process.execPath,
    SACODE_HOST_ARGS: JSON.stringify([fixture.replace(/\\/g, '/'), options.mode || 'host']),
    ...(options.timeoutMs === undefined ? {} : { SACODE_HOST_TIMEOUT_MS: String(options.timeoutMs) }),
  };
  if (options.withoutHost) { extra.SACODE_HOST = ''; extra.SACODE_HOST_ARGS = ''; }
  const p = childRun(daemon, ['--port', '0'], cwd, extra);
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`daemon 未就绪：${p.output().stderr}`)), 10000);
      p.child.stdout.on('data', () => {
        const m = p.output().stdout.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (m) { clearTimeout(timer); resolve(m[0]); }
      });
      p.child.on('error', e => { clearTimeout(timer); reject(e); });
      p.child.on('exit', code => { clearTimeout(timer); reject(new Error(`daemon 提前退出 rc=${code}：${p.output().stderr}`)); });
    });
    await body(url, p);
  } finally {
    p.child.kill();
    await p.done;
  }
}

async function temporary(body) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'sacode-daemon-'));
  try { return await body(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

async function rpc(url, id, method, params) {
  const res = await fetch(`${url}/rpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return res.json();
}

async function openSse(url) {
  const abort = new AbortController();
  const res = await fetch(`${url}/sse`, { signal: abort.signal });
  const reader = res.body.getReader();
  const state = { text: '', frames: [], stop: () => abort.abort() };
  const pump = (async () => {
    const decoder = new TextDecoder();
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) { break; }
        state.text += decoder.decode(part.value, { stream: true });
        state.frames = state.text.split('\n').filter(x => x.startsWith('data: ')).map(x => {
          try { return JSON.parse(x.slice(6)); } catch { return { unparsed: x }; }
        });
      }
    } catch { /* 主动断开 */ }
  })();
  // 等首帧 connected，确保订阅已注册（否则后续通知会发给还不存在的观众）
  const deadline = Date.now() + 5000;
  while (!state.text.includes(': connected') && Date.now() < deadline) { await new Promise(r => setTimeout(r, 20)); }
  if (!state.text.includes(': connected')) { await pump; throw new Error('SSE 未连接'); }
  state.waitFrames = async (predicate, timeoutMs = 5000) => {
    const limit = Date.now() + timeoutMs;
    while (Date.now() < limit) {
      const hit = state.frames.find(predicate);
      if (hit) { return hit; }
      await new Promise(r => setTimeout(r, 20));
    }
    return null;
  };
  return state;
}

const WHITELIST = ['worktree/enter', 'worktree/describe', 'worktree/exit', 'worktree/agent-prepare', 'worktree/agent-finish', 'worktree/cleanup'];

test('白名单六个方法逐条转发到宿主并原样回结果', async () => temporary(async cwd => runningDaemon(cwd, async url => {
  for (const [index, method] of WHITELIST.entries()) {
    const params = { sessionId: 's-1' };
    if (method === 'worktree/enter') { params.name = 'fix-1'; }
    if (method === 'worktree/exit') { params.action = 'keep'; }
    if (method === 'worktree/agent-prepare' || method === 'worktree/agent-finish') { params.agentId = 'worker-1'; }
    const reply = await rpc(url, 100 + index, method, params);
    assert.equal(reply.id, 100 + index, method);
    assert.equal(reply.result.method, method, method);
    assert.deepEqual(reply.result.params, params, `${method} 的参数必须逐字透传`);
  }
})));

test('initialize 能力登记六个 worktree 方法', async () => temporary(async cwd => runningDaemon(cwd, async url => {
  const reply = await rpc(url, 1, 'initialize', {});
  assert.equal(reply.error, undefined, JSON.stringify(reply));
  for (const method of WHITELIST) {
    assert.ok(reply.result.capabilities.includes(method), `能力清单缺 ${method}`);
  }
})));

test('白名单外一律 -32601，宿主没收到过那一帧', async () => temporary(async cwd => runningDaemon(cwd, async (url, p) => {
  // 正对照：白名单内的方法必须真的通得了，否则「白名单外被拒」是旧产物的默认行为蒙的。
  const allowed = await rpc(url, '放行', 'worktree/cleanup', { sessionId: 's-1' });
  assert.equal(allowed.error, undefined, JSON.stringify(allowed));
  for (const method of ['任意/执行', 'host/shutdown', 'session/delete', 'worktree/../cleanup', 'initialize/extra']) {
    const denied = await rpc(url, `拒-${method}`, method, {});
    assert.equal(denied.error.code, -32601, `${method} 必须被白名单拦住：${JSON.stringify(denied)}`);
    assert.equal(denied.result, undefined);
  }
  const frames = p.output().stdout;
  assert.ok(!frames.includes('任意/执行'), 'stdout 只走协议帧，不得被业务污染');
})));

test('有限白名单不退化成任意方法通道：非对象参数与白名单外方法都不落到宿主', async () => temporary(async cwd => runningDaemon(cwd, async url => {
  // 正对照：同一实例上合法形状必须转得出去，下面的拒绝才是白名单/形状在拦，不是全都拦。
  const ok = await rpc(url, 0, 'worktree/describe', { sessionId: 's-1' });
  assert.equal(ok.error, undefined, JSON.stringify(ok));
  const array = await rpc(url, 1, 'worktree/enter', ['不是', '对象']);
  assert.notEqual(array.error, undefined, JSON.stringify(array));
  assert.equal(array.result, undefined);
  const scalar = await rpc(url, 2, 'worktree/enter', '字符串参数');
  assert.notEqual(scalar.error, undefined, JSON.stringify(scalar));
  // 前缀不算命中：白名单是整串比对，不是 startsWith。
  const lookalike = await rpc(url, 3, 'worktree/enterX', {});
  assert.equal(lookalike.error.code, -32601, JSON.stringify(lookalike));
  // 长连接订阅刻意不转发：一次性 HTTP RPC 等不到它的应答，通知走 SSE 那条路。
  const subscribe = await rpc(url, 4, 'session/subscribe', {});
  assert.equal(subscribe.error.code, -32601, JSON.stringify(subscribe));
  const methods = await readFile(path.join(cwd, '宿主收到的方法.txt'), 'utf8').catch(() => '');
  for (const forbidden of ['worktree/enter', 'worktree/enterX', 'session/subscribe']) {
    assert.ok(!methods.split('\n').includes(forbidden), `${forbidden} 必须一帧都没发到宿主：${methods}`);
  }
})));

test('保留调用方字符串 ID、并发乱序配对与完整业务错误结构', async () => temporary(async cwd => runningDaemon(cwd, async url => {
  const [slow, fast, error] = await Promise.all([
    rpc(url, '慢调用', 'worktree/enter', { sessionId: 's-1', name: '慢' }),
    rpc(url, 22, 'worktree/describe', { sessionId: 's-2' }),
    rpc(url, 23, 'worktree/enter', { sessionId: 's-1', name: '失败' }),
  ]);
  assert.equal(slow.id, '慢调用');
  assert.equal(slow.result.params.name, '慢');
  assert.equal(fast.id, 22);
  assert.equal(fast.result.params.sessionId, 's-2');
  assert.deepEqual(error, { jsonrpc: '2.0', id: 23, error: { code: -32001, message: '业务拒绝', data: { kept: true } } });
})));

test('宿主通知桥进 SSE，应答不上 bus', async () => temporary(async cwd => runningDaemon(cwd, async url => {
  const sse = await openSse(url);
  try {
    const before = sse.frames.length;
    const reply = await rpc(url, 77, 'worktree/enter', { sessionId: 'current', name: '通知' });
    assert.equal(reply.id, 77);
    const frame = await sse.waitFrames(f => f.method === 'session/event' && sse.frames.indexOf(f) >= before);
    assert.ok(frame, `SSE 没收到宿主通知：${sse.text}`);
    assert.deepEqual(frame.params, { sessionId: 'current', event: { type: 'worktree/entered', data: '真实通知' } });
    assert.equal(frame.id, undefined, '应答帧不得上 bus');
    assert.ok(!sse.frames.some(f => f.result && f.result.method === 'worktree/enter'), '应答不得当通知发');
  } finally { sse.stop(); }
})));

test('未配置 SACODE_HOST 时白名单方法 fail-closed，且不退回本地', async () => temporary(async cwd => runningDaemon(cwd, async url => {
  const denied = await rpc(url, 1, 'worktree/enter', { sessionId: 's-1', name: 'fix-1' });
  assert.equal(denied.error.code, -32010, JSON.stringify(denied));
  const init = await rpc(url, 2, 'initialize', {});
  assert.equal(init.error, undefined);
  assert.ok(!init.result.capabilities.includes('worktree/enter'), '宿主不可用时不得宣称有这能力');
  assert.deepEqual(await readdir(cwd), [], '代理失败不得在本地留下任何文件或目录');
}, { withoutHost: true })));

test('有界等待：宿主不回应时按时限回错，不伪造终态也不拖死 daemon', async () => temporary(async cwd => runningDaemon(cwd, async url => {
  const started = Date.now();
  const timedOut = await rpc(url, 5, 'worktree/enter', { sessionId: 's-1', name: '静默' });
  const elapsed = Date.now() - started;
  assert.equal(timedOut.error.code, -32011, JSON.stringify(timedOut));
  assert.ok(elapsed < 5000, `有界等待必须按时限收，实测 ${elapsed}ms`);
  const alive = await rpc(url, 6, 'initialize', {});
  assert.equal(alive.error, undefined, '超时后 daemon 必须还能服务');
}, { timeoutMs: 600 })));

test('宿主中途退出：在途请求与后续请求都 fail-closed，不编本地结果', async () => temporary(async cwd => runningDaemon(cwd, async url => {
  const died = await rpc(url, 7, 'worktree/enter', { sessionId: 's-1', name: '崩溃' });
  assert.notEqual(died.error, undefined, JSON.stringify(died));
  assert.equal(died.error.code, -32002, '宿主没了必须报 host-exited，不能当成功');
  const after = await rpc(url, 8, 'worktree/describe', { sessionId: 's-1' });
  assert.equal(after.error.code, -32002, JSON.stringify(after));
}, { mode: 'crash' })));

// 本仓 NDJSON 宿主没有 host/shutdown 这个动词，退出路径是「读到空行就 break」。
// 代理必须先试协议层、拿到 -32601 后改走空行，并且不许把它算成强杀。
test('结算阶梯第一优先：协议层 host/shutdown（实现它的宿主自退）', async () => temporary(async cwd => runningDaemon(cwd, async (url, p) => {
  const sse = await openSse(url);
  try {
    const ok = await rpc(url, 12, 'worktree/describe', { sessionId: 's-1' });
    assert.equal(ok.error, undefined, JSON.stringify(ok));
    const settled = await rpc(url, 13, 'daemon/shutdown', {});
    assert.equal(settled.error, undefined, JSON.stringify(settled));
    const frame = await sse.waitFrames(f => f.method === 'daemon/host-shutdown', 8000);
    assert.ok(frame, `没收到宿主结算通知：${sse.text}`);
    assert.equal(frame.params.shutdownVia, 'protocol', JSON.stringify(frame.params));
    assert.equal(frame.params.forced, false, '优雅退出必须断言未被强杀');
    assert.equal(frame.params.exit, 0, `宿主应自己退 0：${JSON.stringify(frame.params)}`);
    assert.ok(frame.params.methods.includes('host/shutdown'), 'shutdown 必须走协议帧');
    const marker = JSON.parse(await readFile(path.join(cwd, '宿主结算.json'), 'utf8'));
    assert.equal(marker.via, 'protocol');
  } finally { sse.stop(); }
}, { mode: 'protocol' })));

test('结算阶梯兜次序：宿主不认 host/shutdown 时改走空行，仍不算强杀', async () => temporary(async cwd => runningDaemon(cwd, async (url, p) => {
  const sse = await openSse(url);
  try {
    const ok = await rpc(url, 14, 'worktree/describe', { sessionId: 's-1' });
    assert.equal(ok.error, undefined, JSON.stringify(ok));
    const settled = await rpc(url, 15, 'daemon/shutdown', {});
    assert.equal(settled.error, undefined, JSON.stringify(settled));
    const frame = await sse.waitFrames(f => f.method === 'daemon/host-shutdown', 8000);
    assert.ok(frame, `没收到宿主结算通知：${sse.text}`);
    assert.equal(frame.params.shutdownVia, 'empty-line', JSON.stringify(frame.params));
    assert.equal(frame.params.forced, false);
    assert.equal(frame.params.exit, 0);
    const marker = JSON.parse(await readFile(path.join(cwd, '宿主结算.json'), 'utf8'));
    assert.equal(marker.via, 'empty-line');
    assert.ok(marker.methods.includes('host/shutdown'), '第一优先的协议帧必须真的发出去过');
  } finally { sse.stop(); }
}, { mode: 'host' })));

test('配对与记账：超时、无主应答、迟到应答各自独立入账', async () => temporary(async cwd => runningDaemon(cwd, async (url, p) => {
  const sse = await openSse(url);
  try {
    // 宿主 1200ms 后才回，本端 400ms 就收手：这一帧只能记迟到账，不许冒充别人的应答。
    const timedOut = await rpc(url, 9, 'worktree/enter', { sessionId: 's-1', name: '慢' });
    assert.equal(timedOut.error.code, -32011, JSON.stringify(timedOut));
    const ghost = await rpc(url, 10, 'worktree/enter', { sessionId: 's-1', name: '无主' });
    assert.equal(ghost.error, undefined, JSON.stringify(ghost));
    assert.equal(ghost.result.params.name, '无主');
    // 等迟到的那一帧真的到达之后再结算，否则这条账根本没被exercised。
    await new Promise(r => setTimeout(r, 1000));
    const settled = await rpc(url, 11, 'daemon/shutdown', {});
    assert.equal(settled.error, undefined, JSON.stringify(settled));
    const frame = await sse.waitFrames(f => f.method === 'daemon/host-shutdown', 8000);
    assert.ok(frame, `没收到宿主结算通知：${sse.text}`);
    assert.equal(frame.params.timedOut, 1, '超时只回错误，不伪造终态');
    assert.equal(frame.params.stray, 1, '无主应答帧要单独记账，不能被任何在途请求认领');
    assert.equal(frame.params.late, 1, '收手之后才到的应答要记迟到账');
    assert.equal(frame.params.dropped, 0, '本端结构性不丢帧');
    assert.equal(frame.params.forced, false);
  } finally { sse.stop(); }
}, { timeoutMs: 400 })));

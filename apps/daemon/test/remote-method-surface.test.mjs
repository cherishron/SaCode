import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// 远程方法面的真实闭环验收：daemon 白名单里的每一条都必须被**在跑的宿主**承认，
// 并且至少一条从未开放过的家族能由宿主实际作答。
// 之前这一面只有 16 条硬编名字，其余契约方法在 daemon 分派层就 -32601，
// 远程客户端（含移动工作台）根本打不到；静态清单再全也不证明宿主认账，
// 所以这里用真实宿主 exe 做端到端反证。
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

// Windows 上刚被 SIGKILL 的子进程还会短暂占着 cwd，立刻 rmdir 会 EBUSY——
// 这条红是清理时序，不是被测面。等有界重试，绝不把「没删掉」当通过。
async function rmBounded(dir) {
  const until = Date.now() + 8000;
  for (;;) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      if (Date.now() >= until) throw e;
      await delay(200);
    }
  }
}

// 缺宿主产物属环境未就绪，必须失败并说明怎么补，绝不静默跳过把这条面蒙绿。
function requireHostExe() {
  assert.ok(existsSync(hostExe), `需要真实宿主产物：${hostExe} 不存在。先跑 node scripts/pack-host.mjs（记 BLOCKED，不是跳过）`);
}

function forwardedNames() {
  const src = readFileSync(path.join(root, 'apps/daemon/src/host_proxy.cj'), 'utf8');
  const m = src.match(/let hostMethods = \[([\s\S]*?)\]/);
  assert.ok(m, '解析不到 host_proxy.cj 里的 hostMethods 数组');
  return (m[1].match(/"[^"]+"/g) || []).map(s => s.slice(1, -1));
}

// 直接问宿主本人：它 initialize 里写了哪些能力。
async function hostDeclaredCaps(cwd) {
  requireHostExe();
  const proc = spawn(hostExe, ['--workspace', cwd.replace(/\\/g, '/')], {
    cwd, env: baseEnv, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { err += d; });
  const closed = new Promise(resolve => proc.on('close', resolve));
  proc.stdin.write('{"jsonrpc":"2.0","id":"probe","method":"initialize","params":{}}\n');
  const until = Date.now() + 20000;
  while (!out.includes('"capabilities"') && proc.exitCode === null && Date.now() < until) await delay(20);
  proc.stdin.end();
  proc.kill('SIGKILL');
  // 等它真的退出再返回：否则调用方删夹具目录会撞上 Windows 的目录锁。
  await Promise.race([closed, delay(3000)]);
  assert.match(out, /"capabilities"/, `宿主未回 capabilities，stderr=${err.slice(0, 400)}`);
  const frame = JSON.parse(out.trim().split('\n')[0]);
  return frame.result.capabilities;
}

async function bootWithHost(cwd, extraEnv) {
  requireHostExe();
  const proc = spawn(daemonExe, ['--port', '0'], {
    cwd,
    env: {
      ...baseEnv,
      SACODE_USER_SETTINGS_DIR: path.join(cwd, 'settings'),
      SACODE_REMOTE_ACCESS: '1',
      SACODE_REMOTE_IDENTITY: path.join(cwd, 'instance.id'),
      SACODE_REMOTE_POLICY: policyFile,
      SACODE_HOST: hostExe,
      SACODE_HOST_ARGS: JSON.stringify(['--workspace', cwd.replace(/\\/g, '/')]),
      SACODE_HOST_TIMEOUT_MS: '20000',
      ...extraEnv,
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
    port,
    stderr: () => err,
    stop: async () => {
      const closed = new Promise(resolve => proc.on('close', resolve));
      proc.kill('SIGKILL');
      await Promise.race([closed, delay(3000)]);
    },
  };
}

async function manage(cwd, args) {
  const r = await new Promise(resolve => {
    const p = spawn(daemonExe, args, { cwd, env: baseEnv });
    let o = '';
    let e = '';
    p.stdout.on('data', d => { o += d; });
    p.stderr.on('data', d => { e += d; });
    p.on('close', code => resolve({ code, out: o, err: e }));
  });
  return r;
}

// 借本机管理入口建票，再走 /auth/enroll + /auth/token 换到 bearer。
async function authedDevice(d, cwd) {
  const identity = path.join(cwd, 'instance.id');
  const snapshot = `${identity}.devices.json`;
  const created = await manage(cwd, ['--manage', 'enroll-ticket', snapshot, 'p-surf']);
  assert.equal(created.code, 0, `建票应成功：${created.err}`);
  const ticket = created.out.replace(/\r/g, '').trim().split('\n')[1];
  const url = p => `http://127.0.0.1:${d.port}${p}`;
  const dev = JSON.parse(await (await fetch(url('/auth/enroll'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enrollmentSecret: ticket, deviceName: 'surf', kind: 'desktop' }),
    signal: AbortSignal.timeout(15000),
  })).text());
  const tok = JSON.parse(await (await fetch(url('/auth/token'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: dev.deviceId, credential: dev.credential }),
    signal: AbortSignal.timeout(15000),
  })).text());
  return { bearer: `Bearer ${tok.accessToken}`, url };
}

async function rpcCall(url, bearer, method, params, id) {
  const r = await fetch(url('/rpc'), {
    method: 'POST',
    headers: { authorization: bearer, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  return { status: r.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}

test('宿主本人承认的能力必须覆盖 daemon 转发白名单（不许转发宿主不认的名字）', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-surf-host-'));
  try {
    const declared = new Set(await hostDeclaredCaps(cwd));
    const fwd = forwardedNames();
    const unknown = fwd.filter(m => !declared.has(m));
    assert.equal(fwd.length > 60, true, `转发面过短（${fwd.length}），说明方法面还没铺开`);
    assert.deepEqual(unknown, [], 'daemon 转发了宿主未声明的方法：' + unknown.join(','));
  } finally {
    await rmBounded(cwd);
  }
});

test('远程 initialize 的能力面宣告新铺开的家族，且不宣告宿主未实现的方法', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-surf-init-'));
  const d = await bootWithHost(cwd);
  try {
    const { bearer, url } = await authedDevice(d, cwd);
    const r = await rpcCall(url, bearer, 'initialize', {}, 'i-1');
    assert.equal(r.status, 200);
    const caps = r.json.result.capabilities;
    for (const m of ['tips/get', 'model/list', 'workspace/files', 'queue/describe', 'ledger/stats',
      'lsp/diagnostics', 'attachment/upload', 'global/appearance/get', 'custom/describe', 'binding/upsert']) {
      assert.ok(caps.includes(m), `能力面应宣告 ${m}（宿主已声明、契约已实现、远程可消费）`);
    }
    // session/events 的锚点已落地成 daemon 自有补读面，所以它现在*应该*被宣告；
    // 登记面仍然不靠能力宣称。
    assert.ok(caps.includes('session/events'), 'session/events 已由 daemon 作答，能力面要宣告它');
    assert.ok(!caps.includes('auth/enroll'), '登记面不靠 RPC 能力宣称');
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('tips/get 经 daemon 打到真实宿主并由宿主作答，不再是分派层的 -32601', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-surf-get-'));
  const d = await bootWithHost(cwd);
  try {
    const { bearer, url } = await authedDevice(d, cwd);
    const r = await rpcCall(url, bearer, 'tips/get', {}, 't-1');
    assert.ok(!/-32601/.test(r.text), `tips/get 仍被分派层拒回：${r.text}`);
    assert.ok(!/method not found/.test(r.text), r.text);
    assert.equal(r.json.id, 't-1', '宿主应答必须按 id 配对回写');
    assert.ok('result' in r.json || 'error' in r.json, r.text);
    if ('error' in r.json) {
      assert.notEqual(r.json.error.code, -32010, '宿主已配置，不得报未配置');
      assert.notEqual(r.json.error.code, -32011, `宿主应答超时：${r.text}`);
    }
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('带资源归属的 model/list 放行后由宿主作答；缺 workspaceId 时授权面先拒', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-surf-model-'));
  const d = await bootWithHost(cwd);
  try {
    const { bearer, url } = await authedDevice(d, cwd);
    const denied = await rpcCall(url, bearer, 'model/list', {}, 'm-0');
    assert.match(denied.text, /-32001/, `缺 workspaceId 应先被授权拒：${denied.text}`);
    assert.match(denied.text, /workspace-required/);
    const ok = await rpcCall(url, bearer, 'model/list', { workspaceId: cwd.replace(/\\/g, '/') }, 'm-1');
    assert.ok(!/-32601/.test(ok.text), `model/list 仍被分派层拒回：${ok.text}`);
    assert.ok(!/authz-denied/.test(ok.text), `带归属后不应再被授权拒：${ok.text}`);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('铺开转发不等于放开授权：management 权限方法可达但按 scope 拒', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-surf-authz-'));
  const d = await bootWithHost(cwd);
  try {
    const { bearer, url } = await authedDevice(d, cwd);
    const r = await rpcCall(url, bearer, 'credential/set', { workspaceId: 'ws-1' }, 'c-1');
    assert.match(r.text, /-32001/, r.text);
    assert.match(r.text, /scope-required/, '默认设备视图无 management scope，必须按 scope 拒');
    assert.ok(!/-32601/.test(r.text), '这条要证明的是「已经打到分派层之后」，不是方法不存在');
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('session/events 是 daemon 自有面：不转发，但由补读面作答并对外宣告', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-surf-events-'));
  const d = await bootWithHost(cwd);
  try {
    const { bearer, url } = await authedDevice(d, cwd);
    const r = await rpcCall(url, bearer, 'session/events',
      { workspaceId: 'ws-1', sessionId: 'sessions/nope' }, 'e-1');
    // -32601 意味着它掉进了「没人接」的默认支；这一支必须由 daemon 的补读面接住，
    // 拿到的是补读面自己的非法参数原因。
    assert.ok(!/-32601/.test(r.text), `session/events 不该再落到「方法不存在」：${r.text}`);
    assert.match(r.text, /-32602/, r.text);
    assert.match(r.text, /unknown-session/, r.text);
    const fwd = forwardedNames();
    assert.equal(fwd.includes('session/events'), false, '宿主不声明它，转发白名单里不能有它');
    const init = await rpcCall(url, bearer, 'initialize', {}, 'e-2');
    assert.ok(init.json.result.capabilities.includes('session/events'));
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

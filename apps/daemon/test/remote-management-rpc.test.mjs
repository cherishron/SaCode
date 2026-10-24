import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';

// 认证 RPC 管理面（auth/devices / auth/revoke）在真实 HTTP 上的读数。
//
// scope 的来源是本机受保护管理入口的 `--manage grant-scope`：CLI 写快照，
// 运行中的 daemon 在下一次 gate.check 通过 refreshFromDisk 吸收，不需要重启。
// 这里同时钉住两件事：
//   - 未授予时这条面存在但一步都走不通，拒因是 -32001 scope-required 而不是 -32601；
//   - 授予后同一令牌立即可达管理面，且授予只作用于目标设备。
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

const delay = ms => new Promise(r => setTimeout(r, 25));

async function waitForExit(proc, budgetMs) {
  const end = Date.now() + budgetMs;
  while (proc.exitCode === null && proc.signalCode === null && Date.now() < end) await delay(25);
  return proc.exitCode === null && proc.signalCode === null ? null : proc.exitCode;
}

async function stopDaemon(proc) {
  if (!proc || (proc.exitCode !== null || proc.signalCode !== null)) return;
  proc.kill();
  if (await waitForExit(proc, 4000) === null) { proc.kill('SIGKILL'); await waitForExit(proc, 4000); }
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

// 本机管理入口的通用调用：返回 code/out/err，授予与列清单都用它，
// 避免每个动作各写一份进程等待逻辑而漏掉超时。
async function runManage(args) {
  const proc = spawn(daemonExe, args, { env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { err += d; });
  const end = Date.now() + 15000;
  while (proc.exitCode === null && proc.signalCode === null && Date.now() < end) await delay(25);
  assert.notEqual(proc.exitCode, null, `管理子进程没在 15 秒内退出：${args.join(' ')}`);
  return { code: proc.exitCode, out: out.replace(/\r/g, ''), err: err.replace(/\r/g, '') };
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
    const r = await post('/rpc', JSON.stringify({ jsonrpc: '2.0', id: 'mg-1', method, params }), headers);
    return { status: r.status, text: await r.text() };
  };
  const enrollAs = async (principal, deviceName) => {
    const t = await createTicket(snapshot, principal);
    const e = await (await post('/auth/enroll',
      JSON.stringify({ enrollmentSecret: t, deviceName, kind: 'mobile' }))).json();
    assert.ok(e.deviceId, `登记应答里没有 deviceId：${JSON.stringify(e)}`);
    const tk = await (await post('/auth/token',
      JSON.stringify({ deviceId: e.deviceId, credential: e.credential }))).json();
    assert.ok(tk.accessToken, `换令牌失败：${JSON.stringify(tk)}`);
    return { deviceId: e.deviceId, credential: e.credential, token: tk.accessToken, bearer: { authorization: `Bearer ${tk.accessToken}` } };
  };
  const devA = await enrollAs('p-a', 'mgmt-a');
  const devB = await enrollAs('p-b', 'mgmt-b');
  return { proc, rpc, post, devA, devB, identity, snapshot, dir };
}

async function withDaemon(run) {
  const dir = await mkdtemp(path.join(root, 'target', 'sacode-mgmt-'));
  let d = null;
  try { d = await boot(dir); return await run(d); }
  finally { await stopDaemon(d ? d.proc : null); await removeDir(dir); }
}

async function auditText(d) {
  return (await readFile(path.join(d.dir, 'instance.id.audit.log'), 'utf8')).replace(/\r/g, '');
}

test('契约把两个管理方法登记为 management，且带 requiredScope', () => {
  const rows = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
  for (const name of ['auth/devices', 'auth/revoke']) {
    const row = rows.find(r => r.method === name);
    assert.ok(row, `契约里没有 ${name}：这条 RPC 面没有登记依据`);
    assert.equal(row.permission, 'management', `${name} 的权限类别必须是 management`);
    assert.equal(row.requiredScope, 'management', `${name} 必须显式要求 management scope`);
    // 归属键必须为空：管理面看的是整台实例，不该被 workspace/session 归属再挡一次。
    assert.deepEqual(row.resourceKeys, [], `${name} 不该带资源归属键`);
  }
  assert.ok(rows.find(r => r.method === 'auth/revoke').durable, '撤销是持久副作用');
  assert.ok(!rows.find(r => r.method === 'auth/devices').durable, '读清单不该建幂等账');
});

test('未认证的管理面请求只拿到认证拒因，不透露管理面存在', async () => {
  await withDaemon(async (d) => {
    for (const name of ['auth/devices', 'auth/revoke']) {
      const anon = await d.rpc(name, {});
      assert.ok(anon.text.includes('missing-bearer'), `${name} 要先归认证：${anon.text}`);
      assert.ok(!anon.text.includes('scope-required'),
        `未认证时不许把「需要管理权」这条信息先交出去：${anon.text}`);
      assert.ok(!anon.text.includes('management'), `${name} 的应答不该含词表：${anon.text}`);
    }
  });
});

test('认证但无管理权：-32001 scope-required，且不是 -32601 方法不存在', async () => {
  await withDaemon(async (d) => {
    const dev = await d.rpc('auth/devices', {}, d.devA.bearer);
    assert.ok(dev.text.includes('"-32001"') || dev.text.includes('-32001'),
      `管理面必须登记在案（否则回 -32601）：${dev.text}`);
    assert.ok(dev.text.includes('scope-required'), `拒因要是 scope-required：${dev.text}`);
    // 拒绝半边也要把设备清单咽回去：应答里不许出现任何已登记设备号。
    assert.ok(!dev.text.includes(d.devA.deviceId), `应答泄漏设备清单：${dev.text}`);
    assert.ok(!dev.text.includes(d.devB.deviceId), `应答泄漏设备清单：${dev.text}`);

    const rev = await d.rpc('auth/revoke', { deviceId: d.devB.deviceId }, d.devA.bearer);
    assert.ok(rev.text.includes('scope-required'), `撤销同样要先核管理权：${rev.text}`);
    assert.ok(!rev.text.includes(d.devB.deviceId), `拒因里不许回显目标设备号：${rev.text}`);

    // 对照：契约里没登记的方法走的是另一条归因，两者必须分得开。
    const bogus = await d.rpc('auth/nope', {}, d.devA.bearer);
    assert.ok(bogus.text.includes('-32601') || bogus.text.includes('method-not-registered')
      || bogus.text.includes('-32001'), `未登记方法要有自己的归因：${bogus.text}`);
    assert.ok(!bogus.text.includes('scope-required'),
      `未登记的方法不该被说成「缺管理权」：${bogus.text}`);
  });
});

test('管理权缺失时目标不可枚举：存在与不存在的目标应答逐字相同', async () => {
  await withDaemon(async (d) => {
    const exists = await d.rpc('auth/revoke', { deviceId: d.devB.deviceId }, d.devA.bearer);
    const missing = await d.rpc('auth/revoke', { deviceId: 'ghost-not-here' }, d.devA.bearer);
    assert.equal(missing.text, exists.text,
      `无权限时两次应答必须逐字一致，否则应答本身成了设备清单探针：\n${exists.text}\n${missing.text}`);
    // 一次都没撤动：本地入口读同一份快照，两台设备都还在。
    const listing = spawn(daemonExe, ['--manage', 'list-devices', d.snapshot], {
      env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    listing.stdout.on('data', x => { out += x; });
    const end = Date.now() + 15000;
    while (listing.exitCode === null && listing.signalCode === null && Date.now() < end) await delay(25);
    assert.equal(listing.exitCode, 0, `本机读清单失败：${out}`);
    const plain = out.replace(/\r/g, '');
    assert.ok(plain.includes(d.devA.deviceId) && plain.includes(d.devB.deviceId),
      `两台设备都该还在清单里：${plain}`);
    assert.ok(!/revoked/.test(plain), `没有一次撤销被放行：\n${plain}`);
  });
});

test('本机 grant-scope 授予 management：运行中的 daemon 下一次请求即放行管理面', async () => {
  await withDaemon(async (d) => {
    // 授予前：认证通过但缺 scope，管理面不可达。
    const before = await d.rpc('auth/devices', {}, d.devA.bearer);
    assert.ok(before.text.includes('scope-required'), `授予前必须是 scope-required：${before.text}`);

    const granted = await runManage(['--manage', 'grant-scope', d.snapshot, d.devA.deviceId, 'management']);
    assert.equal(granted.code, 0, `本机授予失败：${granted.err}`);
    assert.match(granted.out, new RegExp(`granted ${d.devA.deviceId} management`));

    // 不重启 daemon：refreshFromDisk 在下一次 gate.check 吸收新快照。
    // 旧令牌仍有效，且 authenticate 每次都从设备记录复制当前 scopes。
    const after = await d.rpc('auth/devices', {}, d.devA.bearer);
    assert.equal(after.status, 200, `授予后管理面应放行：${after.text}`);
    const doc = JSON.parse(after.text);
    assert.ok(Array.isArray(doc.result.devices), `设备清单形状不对：${after.text}`);
    assert.ok(doc.result.devices.some(x => x.deviceId === d.devA.deviceId),
      `清单里必须包含被授予设备：${after.text}`);

    // 授予只作用于目标设备，不是整机开关。
    const other = await d.rpc('auth/devices', {}, d.devB.bearer);
    assert.ok(other.text.includes('scope-required'), `另一台设备仍是零权限：${other.text}`);

    // 管理 scope 也真的能执行管理动作，而不只是“能看清单”。
    const revoked = await d.rpc('auth/revoke', { deviceId: d.devB.deviceId, operationId: 'mg-revoke-B' }, d.devA.bearer);
    assert.equal(revoked.status, 200, revoked.text);
    assert.equal(JSON.parse(revoked.text).result.revoked, true, revoked.text);
    const revokedDev = await d.rpc('auth/devices', {}, d.devB.bearer);
    assert.ok(revokedDev.text.includes('invalid-token') || revokedDev.text.includes('-32001'),
      `被撤销设备的令牌必须立刻失效：${revokedDev.text}`);
  });
});

test('管理面的拒绝与未认证探测都落审计，且不落凭据原文', async () => {
  await withDaemon(async (d) => {
    await d.rpc('auth/devices', {}, d.devA.bearer);
    await d.rpc('auth/revoke', { deviceId: d.devB.deviceId }, d.devA.bearer);
    await d.rpc('auth/devices', {}, { authorization: 'Bearer not-a-token' });
    const text = await auditText(d);
    const lines = text.split('\n').filter(l => l.length > 0);
    const deniedDevices = lines.filter(l => l.includes('"method":"auth/devices"')
      && l.includes('"outcome":"denied"'));
    assert.ok(deniedDevices.length >= 2,
      `两次管理面探测至少各留一条拒绝：\n${lines.join('\n')}`);
    assert.ok(deniedDevices.some(l => l.includes('"denyReason":"scope-required"')),
      `认证通过但缺管理权要归到 scope-required：\n${deniedDevices.join('\n')}`);
    assert.ok(deniedDevices.some(l => l.includes('"denyReason":"unauthenticated-invalid"')),
      `坏令牌那次要归到未认证：\n${deniedDevices.join('\n')}`);
    // who 可辨：拒的那条带着发起设备，事后能回答「谁在试管理面」。
    assert.ok(deniedDevices.some(l => l.includes(`"deviceId":"${d.devA.deviceId}"`)),
      `管理面探测必须能归因到设备：\n${deniedDevices.join('\n')}`);
    // 秘密侧：设备凭据原文与访问令牌都不许出现在审计里。
    for (const secret of [d.devA.credential, d.devB.credential, d.devA.token, d.devB.token]) {
      assert.ok(!text.includes(secret), `审计含凭据/令牌原文：${text.slice(-300)}`);
    }
    assert.ok(!text.includes('Bearer'), '审计不得含认证头原文');
  });
});

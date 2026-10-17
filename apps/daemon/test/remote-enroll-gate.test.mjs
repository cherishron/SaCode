import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

// /auth/enroll 的 deviceName 与 kind 门禁（批次 R，plan 第 147 行前半句「入口门禁」的另一半）。
// 之前 deviceName 由客户端随意提交，然后 `${deviceName}-${序号}` 拼成 deviceId
// （core/src/remote_identity.cj:215）——换行、反斜杠、非 ASCII、超长串都能进，
// 之后每一条审计/事件/快照字段都跟着带这些字节。kind 更是裸 String 直塞进 DeviceRecord。
// 这一条不改语义只加门禁：非法形状在票据校验之前就 400，且**不消耗票据**
// （票据失败计数也无关，票据只在真的被消费时才动）。
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

async function boot(extraEnv) {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-enroll-gate-'));
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
  const end = Date.now() + 15000;
  while (!/127\.0\.0\.1:(\d+)/.test(out) && proc.exitCode === null && Date.now() < end) await delay(20);
  assert.match(out, /127\.0\.0\.1:(\d+)/, `daemon 未监听：stdout=${out} stderr=${err}`);
  const port = Number(out.match(/127\.0\.0\.1:(\d+)/)[1]);
  const post = (p, body, headers = {}) => fetch(`http://127.0.0.1:${port}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
    signal: AbortSignal.timeout(10000),
  });
  const stop = async () => {
    let graceful = false;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 's', method: 'daemon/shutdown', params: {} }),
        signal: AbortSignal.timeout(10000),
      });
      graceful = !/-32001/.test(await r.text());
    } catch {}
    if (!graceful) proc.kill('SIGKILL');
    await Promise.race([closed, delay(5000).then(() => null)]);
    await rm(cwd, { recursive: true, force: true });
  };
  return { port, post, stop };
}

async function manage(args) {
  const proc = spawn(daemonExe, args, { env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { err += d; });
  const code = await new Promise(resolve => proc.on('close', c => resolve(c)));
  return { code, out, err };
}

// 每种非法形状单独跑一遍，共享同一个 daemon 实例与同一张票据。
// 关键不变量：非法 shape 都必须 400。10 个坏请求正好卡在来源限流的
// 「used < 10」边界上（第 11 个才是 rate-limited），再多一条测试就会
// 把「限流命中」误读成「门禁没生效」。
test('/auth/enroll 拒绝 deviceName/kind 的非法形状', async () => {
  const dir = await mkdtemp(path.join(root, 'target', 'sacode-enroll-gate-fix-'));
  const identity = path.join(dir, 'instance.id');
  const snapshot = `${identity}.devices.json`;
  const d = await boot({
    SACODE_REMOTE_ACCESS: '1',
    SACODE_REMOTE_IDENTITY: identity,
    SACODE_REMOTE_POLICY: policyFile,
  });
  try {
    const created = await manage(['--manage', 'enroll-ticket', snapshot, 'p-gate']);
    assert.equal(created.code, 0, `管理入口应成功建票：${created.err}`);
    const ticket = created.out.replace(/\r/g, '').trim().split('\n')[1];
    assert.match(ticket, /^[0-9a-f]{32}$/, '登记秘密是 16 字节 hex');

    const badCases = [
      // 反斜杠：Windows 路径分隔符号，会污染快照与审计的字段级读取。
      ['backslash', 'evil\\device', 'mobile', 'device-name-invalid'],
      // 换行：直接进 deviceId 就把审计日志拆两行。
      ['newline', 'evil\ndevice', 'mobile', 'device-name-invalid'],
      ['carriage-return', 'evil\rdevice', 'mobile', 'device-name-invalid'],
      // 非 ASCII：客户端可能塞中文，但快照里 deviceId 走的是 ASCII 编码面。
      ['non-ascii', 'evil-设备', 'mobile', 'device-name-invalid'],
      // 前导空白：字符串比较会静默失败（"phone" 与 " phone" 都过门禁但语义不同）。
      ['leading-space', ' phone', 'mobile', 'device-name-invalid'],
      // 超长：deviceId 走 HTTP 头与 URL 路径，超过合理上界就是客户端在探测边界。
      ['too-long', 'p'.repeat(65), 'mobile', 'device-name-too-long'],
      // kind 是枚举：不是 desktop|mobile|cli|host 就是配置错或伪造。
      ['kind-bad', 'phone', 'android', 'device-kind-invalid'],
      ['kind-empty', 'phone', '', 'device-kind-invalid'],
      // kind 大小写敏感：Android 与 android 不是同一枚举项，静默接受等于放宽契约。
      ['kind-case', 'phone', 'Android', 'device-kind-invalid'],
      // 尾随空白单独一档：反方向边界。
      ['trailing-space', 'phone ', 'mobile', 'device-name-invalid'],
    ];
    assert.equal(badCases.length, 10, '恰好卡住 10 来源限流上限，多一条就归因不清');

    for (const [label, deviceName, kind, expectedReason] of badCases) {
      const r = await d.post('/auth/enroll',
        JSON.stringify({ enrollmentSecret: ticket, deviceName, kind }));
      assert.equal(r.status, 400, `${label} 必须 400，实得 ${r.status}`);
      const body = await r.json();
      assert.equal(body.error, expectedReason, `${label} 归因必须精确：${JSON.stringify(body)}`);
    }
  } finally {
    await d.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

// 「非法 shape 不消耗票据」单独立一条用例，因为和上面那条一起跑会撞限流：
// 上面那条已经用了 10 次来源额度，第 11 次的合法请求会被 rate-limited，
// 看起来像「票据被消耗掉了」，其实是限流命中。用新 daemon 新票据隔离，
// 就能把「shape 门禁」与「限流」分开归因。
test('/auth/enroll 非法 shape 不消耗票据：紧接的合法请求仍应通过', async () => {
  const dir = await mkdtemp(path.join(root, 'target', 'sacode-enroll-gate-noc-'));
  const identity = path.join(dir, 'instance.id');
  const snapshot = `${identity}.devices.json`;
  const d = await boot({
    SACODE_REMOTE_ACCESS: '1',
    SACODE_REMOTE_IDENTITY: identity,
    SACODE_REMOTE_POLICY: policyFile,
  });
  try {
    const created = await manage(['--manage', 'enroll-ticket', snapshot, 'p-gate']);
    assert.equal(created.code, 0, `管理入口应成功建票：${created.err}`);
    const ticket = created.out.replace(/\r/g, '').trim().split('\n')[1];

    const bad = await d.post('/auth/enroll',
      JSON.stringify({ enrollmentSecret: ticket, deviceName: 'evil\\path', kind: 'mobile' }));
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'device-name-invalid');

    // 关键：同一张票据再走一次合法 shape 应仍 200。
    // 如果门禁把票据消费掉了（或者把「shape 非法」当失败计数），这里就会 401/429。
    const good = await d.post('/auth/enroll',
      JSON.stringify({ enrollmentSecret: ticket, deviceName: 'gate-phone', kind: 'mobile' }));
    const text = await good.text();
    assert.equal(good.status, 200, `非法 shape 被拒后，票据仍必须可用：${text}`);
    const dev = JSON.parse(text);
    assert.equal(dev.deviceId, 'gate-phone-1');
  } finally {
    await d.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

// 合法 shape 必须打通过——反向锁，防止门禁写成永拒。
test('/auth/enroll 合法 deviceName/kind 打通过', async () => {
  const dir = await mkdtemp(path.join(root, 'target', 'sacode-enroll-gate-ok-'));
  const identity = path.join(dir, 'instance.id');
  const snapshot = `${identity}.devices.json`;
  const d = await boot({
    SACODE_REMOTE_ACCESS: '1',
    SACODE_REMOTE_IDENTITY: identity,
    SACODE_REMOTE_POLICY: policyFile,
  });
  try {
    const created = await manage(['--manage', 'enroll-ticket', snapshot, 'p-ok']);
    assert.equal(created.code, 0, `管理入口应成功建票：${created.err}`);
    const ticket = created.out.replace(/\r/g, '').trim().split('\n')[1];
    // 边界值：正好 64 字节、含连字符、含下划线、含数字——都该过。
    const longName = 'a'.repeat(56) + '-_012345';
    const names = ['phone', 'workstation-01', 'cli_2', 'android-pad', longName];
    const kinds = ['desktop', 'mobile', 'cli', 'host'];
    // 一张票据只兑一次，所以每个组合先建一张新票据。
    for (const [i, deviceName] of names.entries()) {
      const kind = kinds[i % kinds.length];
      const c = await manage(['--manage', 'enroll-ticket', snapshot, `p-ok-${i}`]);
      assert.equal(c.code, 0, `第 ${i} 张票应建成：${c.err}`);
      const t = c.out.replace(/\r/g, '').trim().split('\n')[1];
      const r = await d.post('/auth/enroll',
        JSON.stringify({ enrollmentSecret: t, deviceName, kind }));
      const text = await r.text();
      assert.equal(r.status, 200, `合法 shape ${JSON.stringify({ deviceName, kind })} 必须 200：${text}`);
      const dev = JSON.parse(text);
      assert.equal(dev.deviceId, `${deviceName}-${i + 1}`,
        `deviceId 由 deviceName 与序号拼接：期望 ${deviceName}-${i + 1}，实得 ${dev.deviceId}`);
    }
  } finally {
    await d.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

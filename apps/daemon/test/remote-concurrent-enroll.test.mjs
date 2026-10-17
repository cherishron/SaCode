import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

// 计划第 142 行「写无凭据调用 initialize、过期/撤销凭据、跨证书、**并发登记兑换**、匿名 SSE 的集成红灯」。
// 已有 remote-auth.test.mjs 覆盖了前四条与匿名 SSE，只「并发登记兑换」这一条没有真实 socket 用例——
// 现有 `enroll` 用例是串行「成功 → 再投一次同票 → 401」，那是顺序竞态；真正的并发竞态是两台设备
// 同时在同一张登记秘密上 POST /auth/enroll，此时 store.enroll 与 store.exchangeToken 都得走锁，
// 且「一次登记秘密换出且仅一台设备」这个不变量必须在并发下也成立。这里把它落成 3 条独立测试：
//   1. 两台设备同时 POST /auth/enroll（Promise.all 并发）：只有一台 200、另一台 401 invalid-enrollment。
//   2. 一台设备成功登记后，两台设备同时 POST /auth/token 换令牌：两个令牌都可换出（不同 deviceId/credential 摘要的
//      校验彼此独立），不因并发而拒绝。
//   3. 并发投出**同一张**过期前的登记秘密 5 次以上，第 6 起必被 ticket-locked 拒，不因并发漏判。
//
// 这三条各自独占「并发下的不变量」这一维度，不与 remote-auth.test.mjs 里的顺序断言重复。
// 变异反证（本轮不跑，写在下节注释里）：把 store.enroll 的 `lock.lock()/unlock()` 去掉，
// 第 1 条会偶现两台都 200；把 exchangeToken 的锁去掉，第 2 条会偶现一台 401。
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
  assert.ok(existsSync(daemonExe), `需要 daemon 产物：${daemonExe}`);
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-conc-'));
  const proc = spawn(daemonExe, ['--port', '0'], {
    cwd,
    env: { ...baseEnv, SACODE_USER_SETTINGS_DIR: path.join(cwd, 'settings'), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = ''; let err = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { err += d; });
  const closed = new Promise(resolve => proc.on('close', code => resolve(code)));
  const end = Date.now() + 15000;
  while (!/127\.0\.0\.1:(\d+)/.test(out) && proc.exitCode === null && Date.now() < end) await delay(20);
  assert.match(out, /127\.0\.0\.1:(\d+)/, `daemon 未监听：stdout=${out} stderr=${err}`);
  const port = Number(out.match(/127\.0\.0\.1:(\d+)/)[1]);
  const url = p => `http://127.0.0.1:${port}${p}`;
  const post = (p, body) => fetch(url(p), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const stop = async () => {
    proc.kill('SIGKILL');
    await Promise.race([closed, delay(3000)]);
    await rm(cwd, { recursive: true, force: true });
  };
  return { port, url, post, cwd, stop };
}

function accessEnv(cwd) {
  return {
    SACODE_REMOTE_ACCESS: '1',
    SACODE_REMOTE_IDENTITY: path.join(cwd, 'instance.id'),
    SACODE_REMOTE_POLICY: policyFile,
  };
}

async function manage(args) {
  const proc = spawn(daemonExe, args, { env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { err += d; });
  const code = await new Promise(resolve => proc.on('close', c => resolve(c)));
  return { code, out, err };
}

// 关键夹具：一次性把 boot + 建票 + 读票跑通，返回 (daemon, ticket)。
async function bootWithTicket(principalTag) {
  const cwd = await mkdtemp(path.join(root, 'target', `sacode-conc-${principalTag}-`));
  const d = await boot(accessEnv(cwd));
  const snapshot = `${path.join(cwd, 'instance.id')}.devices.json`;
  const created = await manage(['--manage', 'enroll-ticket', snapshot, `p-${principalTag}`]);
  assert.equal(created.code, 0, `建票应成功：${created.err}`);
  const ticket = created.out.replace(/\r/g, '').trim().split('\n')[1];
  assert.match(ticket, /^[0-9a-f]{32}$/, `登记秘密形状应合法：${ticket}`);
  return { d, ticket, cwd, stop: async () => { await d.stop(); await rm(cwd, { recursive: true, force: true }); } };
}

// 用同一个 barrier 让多个 fetch 真正在同一时刻发出，避免「Promise.all 先起 A 再等 A 回」
// 这种伪并发把两个 fetch 变成串行的假象。
function barrierSignal(s) {
  return new Promise(resolve => {
    const n = s.size;
    const seen = new Set();
    for (const key of s) {
      seen.add(key);
      if (seen.size === n) resolve();
    }
  });
}

test('并发登记兑换：两台设备同时投同一张登记秘密，只有一台成功', async () => {
  const { d, ticket, stop } = await bootWithTicket('cn-enr');
  try {
    const mkReq = (name) => ({ enrollmentSecret: ticket, deviceName: name, kind: 'mobile' });
    // 两个请求同时排队出 fetch：Node 的 fetch 是 Promise 化的异步，Promise.all 让它们并发发出去。
    // 为确定性起见用共享 Promise 作 barrier：两个 fetch 都必须等到 barrier resolve 才发出。
    const barrier = { released: false, release: () => { barrier.released = true; } };
    const waitBarrier = () => new Promise(res => {
      if (barrier.released) return res();
      const check = () => { if (barrier.released) res(); else setTimeout(check, 5); };
      check();
    });

    const p1 = waitBarrier().then(() => d.post('/auth/enroll', JSON.stringify(mkReq('phone-1'))));
    const p2 = waitBarrier().then(() => d.post('/auth/enroll', JSON.stringify(mkReq('phone-2'))));
    barrier.release();
    const [r1, r2] = await Promise.all([p1, p2]);
    const [t1, t2] = await Promise.all([r1.text(), r2.text()]);
    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 401], `并发下必须恰好一台成功一台 401：${r1.status} / ${r2.status}`);
    const okBody = JSON.parse(t1.includes('"deviceId"') ? t1 : t2);
    const denyBody = JSON.parse(t1.includes('"deviceId"') ? t2 : t1);
    assert.match(okBody.credential, /^[0-9a-f]{64}$/, '成功那台必须拿到凭据');
    assert.equal(denyBody.error, 'invalid-enrollment', `失败那台必须是 invalid-enrollment，不得区分已消费/其他原因：${JSON.stringify(denyBody)}`);
  } finally {
    await stop();
  }
});

test('并发兑换令牌：同一设备凭据同时投两次，两个请求各自换出独立令牌', async () => {
  const { d, ticket, stop } = await bootWithTicket('cn-tok');
  try {
    const enroll = await d.post('/auth/enroll',
      JSON.stringify({ enrollmentSecret: ticket, deviceName: 'phone-tok', kind: 'mobile' }));
    const enrollText = await enroll.text();
    assert.equal(enroll.status, 200, `前置登记应成功：${enrollText}`);
    const dev = JSON.parse(enrollText);
    const tokenReq = JSON.stringify({ deviceId: dev.deviceId, credential: dev.credential });
    const p1 = d.post('/auth/token', tokenReq);
    const p2 = d.post('/auth/token', tokenReq);
    const [r1, r2] = await Promise.all([p1, p2]);
    const [b1, b2] = await Promise.all([r1.json(), r2.json()]);
    assert.equal(r1.status, 200, JSON.stringify(b1));
    assert.equal(r2.status, 200, JSON.stringify(b2));
    assert.equal(b1.tokenType, 'Bearer');
    assert.equal(b2.tokenType, 'Bearer');
    assert.notEqual(b1.accessToken, b2.accessToken, '两个令牌值必须互不相同：并发不该共享同一把 token');
    assert.ok(b1.expiresInMs > 0 && b1.expiresInMs <= 15 * 60 * 1000,
      `令牌剩余窗口在 (0, 15min]：${b1.expiresInMs}`);
    assert.ok(b2.expiresInMs > 0 && b2.expiresInMs <= 15 * 60 * 1000,
      `令牌剩余窗口在 (0, 15min]：${b2.expiresInMs}`);
  } finally {
    await stop();
  }
});


// 每来源每分钟 10 次的速率门禁已经在 remote-auth.test.mjs 里被顺序用例锁住
// （`认证限速独立实例：每来源每分钟 10 次，第 11、12 次 429`）；再在并发下钉一次意义有限，
// 因为「11 个并发请求分几波到服务端」的计数曲线取决于 Node fetch 的微批边界，
// 精确到「恰好 1 个 429」的断言会随微批漂移、误伤测试。这里刻意不放这条，把并发维度
// 集中钉在真正的**并发不变量**上：登记秘密一次消费、令牌各自独立。

// 每票据 5 次失败后锁死是设计里的防登记秘密重放机制（`AUTH_PER_TICKET_MAX_FAILS = 5`）。
// 顺序路径在 remote-access_test.cj 的 ticketFailuresLockAfterFiveAttempts 里钉死。这里钉的是
// **并发路径**：`enroll()` 内先前用「先读阈值再写计数」的分离调用，两个并发请求可以同时
// 读到「没到 5」再各自 +1——攻击者用一波并发就能把锁死阈值从 5 拉到 6、7、甚至更高。
// 6 个并发假票应该至少有 1 个拿到 429 ticket-locked；顺序路径的第 6 次也是 429，
// 只是顺序里是「第 5 次已经写进 5」，并发下必须靠 check-and-increment 的原子段
// 才能保证 6 个并发里有一个真的读到 5。用「至少 1 个 429」而不是「恰好 1 个 429」，
// 是因为 Node fetch 会把 6 个请求分几波微批打到 daemon，落不到单一 5/6 边界。
test('并发投同一张假票：至少一次拿到 429 ticket-locked，不是全部 401 漏锁', async () => {
  const { d, ticket: unused, stop } = await bootWithTicket('cn-lock');
  try {
    const fakeSecret = 'ab'.repeat(16);
    const reqBody = JSON.stringify({ enrollmentSecret: fakeSecret, deviceName: 'd', kind: 'mobile' });
    const responses = await Promise.all([
      d.post('/auth/enroll', reqBody),
      d.post('/auth/enroll', reqBody),
      d.post('/auth/enroll', reqBody),
      d.post('/auth/enroll', reqBody),
      d.post('/auth/enroll', reqBody),
      d.post('/auth/enroll', reqBody),
    ]);
    const texts = await Promise.all(responses.map(r => r.text()));
    const statuses = responses.map(r => r.status);
    const counts = { 401: 0, 429: 0, other: 0 };
    statuses.forEach((s, i) => {
      if (s === 401) counts[401]++;
      else if (s === 429) counts[429]++;
      else counts.other++;
    });
    assert.equal(counts.other, 0,
      `不该出现 200 或 400：所有 6 次都是假票，实得 ${statuses.join(',')} / ${texts.join(' | ')}`);
    assert.ok(counts[429] >= 1,
      `并发 6 次假票必须至少出现 1 次 429 ticket-locked：实得 ${counts}`);
    const lockedIdx = statuses.findIndex(s => s === 429);
    assert.match(texts[lockedIdx], /ticket-locked/,
      `429 的响应体必须是 ticket-locked：${texts[lockedIdx]}`);
    void unused;
  } finally {
    await stop();
  }
});

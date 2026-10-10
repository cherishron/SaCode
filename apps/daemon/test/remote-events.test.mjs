import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

// session/events 的运行验收（设计 §6 + AGENTS.md 第一条不变量「会话日志是唯一真源，
// append 只在实例内可见，flush 才跨进程持久」）。
// 这一面最有价值的地方是它能把那条不变量搬到远程协议上看：
// 刚 submit 完的事件**不该**出现在补读页里，flush 之后必须出现——
// 中间那一步如果反了，说明补读读的是内存而不是盘。
//
// 一条实测前提（2026-10-10 探针）：宿主的写目标是它**当前选中**的那条会话，
// 所以远程序列必须是 create → select → submit → flush；少了 select，正文会落进
// 工作区根的 current 会话日志，而补读面按 sessionId 解析到 sessions/<id>/session.log，
// 于是「提交了但补读永远读不到」。下面每条用例都按这个序列建会话。
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

async function rmBounded(dir) {
  const until = Date.now() + 8000;
  for (;;) {
    try { await rm(dir, { recursive: true, force: true }); return; }
    catch (e) { if (Date.now() >= until) throw e; await delay(200); }
  }
}

async function boot(cwd) {
  assert.ok(existsSync(hostExe), `需要真实宿主产物：${hostExe} 不存在。先跑 node scripts/pack-host.mjs（记 BLOCKED，不是跳过）`);
  assert.ok(existsSync(daemonExe), `需要 daemon 产物：${daemonExe} 不存在。先跑 cd apps/daemon && cjpm build`);
  const ws = cwd.replace(/\\/g, '/');
  const proc = spawn(daemonExe, ['--port', '0'], {
    cwd,
    env: {
      ...baseEnv,
      SACODE_USER_SETTINGS_DIR: path.join(cwd, 'settings'),
      SACODE_REMOTE_ACCESS: '1',
      SACODE_REMOTE_IDENTITY: path.join(cwd, 'instance.id'),
      SACODE_REMOTE_POLICY: policyFile,
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
  const until = Date.now() + 20000;
  while (!/127\.0\.0\.1:(\d+)/.test(out) && proc.exitCode === null && Date.now() < until) await delay(20);
  assert.match(out, /127\.0\.0\.1:(\d+)/, `daemon 未监听：stdout=${out} stderr=${err}`);
  const port = Number(out.match(/127\.0\.0\.1:(\d+)/)[1]);
  return {
    ws,
    url: p => `http://127.0.0.1:${port}${p}`,
    stop: async () => {
      const closed = new Promise(resolve => proc.on('close', resolve));
      proc.kill('SIGKILL');
      await Promise.race([closed, delay(3000)]);
    },
  };
}

async function device(d, cwd, principal, name) {
  const created = await new Promise(resolve => {
    const p = spawn(daemonExe, ['--manage', 'enroll-ticket', `${cwd}/instance.id.devices.json`, principal], { cwd, env: baseEnv });
    let o = '';
    let e = '';
    p.stdout.on('data', x => { o += x; });
    p.stderr.on('data', x => { e += x; });
    p.on('close', code => resolve({ code, e, o }));
  });
  assert.equal(created.code, 0, `建票应成功：${created.e}`);
  const ticket = created.o.replace(/\r/g, '').trim().split('\n')[1];
  const dev = JSON.parse(await (await fetch(d.url('/auth/enroll'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enrollmentSecret: ticket, deviceName: name, kind: 'mobile' }),
    signal: AbortSignal.timeout(15000),
  })).text());
  const tok = JSON.parse(await (await fetch(d.url('/auth/token'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: dev.deviceId, credential: dev.credential }),
    signal: AbortSignal.timeout(15000),
  })).text());
  return `Bearer ${tok.accessToken}`;
}

async function rpc(d, bearer, method, params, id) {
  const r = await fetch(d.url('/rpc'), {
    method: 'POST',
    headers: { authorization: bearer, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 交给断言 */ }
  assert.ok(json, `${method} #${id} 应答不是 JSON：${text.slice(0, 300)}`);
  return json;
}

// 建一条会话并选中它：远程客户端要让正文落进这条会话的日志，select 是不可省的一步。
async function openSession(d, cwd, tag, principal) {
  const bearer = await device(d, cwd, principal || `p-${tag}`, tag);
  const made = await rpc(d, bearer, 'session/create',
    { workspaceId: d.ws, title: `ev-${tag}`, operationId: `op-${tag}-new` }, `${tag}-c`);
  assert.ok(made.result?.id, `建会话应成功：${JSON.stringify(made)}`);
  const sid = made.result.id;
  const sel = await rpc(d, bearer, 'session/select', { workspaceId: d.ws, sessionId: sid }, `${tag}-sel`);
  assert.ok(sel.result?.selected, `选中会话应成功（正文只写进当前选中会话）：${JSON.stringify(sel)}`);
  return { bearer, sid };
}

// 提交一句正文，返回宿主自报的 (events, durable) 计数——补读页要和它对账，而不是和某个猜的条数。
async function say(d, bearer, sid, text, opSuffix) {
  return rpc(d, bearer, 'session/submit', {
    workspaceId: d.ws, sessionId: sid, operationId: `op-say-${opSuffix}`,
    eventType: 'user/message', data: text,
  }, `say-${opSuffix}`);
}

async function flushSession(d, bearer, sid, opSuffix) {
  return rpc(d, bearer, 'session/flush',
    { workspaceId: d.ws, sessionId: sid, operationId: `op-flush-${opSuffix}` }, `fl-${opSuffix}`);
}

async function events(d, bearer, sid, extra) {
  return rpc(d, bearer, 'session/events',
    { workspaceId: d.ws, sessionId: sid, limit: '200', ...extra }, `ev-${JSON.stringify(extra || {})}`);
}

// catalog 里的 durable 是宿主自己数出来的持久条数，和补读页条数是两条独立来源。
async function durableCounter(d, bearer, sid) {
  const cat = await rpc(d, bearer, 'session/catalog', { workspaceId: d.ws }, 'cat');
  const row = cat.result.entries.find(e => e.id === sid);
  assert.ok(row, `catalog 应能查到这条会话：${JSON.stringify(cat.result)}`);
  return row.durable;
}

test('刚 submit 还没 flush 的正文不进补读页；flush 之后必须进', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-ev-flush-'));
  const d = await boot(cwd);
  try {
    const { bearer, sid } = await openSession(d, cwd, 'flush');
    const sub = await say(d, bearer, sid, '补读正文-flush', 'flush');
    assert.ok(sub.result, JSON.stringify(sub));
    // 前提要自己成立：确实存在「已 append 未 flush」的窗口，否则下面两次读没有区别。
    assert.equal(sub.result.events > sub.result.durable, true,
      `这条用例的前提是 events>durable（有未落盘尾巴）：${JSON.stringify(sub.result)}`);
    const before = await events(d, bearer, sid);
    assert.ok(before.result, JSON.stringify(before));
    assert.equal(before.result.events.some(e => (e.data || '').includes('补读正文-flush')), false,
      `未 flush 的正文不能当持久历史交出去：${JSON.stringify(before.result)}`);
    const fl = await flushSession(d, bearer, sid, 'flush');
    assert.equal(fl.result.durable, fl.result.events, `flush 后应全部持久：${JSON.stringify(fl.result)}`);
    const after = await events(d, bearer, sid);
    assert.equal(after.result.events.filter(e => (e.data || '').includes('补读正文-flush')).length, 1,
      `flush 之后补读必须正好拿到它一次，否则持久记录真的会丢：${JSON.stringify(after.result)}`);
    // §6 固定形状：seq 是十进制字符串。
    for (const e of after.result.events) {
      assert.equal(typeof e.seq, 'string', `seq 必须出线成十进制字符串：${JSON.stringify(e)}`);
      assert.match(e.seq, /^[0-9]+$/);
      assert.equal(typeof e.eventType, 'string');
    }
    // 补读页条数要和宿主自报的持久条数对上：两条独立来源互相反证。
    assert.equal(after.result.events.length, await durableCounter(d, bearer, sid),
      `补读页条数与 catalog 持久条数不一致：${JSON.stringify(after.result)}`);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('缺省游标从 seq 0 起，显式 "0" 才表示已看过 seq 0', async () => {
  // 新客户端第一次补读不该天然丢掉第一条；而 "0" 是「已看到 seq 0」的游标，两者不能是同一个值。
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-ev-head-'));
  const d = await boot(cwd);
  try {
    const { bearer, sid } = await openSession(d, cwd, 'head');
    await say(d, bearer, sid, '第一条正文', 'head');
    const fl = await flushSession(d, bearer, sid, 'head');
    assert.ok(fl.result, JSON.stringify(fl));
    const head = await events(d, bearer, sid);
    const seen = await events(d, bearer, sid, { afterSeq: '0' });
    assert.equal(head.result.events[0].seq, '0', `从头读必须含 seq 0：${JSON.stringify(head.result)}`);
    assert.equal(seen.result.events.some(e => e.seq === '0'), false,
      `显式 "0" 必须把 seq 0 当已看过：${JSON.stringify(seen.result)}`);
    assert.equal(head.result.events.length, seen.result.events.length + 1,
      `两种游标形状必须差出第一条，否则这条钉子等于没写：${JSON.stringify(head.result)}/${JSON.stringify(seen.result)}`);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('静默轮询原样带回游标，之后才落盘的那条不会被跳过', async () => {
  // nextSeq 的口径是「你确实看到的那一条」。若它回的是「本来打算给你的那一条」，
  // 客户端下一次轮询就会把还没存在过的那条当已看过，之后落盘的事件永久丢失。
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-ev-poll-'));
  const d = await boot(cwd);
  try {
    const { bearer, sid } = await openSession(d, cwd, 'poll');
    await say(d, bearer, sid, '轮询前正文', 'poll-1');
    await flushSession(d, bearer, sid, 'poll-1');
    const first = await events(d, bearer, sid);
    const cursor = first.result.nextSeq;
    const quiet = await events(d, bearer, sid, { afterSeq: cursor });
    assert.deepEqual(quiet.result.events, [], `没有新事件就该回空页：${JSON.stringify(quiet.result)}`);
    assert.equal(quiet.result.nextSeq, cursor,
      `静默轮询必须原样带回游标，不能往前跳一格：${JSON.stringify(quiet.result)}`);
    assert.equal(quiet.result.hasMore, false, JSON.stringify(quiet.result));
    // 现在才落盘第二条：接着用同一个游标问，必须拿到它。
    await say(d, bearer, sid, '轮询之后才落盘的正文', 'poll-2');
    await flushSession(d, bearer, sid, 'poll-2');
    const got = await events(d, bearer, sid, { afterSeq: quiet.result.nextSeq });
    assert.equal(got.result.events.filter(e => (e.data || '').includes('轮询之后才落盘的正文')).length, 1,
      `静默轮询不能把后来持久化的事件跳掉：${JSON.stringify(got.result)}`);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('补读按 limit 切页且 nextSeq 能接着取，最后一页 hasMore 为假', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-ev-page-'));
  const d = await boot(cwd);
  try {
    const { bearer, sid } = await openSession(d, cwd, 'page');
    for (const i of ['a', 'b', 'c']) {
      await say(d, bearer, sid, `分页正文-${i}`, `page-${i}`);
    }
    const fl = await flushSession(d, bearer, sid, 'page');
    assert.ok(fl.result, JSON.stringify(fl));
    const all = await events(d, bearer, sid);
    assert.equal(all.result.hasMore, false, JSON.stringify(all.result));
    assert.equal(all.result.events.length, await durableCounter(d, bearer, sid),
      `单页取回的就是全部持久事件：${JSON.stringify(all.result)}`);
    assert.ok(all.result.events.length >= 4,
      `标题 + 三条正文至少四条（前提不成立就说明夹具没真的落盘）：${JSON.stringify(all.result)}`);
    // 逐页取完必须正好覆盖同一批事件，一条不重一条不漏。第一页就用空串游标（= 从头），
    // 不能图省事先取一整页再分页——那样这条断言会自己和自己相等。
    let cursor = '';
    const seen = [];
    let guard = 0;
    for (;;) {
      const p = await events(d, bearer, sid, { afterSeq: cursor, limit: '1' });
      assert.equal(p.result.events.length, 1, `每页应正好一条（第 ${guard} 轮，游标 ${JSON.stringify(cursor)}）：${JSON.stringify(p.result)}`);
      seen.push(p.result.events[0].seq);
      if (!p.result.hasMore) { break }
      cursor = p.result.nextSeq;
      guard += 1;
      assert.ok(guard < 40, '分页没收敛，nextSeq 大概没往前推');
    }
    assert.deepEqual(seen, all.result.events.map(e => e.seq), '分页拼接结果与单页全集必须逐条一致');
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('代次不符与游标越界都回显式 gap，不是空页；limit 越界按非法参数拒', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-ev-gap-'));
  const d = await boot(cwd);
  try {
    const { bearer, sid } = await openSession(d, cwd, 'gap');
    await say(d, bearer, sid, ' gap 正文', 'gap');
    await flushSession(d, bearer, sid, 'gap');
    const now = await events(d, bearer, sid, { afterSeq: '0' });
    assert.equal(now.result.gap, null, JSON.stringify(now.result));
    const stale = await events(d, bearer, sid, { afterSeq: '0', generation: 'f'.repeat(64) });
    assert.equal(stale.result.gap, 'generation-mismatch', JSON.stringify(stale.result));
    // gap 里带当前代次，客户端一次往返就能重取快照，不用再问一遍。
    assert.equal(stale.result.generation, now.result.generation);
    assert.deepEqual(stale.result.events, [], `gap 不能同时把事件塞进页里：${JSON.stringify(stale.result)}`);
    const beyond = await events(d, bearer, sid, { afterSeq: '999999' });
    assert.equal(beyond.result.gap, 'cursor-beyond-horizon', JSON.stringify(beyond.result));
    const badLimit = await rpc(d, bearer, 'session/events',
      { workspaceId: d.ws, sessionId: sid, afterSeq: '0', limit: 0 }, 'gp-4');
    assert.equal(badLimit.error.code, -32602, JSON.stringify(badLimit));
    assert.equal(badLimit.error.message, 'limit-out-of-range');
    const badCursor = await events(d, bearer, sid, { afterSeq: '-5' });
    assert.equal(badCursor.error.message, 'cursor-malformed', JSON.stringify(badCursor));
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('补读按 sessionId 归属：另一条会话读不到这条会话的正文', async () => {
  // 设计 §6 的「显式会话归属」在补读面上的落点：页内容只能来自请求点名的那条会话。
  // 少了这一条，多目标/多设备并发时「读到别人的正文」是最高危的泄漏面。
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-ev-iso-'));
  const d = await boot(cwd);
  try {
    const a = await openSession(d, cwd, 'iso-a');
    await say(d, a.bearer, a.sid, '只有 A 该有的正文', 'iso-a');
    await flushSession(d, a.bearer, a.sid, 'iso-a');
    const b = await openSession(d, cwd, 'iso-b');
    const inB = await events(d, b.bearer, b.sid);
    assert.equal(inB.result.events.some(e => (e.data || '').includes('只有 A 该有的正文')), false,
      `B 的补读页混进了 A 的正文：${JSON.stringify(inB.result)}`);
    const inA = await events(d, a.bearer, a.sid);
    assert.equal(inA.result.events.some(e => (e.data || '').includes('只有 A 该有的正文')), true,
      `A 自己的补读页反而没有它，说明归属解析到了错误的日志：${JSON.stringify(inA.result)}`);
    // 两条会话的代次必须不同（首条持久事件不同），否则「按会话隔离」只是碰巧。
    assert.notEqual(inA.result.generation, inB.result.generation,
      `${JSON.stringify(inA.result)} vs ${JSON.stringify(inB.result)}`);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

test('缺 sessionId 时授权面先拒，补读面不自己判归属', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-ev-authz-'));
  const d = await boot(cwd);
  try {
    const bearer = await device(d, cwd, 'p-authz', 'authz');
    const r = await rpc(d, bearer, 'session/events', { workspaceId: d.ws, limit: '50' }, 'az-1');
    assert.equal(r.error.code, -32001, JSON.stringify(r));
    assert.match(r.error.message, /session-required/);
  } finally {
    await d.stop();
    await rmBounded(cwd);
  }
});

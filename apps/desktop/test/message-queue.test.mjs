// 运行中消息队列的接入验收：条目是会话日志里的事实，不是渲染层的临时状态。
// 上游口径（冻结 639ed01 直读）：唯一持久事件是 agent/inbox/spliced；
// 排队消息在轮次边界作为独立的 user/message 送达；操作不幂等，也不带版本号。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { HostBridge } = require('../host-bridge.cjs');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const HOST = process.env.DSH_HOST || join(HERE, '..', 'dist', 'host', 'bin', 'dsh-host.exe');
const FIXTURE = join(REPO, 'scripts', 'sse-contract-server.cjs');
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

function freshDir() { return mkdtempSync(join(tmpdir(), 'sacode-queue-')); }

async function startBridge(dir) {
  const bridge = new HostBridge(HOST, { ...process.env, SACODE_USER_SETTINGS_DIR: join(dir, 'settings') });
  await bridge.start(dir);
  return bridge;
}

async function startSseFixture() {
  const proc = spawn(process.execPath, [FIXTURE], { stdio: ['pipe', 'pipe', 'pipe'] });
  const port = await new Promise((res, rej) => {
    let buf = '';
    const to = setTimeout(() => rej(new Error('SSE 夹具启动超时')), 8000);
    proc.stdout.on('data', (d) => { buf += d.toString(); const i = buf.indexOf('\n'); if (i >= 0) { clearTimeout(to); res(buf.slice(0, i).trim()); } });
    proc.stderr.on('data', (d) => process.stderr.write(`[queue-fixture] ${d}`));
    proc.on('error', (e) => { clearTimeout(to); rej(e); });
  });
  return { proc, port: Number(port) };
}

function stopSseFixture(proc) {
  for (const fn of [() => proc.stdin.write('x'), () => proc.stdin.end(), () => proc.kill()]) { try { fn(); } catch (_) {} }
}

test('排队条目由核心铸造 id，同一次提交不会重复入列', async () => {
  const dir = freshDir();
  const bridge = await startBridge(dir);
  try {
    const first = await bridge.request('queue/enqueue', { text: '排队的第一条', rpcId: 'rpc-1' });
    assert.equal(first.accepted, true);
    assert.ok(String(first.id).length > 0, '条目 id 由核心铸造');
    const echo = await bridge.request('queue/enqueue', { text: '排队的第一条', rpcId: 'rpc-1' });
    assert.equal(echo.deduped, true, '同一 rpcId 的回声接受但不复制');
    const view = await bridge.request('queue/describe');
    assert.equal(view.nextTurn.length, 1);
    assert.deepEqual(view.nextTurn[0], { id: first.id, text: '排队的第一条', rpcId: 'rpc-1', attachments: [] });
    assert.equal(view.nextStep.length, 0);
    assert.equal(view.running, false);
  } finally {
    const stopped = await bridge.stop();
    assert.equal(stopped.code, 0);
  }
});

test('队列操作要求条目仍在队列里且不幂等', async () => {
  const dir = freshDir();
  const bridge = await startBridge(dir);
  try {
    const enq = await bridge.request('queue/enqueue', { text: '要被删掉的一条', rpcId: 'rpc-2' });
    const removed = await bridge.request('queue/update', { itemId: enq.id, kind: 'remove' });
    assert.equal(removed.accepted, true);
    // 重放同一个删除必须报错：静默成功等于界面上「删了两次」和「删了一条不存在的」分不开
    await assert.rejects(() => bridge.request('queue/update', { itemId: enq.id, kind: 'remove' }), /queue-item-not-found/);
    await assert.rejects(() => bridge.request('queue/update', { itemId: 'q-none', kind: 'edit', text: '正文' }), /queue-item-not-found/);
    const again = await bridge.request('queue/enqueue', { text: '改正文的这条', rpcId: 'rpc-3' });
    await assert.rejects(() => bridge.request('queue/update', { itemId: again.id, kind: 'edit', text: '   ' }), /queue-edit-blank/);
    const view = await bridge.request('queue/describe');
    assert.equal(view.nextTurn.length, 1, '空白编辑一条都不改');
    assert.equal(view.nextTurn[0].text, '改正文的这条');
    // 空闲时没有可补充的轮次：报的是上游那条 steer-unavailable，不是假装接受
    await assert.rejects(() => bridge.request('queue/update', { itemId: again.id, kind: 'steer' }), /queue-steer-unavailable/);
    await assert.rejects(() => bridge.request('queue/update', { itemId: again.id, kind: 'magic' }), /queue-bad-action/);
  } finally {
    const stopped = await bridge.stop();
    assert.equal(stopped.code, 0);
  }
});

test('队列从日志重算：落盘后换个进程还在，且排队条目不进模型历史', async () => {
  const dir = freshDir();
  let bridge = await startBridge(dir);
  let enq;
  try {
    enq = await bridge.request('queue/enqueue', { text: '跨进程还要在', rpcId: 'rpc-4' });
    // append 只在实例内可见，flush 才跨进程——队列事件同样吃这条规则
    const flushed = await bridge.request('session/flush');
    assert.ok(flushed.durable > 0, '入列要能落盘');
  } finally {
    const stopped = await bridge.stop();
    assert.equal(stopped.code, 0);
    assert.equal(stopped.forced, false);
  }
  const log = readFileSync(join(dir, 'session.log'), 'utf8');
  assert.match(log, /agent\/inbox\/spliced/, '入列是会话日志里的一条事实');
  assert.ok(!/user\/message\t.*跨进程还要在/.test(log), '没到送达窗口之前，排队条目不能装作已经说过');
  bridge = await startBridge(dir);
  try {
    const view = await bridge.request('queue/describe');
    assert.deepEqual(view.nextTurn.map((r) => r.id), [enq.id], '重算只认日志，不认上一个进程的内存');
    assert.deepEqual(view.nextTurn.map((r) => r.text), ['跨进程还要在']);
    const projection = await bridge.request('session/projection');
    assert.ok(!projection.messages.some((m) => m.includes('跨进程还要在')), '投影里没有排队条目：它是 log-only');
  } finally {
    const stopped = await bridge.stop();
    assert.equal(stopped.code, 0);
  }
});

test('轮次边界送达恰好一条，作为独立的用户消息落盘', { timeout: 60000 }, async () => {
  const dir = freshDir();
  const fixture = await startSseFixture();
  const bridge = await startBridge(dir);
  try {
    await bridge.request('model/registry/update', {
      draft: {
        id: 'qgw', name: '排队夹具', baseUrl: `http://127.0.0.1:${fixture.port}/v1`, protocol: 'openai-completions',
        models: [{ id: 'qm', name: '排队模型', contextWindow: '128k', maxTokens: '4k', image: false }],
      },
      expectedRevision: 0,
    });
    const described = await bridge.request('model/registry/describe');
    await bridge.request('model/registry/set-default', { providerId: 'qgw', model: 'qm', expectedRevision: described.revision });
    await bridge.request('session/submit', { eventType: 'user/message', data: '第一句' });
    const one = await bridge.request('queue/enqueue', { text: '排队第二句', rpcId: 'rpc-5' });
    const two = await bridge.request('queue/enqueue', { text: '排队第三句', rpcId: 'rpc-6' });
    const started = await bridge.request('task/start', {});
    assert.equal(started.provider, 'real');
    // 一次轮次边界只消化一条：两条排队不会并成一句
    let view = await bridge.request('queue/describe');
    assert.deepEqual(view.nextTurn.map((r) => r.id), [two.id], '队首那条被摘走，后面的继续等');
    for (let i = 0; i < 200; i++) {
      const poll = await bridge.request('turn/poll');
      if (poll.settled) break;
      await nap(50);
    }
    const projection = await bridge.request('session/projection');
    assert.ok(projection.messages.includes('user/message: 排队第二句'), '送达要作为独立的 user/message 落进投影');
    assert.ok(!projection.messages.includes('user/message: 排队第三句'), '没轮到自己的那条不能提前算说过');
    view = await bridge.request('queue/describe');
    assert.equal(view.nextTurn.length, 1);
  } finally {
    stopSseFixture(fixture.proc);
    const stopped = await bridge.stop();
    assert.equal(stopped.code, 0);
    assert.equal(stopped.forced, false);
  }
});

// 夹具的 /tools 路由在 1.5 秒后才抛 todo_write，所以「排队 → 改成即时补充」确实发生在
// 轮次运行中：拼接由宿主协议线程写、摘取由 runner 线程写，两个线程第一次同时动同一份清单。
test('步边界把即时补充送进下一次模型请求', { timeout: 60000 }, async () => {
  const dir = freshDir();
  const fixture = await startSseFixture();
  const bridge = await startBridge(dir);
  try {
    await bridge.request('model/registry/update', {
      draft: {
        id: 'qgw', name: '步边界夹具', baseUrl: `http://127.0.0.1:${fixture.port}/tools`, protocol: 'openai-completions',
        models: [{ id: 'qm', name: '夹具模型', contextWindow: '128k', maxTokens: '4k', image: false }],
      },
      expectedRevision: 0,
    });
    const described = await bridge.request('model/registry/describe');
    await bridge.request('model/registry/set-default', { providerId: 'qgw', model: 'qm', expectedRevision: described.revision });
    await bridge.request('session/submit', { eventType: 'user/message', data: '开轮前那句' });
    const started = await bridge.request('task/start', {});
    assert.equal(started.provider, 'real');
    const enq = await bridge.request('queue/enqueue', { text: '运行中补充的一句', rpcId: 'rpc-step' });
    await bridge.request('queue/update', { itemId: enq.id, kind: 'steer', text: '' });
    let view = await bridge.request('queue/describe');
    assert.deepEqual(view.nextStep.map((r) => r.id), [enq.id], '补充条目已经排到 next-step 等着');
    assert.equal(view.nextTurn.length, 0);
    for (let i = 0; i < 400; i++) {
      const poll = await bridge.request('turn/poll');
      if (poll.settled) break;
      await nap(50);
    }
    const projection = await bridge.request('session/projection');
    assert.ok(projection.messages.includes('user/message: 运行中补充的一句'), '步边界要把补充的那句送成模型见过的用户消息');
    view = await bridge.request('queue/describe');
    assert.equal(view.nextStep.length, 0, '摘走之后两份清单都该空');
    assert.equal(view.nextTurn.length, 0);
    assert.equal(view.bad, 0, '两个线程写同一份清单，不该写出读不懂的拼接');
  } finally {
    stopSseFixture(fixture.proc);
    const stopped = await bridge.stop();
    assert.equal(stopped.code, 0);
  }
});

import { fixtureHostEnv } from '../test-support/fixture-env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join as jj, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { HostBridge } = require('../host-bridge.cjs');

// P0-3：资源身份绑定。
// Host 仍是单活动会话模型，但「单活动」不等于「谁问都给当前投影」：
//   - session/projection 必须按请求的 sessionId 精确读取，未知会话稳定拒绝；
//   - 活动会话类方法带错配 sessionId 时一步都不能执行（审计 S11 的根因）；
//   - 应答带 response sessionId，客户端能确认拿到的是自己请求的那一份。
// 这里不宣称多会话并发执行，也不实现每设备会话白名单。
const REPO = jj(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HOST = resolve(process.env.SACODE_HOST || jj(REPO, 'apps', 'desktop', 'dist', 'host', 'bin', 'sacode-host.exe'));
const SEED = "0\tturn/start\tt\n1\tsystem\tx\n2\tuser/message\tfrom desktop\n3\tassistant/message\thello desktop\n";

async function boot() {
  const root = jj(REPO, 'target', 'tmp', 'session-identity');
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(jj(root, 'ident-'));
  writeFileSync(jj(dir, 'session.log'), SEED);
  if (!existsSync(HOST)) {
    throw new Error(`需要真实宿主产物：${HOST} 不存在。先跑 node scripts/pack-host.mjs（记 BLOCKED，不是跳过）`);
  }
  const b = new HostBridge(HOST, fixtureHostEnv(dir));
  await b.start(dir);
  return { b, dir };
}

function currentId(catalog) {
  const current = Array.isArray(catalog.entries)
    ? catalog.entries.find((entry) => entry && entry.current === true)
    : null;
  assert.ok(current && typeof current.id === 'string' && current.id.length > 0, '宿主必须提供当前会话身份');
  return current.id;
}

test('session/projection 按 sessionId 精确读取：不串会话、未知会话拒绝、应答带身份', async () => {
  const { b } = await boot();
  try {
    const active = currentId(await b.request('session/catalog'));
    const made = await b.request('session/create', { title: '另一份会话' });
    assert.ok(made.id && made.id !== active, `新会话必须有独立身份：${JSON.stringify(made)}`);

    const activeView = await b.request('session/projection');
    assert.equal(activeView.sessionId, active, '不带 sessionId 时应答仍要标明实际读取的会话');
    assert.equal(activeView.events, 4);
    assert.ok(activeView.messageRows.some((row) => String(row.text || '').includes('from desktop')));

    // 非活动会话：只读它自己的日志（新会话只有一条标题事件），
    // 不能拿活动会话的 4 条事件和正文冒充。
    const otherView = await b.request('session/projection', { sessionId: made.id });
    assert.equal(otherView.sessionId, made.id);
    assert.equal(otherView.events, 1, `新会话只有标题事件：${JSON.stringify(otherView)}`);
    assert.deepEqual(otherView.messageRows, [], '非活动会话不得带出活动会话的正文');
    assert.equal(otherView.sessionId === active, false);

    // 未知会话不是「返回当前投影」，而是稳定的 -32602 unknown-session。
    await assert.rejects(
      () => b.request('session/projection', { sessionId: 'sessions/no-such-session' }),
      /unknown-session|-32602/,
      '不存在的会话必须被拒绝，不能拿活动会话顶替'
    );

    // 拒绝不改变真源：活动会话仍是 4 条事件。
    const after = await b.request('session/projection');
    assert.equal(after.events, 4);
  } finally {
    await b.stop();
  }
});

test('活动会话类方法带错配 sessionId 一律拒绝，且不产生副作用', async () => {
  const { b } = await boot();
  try {
    const active = currentId(await b.request('session/catalog'));
    const made = await b.request('session/create', { title: '错配目标' });
    const other = made.id;

    const mismatched = [
      ['session/append', { sessionId: other, eventType: 'user/message', data: '不该落盘' }],
      ['session/submit', { sessionId: other, eventType: 'user/message', data: '不该落盘' }],
      ['turn/start', { sessionId: other, limit: 1 }],
      ['task/start', { sessionId: other }],
      ['turn/poll', { sessionId: other, cursor: 0 }],
      ['turn/cancel', { sessionId: other }],
      ['approval/ask', { sessionId: other, name: 'write', args: '{}' }],
      ['approval/answer', { sessionId: other, approvalId: 0, decision: 'allowed-once' }],
    ];
    for (const [method, params] of mismatched) {
      await assert.rejects(
        () => b.request(method, params),
        /session-mismatch|-32001/,
        `${method} 带错配 sessionId 必须拒绝：${JSON.stringify(params)}`
      );
    }

    // 副作用为零：活动会话仍是 4 条事件，且没有因为错配的 turn/start 起轮。
    const after = await b.request('session/projection');
    assert.equal(after.events, 4, '错配请求不得写进活动会话');
    const poll = await b.request('turn/poll');
    assert.equal(poll.turn, false, '错配的 turn/start 不得真的起轮');
    assert.equal(poll.running, false);

    // 正例：sessionId 与当前活动会话一致时正常执行。
    const ok = await b.request('session/append', { sessionId: active, eventType: 'user/message', data: '一致时应可写' });
    assert.equal(ok.events, 5);
  } finally {
    await b.stop();
  }
});

test('切会话后写入口跟随新会话，旧会话投影保持独立', async () => {
  const { b } = await boot();
  try {
    const active = currentId(await b.request('session/catalog'));
    const made = await b.request('session/create', { title: '切换目标' });
    const other = made.id;
    // 活动会话就是目录索引日志时，切换会往里追加一条 workspace/session-selected；
    // 这是唯一允许增长的基线事件，正文不得跟着变。
    const oldBefore = await b.request('session/projection', { sessionId: active });

    const selected = await b.request('session/select', { sessionId: other });
    assert.equal(selected.selected, true, JSON.stringify(selected));
    assert.equal(selected.id, other);

    // 切过去之后，旧会话的 sessionId 变成错配目标。
    await assert.rejects(
      () => b.request('session/append', { sessionId: active, eventType: 'user/message', data: '写错会话' }),
      /session-mismatch|-32001/
    );
    const written = await b.request('session/append', { sessionId: other, eventType: 'user/message', data: '只属于新会话' });
    assert.equal(written.events, 2);

    const fresh = await b.request('session/projection', { sessionId: other });
    assert.equal(fresh.sessionId, other);
    assert.equal(fresh.events, 2);
    assert.ok(fresh.messageRows.some((row) => String(row.text || '').includes('只属于新会话')));

    // 旧会话的内容没被污染：只多了一条选择标记，没有新会话的正文。
    const old = await b.request('session/projection', { sessionId: active });
    assert.equal(old.sessionId, active);
    assert.equal(old.events, oldBefore.events + 1, '切换只该追加目录选择标记');
    assert.equal(old.messageRows.some((row) => String(row.text || '').includes('只属于新会话')), false);
  } finally {
    await b.stop();
  }
});

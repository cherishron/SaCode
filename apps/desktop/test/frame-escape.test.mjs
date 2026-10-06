// 宿主 → 桌面这一段是 NDJSON：正文里只要有一个引号或换行，未转义就会把整行协议帧撕裂，
// 桥侧 JSON.parse 失败后静默丢弃，调用方只能等到超时。这里用真实 HTTP/SSE 走通那一条边界。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { HostBridge } = createRequire(import.meta.url)('../host-bridge.cjs');

const HOST = process.env.SACODE_HOST || fileURLToPath(new URL('../dist/host/bin/sacode-host.exe', import.meta.url));

// 正文同时覆盖 引号 / 换行 / 反斜杠 / 制表 四类必须转义的字符
const TRICKY = '他说"引用"完了\n第二行带\\反斜杠\t和一个制表';

async function realTurn(t, content) {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const ev = (v) => res.write('data: ' + JSON.stringify(v) + '\n\n');
    ev({ choices: [{ index: 0, delta: { content } }] });
    ev({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 9 } });
    res.end('data: [DONE]\n\n');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const dir = mkdtempSync(join(tmpdir(), 'sacode-frame-escape-'));
  const bridge = new HostBridge(HOST, {
    ...process.env,
    SACODE_USER_SETTINGS_DIR: join(dir, 'settings'),
    SACODE_PROVIDER_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    SACODE_PROVIDER_MODEL: 'frame-fixture',
    SACODE_PROVIDER_KEY: 'fixture-only',
  });
  assert.ok(existsSync(HOST), '缺少自包含宿主');
  await bridge.start(dir);
  return bridge;
}

test('真实流式正文里的引号换行反斜杠整帧送达且不丢内容', { timeout: 20000 }, async (t) => {
  const bridge = await realTurn(t, TRICKY);
  try {
    await bridge.request('initialize');
    await bridge.request('session/submit', { eventType: 'user/message', data: '出一段带特殊字符的正文' });
    const start = await bridge.request('turn/start');
    assert.equal(start.provider, 'real');
    let result;
    const frames = [];
    for (let i = 0; i < 100; i++) {
      result = await bridge.request('turn/poll');
      frames.push(...result.frames);
      if (result.settled) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(result.settled, true, '轮询必须能收到结算帧，而不是等到超时');
    assert.ok(frames.includes(`text:${TRICKY}`), '正文帧必须逐字送达');
    assert.equal(result.text, TRICKY, '结算帧里的整段正文必须逐字送达');
    assert.equal(result.finishReason, 'stop');
    assert.equal(result.usage, '9');
  } finally {
    const stopped = await bridge.stop();
    assert.equal(stopped.code, 0);
  }
});

// 会话日志是唯一真源，外来写者可以在事件类型里留下引号和转义换行；
// 读侧若不解转义直接拼帧，这一行协议就会被撕成两行——注入的是协议本身。
test('订阅回放里带引号与换行的事件类型不撕裂协议帧', { timeout: 20000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sacode-subscribe-escape-'));
  writeFileSync(join(dir, 'session.log'), '0\tuser"r\\nmessage\t外来写者的正文\n1\tuser/message\t正常一行\n', 'utf8');
  const bridge = new HostBridge(HOST, { ...process.env, SACODE_USER_SETTINGS_DIR: join(dir, 'settings') });
  await bridge.start(dir);
  try {
    await bridge.request('initialize');
    const res = await bridge.request('session/subscribe', { cursor: 0, limit: 8 });
    assert.equal(res.events.length, 2, '两行事件都要作为两个对象送达');
    assert.equal(res.events[0].type, 'user"r\nmessage', '类型必须逐字归还，含解码出的换行');
    assert.equal(res.events[1].type, 'user/message');
  } finally {
    const stopped = await bridge.stop();
    assert.equal(stopped.code, 0);
  }
});

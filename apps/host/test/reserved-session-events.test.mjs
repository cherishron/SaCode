import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const { HostBridge } = createRequire(import.meta.url)('../../desktop/host-bridge.cjs');
const repoRoot = resolve(import.meta.dirname, '../../..');

test('真实 Host 两个通用写入口拒绝内部权限事件，保留普通会话事件', { timeout: 30000 }, async t => {
  const host = process.env.SACODE_HOST;
  assert.ok(host && existsSync(host), '须指定本轮构建的 SACODE_HOST');
  const base = join(repoRoot, 'target', 'tmp', 'reserved-session-events');
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, 'run-'));
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (['path', 'systemroot', 'windir'].includes(key.toLowerCase())) env[key] = value;
  }
  Object.assign(env, { TEMP: root, TMP: root, SACODE_USER_SETTINGS_DIR: join(root, 'settings') });
  const bridge = new HostBridge(resolve(host), env);
  t.after(() => bridge.stop(10000));
  await bridge.start(root);
  await bridge.request('initialize');
  const before = await bridge.request('session/projection');
  for (const method of ['session/append', 'session/submit']) {
    for (const eventType of ['mode/mode', 'plan/mode', 'plan/permission', 'permission/preset',
      'knowledge/context', 'knowledge/context/clear', 'knowledge/retrieval']) {
      await assert.rejects(bridge.request(method, { eventType, data: 'yolo' }), /reserved-session-event-type/);
    }
    // 检查与写入必须使用同一个结构化 params，不能混读顶层字段。
    const id = bridge.nextId++;
    const rejected = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('顶层字段探针超时')), 5000);
      bridge.pending.set(String(id), { timer, res: resolve, rej: reject });
    });
    bridge.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method,
      eventType: 'mode/mode', params: { eventType: 'user/message', data: '普通消息' } }) + '\n');
    await rejected;
  }
  const after = await bridge.request('session/projection');
  assert.equal(after.events, before.events + 2, '拒绝不得落盘，顶层伪造字段不得成为实际事件');
  for (const method of ['session/append', 'session/submit']) {
    for (const eventType of ['user/message', 'todo/write', 'session/title', 'turn/start', 'assistant/message']) {
      await bridge.request(method, { eventType, data: 'synthetic-event' });
    }
  }
  await bridge.request('session/flush');
  assert.equal((await bridge.request('session/projection')).events, before.events + 12);
  const persisted = readFileSync(join(root, 'session.log'), 'utf8');
  assert.doesNotMatch(persisted, /\t(?:mode\/mode|plan\/mode|plan\/permission|permission\/preset|knowledge\/context|knowledge\/retrieval)\t/);
});

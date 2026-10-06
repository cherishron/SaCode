import { fixtureHostEnv } from '../test-support/fixture-env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { HostBridge } = createRequire(import.meta.url)('../host-bridge.cjs');

// 真实仓颉宿主契约测试，独立目录避免影响其他测试和用户会话。
test('真实 Host 投影待办快照、重启回放与新轮次清空', async () => {
  const host = process.env.SACODE_HOST || fileURLToPath(new URL('../dist/host/bin/sacode-host.exe', import.meta.url));
  assert.ok(host && existsSync(host), '缺少真实宿主：请重建或通过 SACODE_HOST 指定');
  const directory = mkdtempSync(join(tmpdir(), 'sacode-todo-host-'));
  const items = [{ content: '甲|乙\n引号"路径\\', status: 'in_progress' }, { content: '完成', status: 'completed' }];
  async function start() {
    const bridge = new HostBridge(host, fixtureHostEnv(directory));
    await bridge.start(directory);
    await bridge.request('initialize');
    return bridge;
  }
  let bridge = await start();
  try {
    assert.equal((await bridge.request('session/projection')).todos, null);
    // 可信 Host 协议注入持久事件；这不代表模型 todo_write 工具已接入。
    await bridge.request('session/append', { eventType: 'todo/write', data: JSON.stringify({ todos: items }) });
    let projection = await bridge.request('session/projection');
    assert.deepEqual(projection.todos, items);
    assert.deepEqual(projection.messages, []);
    const stopped = await bridge.stop();
    assert.equal(stopped.code, 0);
    assert.equal(stopped.forced, false);
    bridge = await start();
    assert.deepEqual((await bridge.request('session/projection')).todos, items);
    await bridge.request('session/append', { eventType: 'turn/end', data: '' });
    assert.deepEqual((await bridge.request('session/projection')).todos, items);
    await bridge.request('session/append', { eventType: 'turn/start', data: '' });
    assert.equal((await bridge.request('session/projection')).todos, null);
    await bridge.request('session/append', { eventType: 'todo/write', data: '{"todos":[]}' });
    assert.deepEqual((await bridge.request('session/projection')).todos, []);
    await bridge.request('session/append', { eventType: 'todo/write', data: '{"todos":invalid}' });
    await assert.rejects(bridge.request('session/projection'), /todo-replay-rejected/);
    assert.equal((await bridge.request('initialize')).core, 'cangjie', '投影出错后宿主仍能响应');
  } finally {
    const stopped = await bridge.stop();
    assert.equal(stopped.code, 0);
    assert.equal(stopped.forced, false);
  }
});

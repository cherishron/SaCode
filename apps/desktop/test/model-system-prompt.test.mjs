// 本地 SSE 桩驱动 task/start：系统提示必须落日志并进模型请求体（缺口一的机制正证）。
// 桩按请求序断言：第一次请求的 messages 里必须有 role=system，正文以角色定义开头
// 并列出全部三个工具；tools 必须是 todo_write/read/write 三个（缺口二同源证据）。
// 反证：把宿主里那条 system/message 注入关掉，本用例在桩断言处直接转红。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { HostBridge } = createRequire(import.meta.url)('../host-bridge.cjs');

test('task/start 把系统提示落日志并带进模型请求体', { timeout: 30000 }, async t => {
  const host = process.env.SACODE_HOST || fileURLToPath(new URL('../dist/host/bin/sacode-host.exe', import.meta.url));
  assert.ok(existsSync(host), '缺少本轮真实宿主');
  const requests = [], failures = [];
  const server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const bytes of req) raw += bytes;
      const body = JSON.parse(raw); requests.push(body);
      assert.equal(req.url, '/chat/completions');
      // 缺口一：请求体必须带系统提示，且内容只能来自日志里那条 system/message
      const system = body.messages.find(m => m.role === 'system');
      assert.ok(system, '请求体必须包含 system 消息');
      assert.ok(system.content.startsWith('you are SaCode'), '系统提示首行必须是角色定义');
      for (const name of ['todo_write', 'read', 'write']) {
        assert.ok(system.content.includes(`${name}:`), `系统提示必须列出工具 ${name}`);
      }
      // 缺口二：请求里的 tools 与执行器同源，三个都要在
      assert.deepEqual(body.tools.map(x => x.function.name), ['todo_write', 'read', 'write']);
      assert.equal(requests.length, 1, '本用例只发一次请求');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const event = value => res.write('data: ' + JSON.stringify(value) + '\n\n');
      event({ choices: [{ index: 0, delta: { content: '收到系统提示。' } }] });
      event({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 5 } });
      res.end('data: [DONE]\n\n');
    } catch (error) { failures.push(error.message); res.destroy(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const directory = mkdtempSync(join(tmpdir(), 'sacode-sysprompt-'));
  const env = { ...process.env, SACODE_USER_SETTINGS_DIR: join(directory, 'settings'),
    SACODE_PROVIDER_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    SACODE_PROVIDER_MODEL: 'sysprompt-fixture', SACODE_PROVIDER_KEY: 'fixture-only' };
  const bridge = new HostBridge(host, env);
  await bridge.start(directory);
  try {
    await bridge.request('initialize');
    await bridge.request('session/submit', { eventType: 'user/message', data: '打招呼' });
    const start = await bridge.request('task/start'); assert.equal(start.provider, 'real');
    let result;
    for (let i = 0; i < 300; i++) {
      result = await bridge.request('turn/poll');
      if (result.settled) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.deepEqual(failures, []);
    assert.equal(result.settled, true); assert.equal(result.interrupted, false);
    assert.equal(result.finishReason, 'stop'); assert.equal(result.text, '收到系统提示。');
    // 落盘的那条必须能在冷进程里重建（Model-visible means logged）
    const log = readFileSync(join(directory, 'session.log'), 'utf8');
    assert.ok(log.includes('system/message'), '系统提示必须落会话日志');
    assert.ok(log.includes('you are SaCode'), '日志里是 SystemPromptBuilder 的原文');
  } finally {
    const stopped = await bridge.stop(); assert.equal(stopped.code, 0); assert.equal(stopped.forced, false);
  }
  const cold = new HostBridge(host, env);
  await cold.start(directory);
  try {
    const projection = await cold.request('session/projection');
    assert.ok(projection.messages.some(line => line.startsWith('system/message: you are SaCode')),
      '冷进程仅靠日志重建出系统提示');
  } finally {
    const stopped = await cold.stop(); assert.equal(stopped.code, 0); assert.equal(stopped.forced, false);
  }
});

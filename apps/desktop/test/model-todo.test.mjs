import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { HostBridge } = createRequire(import.meta.url)('../host-bridge.cjs');

// 真实 HTTP/SSE -> 仓颉循环 -> Todo 工具 -> 关联工具结果 -> 第二次模型请求。
test('真实 Host 执行 SSE Todo 调用并携带关联结果继续请求', { timeout: 30000 }, async t => {
  const host = process.env.DSH_HOST || fileURLToPath(new URL('../dist/host/bin/dsh-host.exe', import.meta.url));
  assert.ok(existsSync(host), '缺少本轮真实宿主');
  const requests = [], failures = [];
  const args = JSON.stringify({ todos: [{ content: '  真实工具任务  ', status: 'in_progress' }] });
  const server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const bytes of req) raw += bytes;
      const body = JSON.parse(raw); requests.push(body);
      assert.equal(req.url, '/chat/completions');
      assert.equal(body.tools[0].function.name, 'todo_write');
      assert.equal(body.messages[0].content, '请规划任务');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const event = value => res.write('data: ' + JSON.stringify(value) + '\n\n');
      if (requests.length === 1) {
        event({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-real-todo', function: { name: 'todo_', arguments: args.slice(0, 13) } }] } }] });
        event({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: 'write', arguments: args.slice(13) } }] } }] });
        event({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { total_tokens: 3 } });
      } else {
        assert.equal(requests.length, 2, '不可重复请求或无限循环');
        const assistant = body.messages[1], tool = body.messages[2];
        assert.equal(assistant.role, 'assistant');
        assert.equal(assistant.tool_calls[0].id, 'call-real-todo');
        assert.equal(assistant.tool_calls[0].function.arguments, args);
        assert.equal(tool.role, 'tool'); assert.equal(tool.tool_call_id, 'call-real-todo');
        const result = JSON.parse(tool.content);
        assert.deepEqual(result.todos, [{ content: '真实工具任务', status: 'in_progress' }]);
        assert.deepEqual(result.counts, { pending: 0, inProgress: 1, completed: 0 });
        event({ choices: [{ index: 0, delta: { content: '计划已建立。' } }] });
        event({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 4 } });
      }
      res.end('data: [DONE]\n\n');
    } catch (error) { failures.push(error.message); res.destroy(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const directory = mkdtempSync(join(tmpdir(), 'sacode-model-todo-'));
  const bridge = new HostBridge(host, { ...process.env, SACODE_USER_SETTINGS_DIR: join(directory, 'settings'), DSH_PROVIDER_BASE_URL: `http://127.0.0.1:${server.address().port}`, DSH_PROVIDER_MODEL: 'todo-fixture', DSH_PROVIDER_KEY: 'fixture-only' });
  await bridge.start(directory);
  try {
    await bridge.request('initialize');
    await bridge.request('session/submit', { eventType: 'user/message', data: '请规划任务' });
    const start = await bridge.request('turn/start'); assert.equal(start.provider, 'real');
    let result; const frames = [];
    for (let i = 0; i < 300; i++) {
      result = await bridge.request('turn/poll'); frames.push(...result.frames);
      if (result.settled) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.deepEqual(failures, []);
    assert.equal(result.settled, true); assert.equal(result.interrupted, false);
    assert.equal(result.finishReason, 'stop'); assert.equal(result.text, '计划已建立。');
    assert.equal(result.used, 7); assert.equal(requests.length, 2);
    assert.ok(frames.includes('projection:todos'), '执行过程中必须通知桌面刷新投影');
    const projection = await bridge.request('session/projection');
    assert.deepEqual(projection.todos, [{ content: '真实工具任务', status: 'in_progress' }]);
    assert.ok(projection.messages.includes('assistant/message: 计划已建立。'));
    assert.ok(projection.messages.every(line => !line.includes('SaCodeModel/1:')), '协议封装不泄入气泡正文');
  } finally {
    const stopped = await bridge.stop(); assert.equal(stopped.code, 0); assert.equal(stopped.forced, false);
  }
});

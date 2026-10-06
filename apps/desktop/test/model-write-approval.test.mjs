// 本地 SSE 桩驱动模型侧 write：审批工单必须由宿主主动推送（无 id 通知帧，
// source=model），人应答 allowed-once 后才落盘；denied 必须 fail-closed 不写盘。
// 这条同时钉住缺口二的另一半：真实模型回合里 read/write 与 todo_write 同一个
// ModelToolRuntime，模型调得动、审批走得通、结果带得回。
// 反证：不传 toolRuntime（回到 files=false 默认分支）时，write 根本不在请求里，
// 模型发不出调用，本用例等不到审批工单直接转红。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { HostBridge } = createRequire(import.meta.url)('../host-bridge.cjs');

const TARGET = 'model-write-approval-demo.txt';
const CONTENT = '审批通过后写入的正文';
const WRITE_ARGS = JSON.stringify({ path: TARGET, content: CONTENT });

async function runWriteApprovalCase(decision, expectedWritten) {
  const host = process.env.SACODE_HOST || fileURLToPath(new URL('../dist/host/bin/sacode-host.exe', import.meta.url));
  assert.ok(existsSync(host), '缺少本轮真实宿主');
  const requests = [], failures = [];
  const server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const bytes of req) raw += bytes;
      const body = JSON.parse(raw); requests.push(body);
      assert.equal(req.url, '/chat/completions');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const event = value => res.write('data: ' + JSON.stringify(value) + '\n\n');
      if (requests.length === 1) {
        // 请求里必须看得到 write：修复前 tools 只有 todo_write，模型无从调起
        assert.deepEqual(body.tools.map(x => x.function.name), ['todo_write', 'read', 'write']);
        event({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-write-1',
          function: { name: 'write', arguments: WRITE_ARGS } }] } }] });
        event({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { total_tokens: 3 } });
      } else {
        assert.equal(requests.length, 2, '不可重复请求或无限循环');
        const tool = body.messages.filter(m => m.role === 'tool').pop();
        assert.equal(tool.tool_call_id, 'call-write-1');
        if (expectedWritten) {
          assert.equal(tool.content, `ok:${TARGET}`, '放行后工具结果必须是写入成功');
        } else {
          const result = JSON.parse(tool.content);
          assert.ok(result.error && result.error.includes('approval-not-granted'),
            '拒绝后必须把拒绝原因带给模型，不能静默成功');
        }
        event({ choices: [{ index: 0, delta: { content: '写接口已处理。' } }] });
        event({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 4 } });
      }
      res.end('data: [DONE]\n\n');
    } catch (error) { failures.push(error.message); res.destroy(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  // 无论成败都必须收站：泄漏的 HTTP 服务器会让 node 进程永不退出
  try {
    const directory = mkdtempSync(join(tmpdir(), 'sacode-model-write-'));
    const env = { ...process.env, SACODE_USER_SETTINGS_DIR: join(directory, 'settings'),
      SACODE_PROVIDER_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      SACODE_PROVIDER_MODEL: 'write-fixture', SACODE_PROVIDER_KEY: 'fixture-only' };
    const bridge = new HostBridge(host, env);
    await bridge.start(directory);
    try {
      await bridge.request('initialize');
      await bridge.request('session/submit', { eventType: 'user/message', data: '请写入文件' });
      const start = await bridge.request('task/start'); assert.equal(start.provider, 'real');
      let result; let answered = false;
      for (let i = 0; i < 900; i++) {
        result = await bridge.request('turn/poll');
        if (!answered) {
          // 宿主主动推送的模型侧审批工单：无 id 通知帧，参数带工单号与来源
          const note = bridge.notifications.find(n => n.method === 'approval/asked'
            && n.params && n.params.source === 'model');
          if (note) {
            assert.equal(note.params.tool, 'write');
            assert.ok(note.params.approvalId > 0, '工单号必须由宿主发号');
            await bridge.request('approval/answer', { approvalId: note.params.approvalId, decision });
            answered = true;
          }
        }
        if (result.settled) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.deepEqual(failures, []);
      assert.ok(answered, '模型发起 write 必须收到宿主主动推送的审批工单');
      assert.equal(result.settled, true); assert.equal(result.interrupted, false);
      assert.equal(result.finishReason, 'stop'); assert.equal(result.text, '写接口已处理。');
      const target = join(directory, TARGET);
      if (expectedWritten) {
        assert.ok(existsSync(target), '放行后文件必须落盘');
        assert.equal(readFileSync(target, 'utf8'), CONTENT);
      } else {
        assert.ok(!existsSync(target), '拒绝后不得写盘');
      }
      const log = readFileSync(join(directory, 'session.log'), 'utf8');
      assert.ok(/approval\/asked\t\d+:write/.test(log), '工单发号必须进日志');
      assert.ok(new RegExp(`approval\/decided\t\\d+:${decision}`).test(log), '决答必须进日志');
      assert.ok(log.includes(`ok:${TARGET}`) === expectedWritten, '工具结果必须与放行结论一致');
    } finally {
      const stopped = await bridge.stop(); assert.equal(stopped.code, 0); assert.equal(stopped.forced, false);
    }
  } finally {
    try { server.closeAllConnections(); server.close(); } catch {}
  }
}

test('模型发起 write：审批浮层推给调用方，放行后落盘且结果续答', { timeout: 60000 }, async () => {
  await runWriteApprovalCase('allowed-once', true);
});

test('模型发起 write：拒绝后 fail-closed 不写盘，拒绝原因续答给模型', { timeout: 60000 }, async () => {
  await runWriteApprovalCase('denied', false);
});

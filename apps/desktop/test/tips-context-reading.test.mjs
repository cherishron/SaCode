// 上下文容量与当前用量的真实链路：发现接口给的容量落进注册表，回合结算的 usage 落进提醒面。
// 只用回环合成服务与一次性用户设置目录，不读真实注册表与凭据。
import { fixtureHostEnv } from '../test-support/fixture-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
const { HostBridge } = createRequire(import.meta.url)('../host-bridge.cjs');

const WINDOW = 1048576;

async function waitFor(fn, label) {
  for (let i = 0; i < 200; i++) { const hit = await fn(); if (hit) return hit; await sleep(20); }
  assert.fail(label);
}

test('发现接口报的上下文容量落到注册表，结算后的真实用量能换算占用比例', { timeout: 30000 }, async () => {
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [
        { id: 'fixture-model', object: 'model', context_window: WINDOW, max_output_tokens: 262144 },
        { id: 'no-window-model', object: 'model' },
      ] }));
      return;
    }
    let body = ''; for await (const part of req) body += part;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: '合成回复' } }] }) + '\n\n' +
      'data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 5 } }) + '\n\n' +
      'data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const dir = mkdtempSync(join(tmpdir(), 'sacode-tips-context-'));
  const exe = process.env.SACODE_HOST || fileURLToPath(new URL('../dist/host/bin/sacode-host.exe', import.meta.url));
  const bridge = new HostBridge(exe, fixtureHostEnv(dir));
  try {
    await bridge.start(dir);
    const saved = await bridge.request('model/registry/update', {
      draft: {
        id: 'fixture', name: '合成供应商', baseUrl: `http://127.0.0.1:${server.address().port}`,
        protocol: 'openai-completions',
        models: [{ id: 'fixture-model', name: 'fixture-model', contextWindow: '', maxTokens: '', image: false }],
      },
      expectedRevision: 0,
    });
    await bridge.request('model/registry/save-credential', { providerId: 'fixture', expectedRevision: saved.revision, key: 'fixture-only' });

    // 拉取通道必须把上游报的容量一起落盘，而不是只留 id。
    const pulled = await bridge.request('model/pull', { providerId: 'fixture', expectedRevision: saved.revision, operationId: 'capacity' });
    const settled = await waitFor(async () => {
      const view = await bridge.request('model/pull/describe', { operationId: 'capacity' });
      return view.settled ? view : false;
    }, '模型发现线程未收束');
    assert.equal(settled.status, 'succeeded');
    const described = await bridge.request('model/registry/describe');
    const provider = described.providers.find(p => p.id === 'fixture');
    assert.equal(provider.models.find(m => m.id === 'fixture-model').contextWindow, String(WINDOW));
    assert.equal(provider.models.find(m => m.id === 'no-window-model').contextWindow, '', '上游没报容量就留空，不猜');

    await bridge.request('model/registry/set-default', { providerId: 'fixture', model: 'fixture-model', expectedRevision: pulled.revision });

    // 只有容量、还没有回合读数：窗口可用，分子必须如实报未知。
    const before = await bridge.request('tips/get', { accessibility: false });
    assert.equal(before.window, WINDOW);
    assert.equal(before.used, -1);
    assert.equal(before.reliable, false);

    await bridge.request('session/append', { eventType: 'user/message', data: '合成任务' });
    await bridge.request('turn/start', { limit: 5 });
    await waitFor(async () => (await bridge.request('turn/poll')).settled, '回合未结算');

    const reading = await bridge.request('tips/get', { accessibility: false });
    assert.equal(reading.window, WINDOW);
    assert.equal(reading.used, 5, '上游 usage 是唯一用量来源');
    assert.equal(reading.reliable, true);
    assert.equal(reading.percent, 0);

    // 新消息让旧采样作废：窗口还在，用量回到未知，绝不拿旧数凑比例。
    await bridge.request('session/append', { eventType: 'user/message', data: '下一条任务' });
    const stale = await bridge.request('tips/get', { accessibility: false });
    assert.equal(stale.window, WINDOW);
    assert.equal(stale.used, -1);
    assert.equal(stale.reliable, false);
  } finally {
    await bridge.stop().catch(() => {});
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

// 当前Host模型中心的本地合成验证：不读取真实凭据，不调用外网。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
const { HostBridge } = createRequire(import.meta.url)('../../../desktop/host-bridge.cjs');
const root = resolve(import.meta.dirname, '../../../..');
const pause = ms => new Promise(r => setTimeout(r, ms));
async function withFixture(run, status = 200, mode = '') {
  assert.ok(process.env.SACODE_HOST, '必须显式指定本轮新构建的SACODE_HOST');
  const requests = [];
  const credentialLabels = [];
  const heldResponses = [];
  let streamDisconnects = 0;
  let holdEnabled = mode === 'hold';
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const body = JSON.parse(raw); requests.push(body);
    const auth = req.headers.authorization;
    // 只保留合成凭据归属标签，不把认证头写到日志或断言失败信息。
    credentialLabels.push(auth === 'Bearer invalid-local-fixture-only' ? 'first' :
      auth === 'Bearer invalid-local-fixture-second' ? 'second' : 'unexpected');
    assert.equal(req.url, '/v1/chat/completions');
    if (status !== 200) { res.writeHead(status); res.end('{}'); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (holdEnabled) {
      heldResponses.push(res);
      res.once('close', () => { streamDisconnects += 1; });
      res.flushHeaders();
      res.write('data: '+JSON.stringify({ choices: [{ index: 0, delta: { content: '等待取消' } }] })+'\n\n');
      return;
    }
    if (mode === 'edit' && requests.length <= 2) {
      const first = requests.length === 1;
      const call = { index: 0, id: first ? 'read-code' : 'edit-code', type: 'function', function: {
        name: first ? 'read' : 'edit', arguments: JSON.stringify(first ? { path: 'sum.cjs' } : { path: 'sum.cjs', old_string: 'a - b', new_string: 'a + b' }),
      } };
      res.end('data: '+JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [call] }, finish_reason: 'tool_calls' }] })+'\n\ndata: [DONE]\n\n'); return;
    }
    if (mode === 'tools' && requests.length === 1) {
      const chunks = [
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'synthetic-call', type: 'function', function: { name: 'todo_write', arguments: '{"tod' } }] } }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'os":[]}' } }] }, finish_reason: 'tool_calls' }] },
      ];
      for (const c of chunks) { res.write(`data: ${JSON.stringify(c)}\n\n`); await pause(10); }
      res.end('data: [DONE]\n\n'); return;
    }
    for (const chunk of [
      { choices: [{ index: 0, delta: { content: '本地' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { content: '验证' }, finish_reason: 'stop' }] },
    ]) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = join(root, 'target/tmp/host-model-verification');
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'run-')); const settings = join(dir, 'settings'); mkdirSync(settings);
  // 白名单环境：不把当前会话真实提供方配置传入子进程。
  const env = {};
  for (const [k,v] of Object.entries(process.env)) {
    if (['path','systemroot','windir','temp','tmp'].includes(k.toLowerCase())) env[k] = v;
  }
  env.SACODE_USER_SETTINGS_DIR = settings;
  const b = new HostBridge(resolve(process.env.SACODE_HOST), env);
  try {
    await b.start(dir);
    const url = `http://127.0.0.1:${server.address().port}/v1`;
    await b.request('model/registry/update', { draft: { id: 'local', name: '本地合成', baseUrl: url, protocol: 'openai-completions', models: [
      { id: 'synthetic', name: '合成模型', contextWindow: '', maxTokens: '', image: false,
        availability: 'available', outputModalities: ['text'], supports: ['stream', 'tools'] },
    ] }, expectedRevision: 0 });
    const view = await b.request('model/registry/describe');
    await b.request('credential/set', { ref: view.providers[0].credentialRef, value: 'invalid-local-fixture-only' });
    await b.request('custom/upsert', { draft: { id: 'test', name: '本地测试', description: '', enabled: true, category: 'coding', requires: ['text-output'], mode: 'round-robin', bindings: [] }, expectedRevision: 0 });
    await b.request('binding/upsert', { customId: 'test', binding: { providerId: 'local', modelId: 'synthetic', enabled: true, order: 0, weight: 1, priceInMicro: -1, priceOutMicro: -1, priceCacheReadMicro: -1, priceCacheWriteMicro: -1, priceVersion: 1, currency: 'CNY' }, expectedRevision: 1 });
    await run(b, requests, { credentialLabels, url, dir, setHold: value => { holdEnabled = value; }, streamDisconnects: () => streamDisconnects, releaseStream: () => {
      for (const res of heldResponses) res.end();
    } });
  } finally {
    await b.stop();
    await new Promise(r => { server.closeAllConnections(); server.close(r); });
    // dir仅来自上述已固定临时根的mkdtemp；不触及设置或其他会话目录。
    assert.equal(resolve(dir, '..'), resolve(base));
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}
async function poll(b) {
  for (let i = 0; i < 250; i++) { const r = await b.request('turn/poll'); if (r.settled) return r; await pause(20); }
  throw Error('本地模型回合未在期限内结算');
}
test('Host模型中心：本地SSE经真实发送与解析完成', { timeout: 20000 }, async () => {
  await withFixture(async (b, requests) => {
    await b.request('session/submit', { eventType: 'user/message', data: '合成验证' });
    await b.request('task/start', { customModelId: 'test' });
    const r = await poll(b);
    assert.equal(r.interrupted, false); assert.equal(r.text, '本地验证');
    assert.equal(requests.length, 1); assert.equal(requests[0].model, 'synthetic');
    assert.equal(requests[0].stream, true); assert.ok(requests[0].tools.length > 0);
  });
});
test('Host模型中心：无效绑定不退回其他配置、不发送请求', { timeout: 20000 }, async () => {
  await withFixture(async (b, requests) => {
    await assert.rejects(b.request('task/start', { customModelId: 'missing' }), /custom-model-not-found/);
    assert.equal(requests.length, 0);
  });
});
test('Host模型中心：HTTP500结算为中断且本次不自动重发', { timeout: 20000 }, async () => {
  await withFixture(async (b, requests) => {
    await b.request('task/start', { customModelId: 'test' });
    assert.equal((await poll(b)).interrupted, true); assert.equal(requests.length, 1);
    assert.equal((await b.request('ledger/stats')).pendingReservations.length, 0);
  }, 500);
});
test('Host模型中心：工具参数分片合并、关联结果并续跑', { timeout: 20000 }, async () => {
  await withFixture(async (b, requests) => {
    await b.request('task/start', { customModelId: 'test' });
    assert.equal((await poll(b)).interrupted, false);
    assert.equal(requests.length, 2);
    const messages = requests[1].messages;
    const assistant = messages.find(m => m.tool_calls?.some(c => c.id === 'synthetic-call'));
    assert.ok(assistant); assert.equal(assistant.tool_calls[0].function.arguments, '{"todos":[]}');
    assert.equal(messages.filter(m => m.role === 'tool' && m.tool_call_id === 'synthetic-call').length, 1);
  }, 200, 'tools');
});
test('Host模型中心：活跃流取消有界结算且释放预留', { timeout: 20000 }, async () => {
  await withFixture(async (b, requests) => {
    await b.request('task/start', { customModelId: 'test' });
    for (let i = 0; i < 100 && requests.length === 0; i++) await pause(20);
    assert.equal(requests.length, 1);
    // 等已发文本进入消费后再取消，避免只覆盖读取开始前的取消快路径。
    let observed = false;
    for (let i = 0; i < 100; i++) {
      const state = await b.request('turn/poll');
      if (state.frames.some(frame => frame.includes('等待取消'))) { observed = true; break; }
      await pause(20);
    }
    assert.equal(observed, true, '取消前须确认Host已消费首个文本帧');
    await pause(200);
    const started = Date.now(); await b.request('turn/cancel');
    const result = await poll(b);
    assert.equal(result.cancelled, true); assert.ok(Date.now() - started < 6000);
    assert.equal((await b.request('ledger/stats')).pendingReservations.length, 0);
  }, 200, 'hold');
});
test('Host模型中心：静默取消由客户端断连且不遗留工具或预留', { timeout: 20000 }, async () => {
  await withFixture(async (b, requests, ctx) => {
    await b.request('task/start', { customModelId: 'test' });
    let observed = false;
    for (let i = 0; i < 100; i++) {
      const state = await b.request('turn/poll');
      if (state.frames.some(f => f.includes('等待取消'))) { observed = true; break; }
      await pause(20);
    }
    assert.ok(observed); await pause(200);
    const ack = await b.request('turn/cancel');
    assert.equal(ack.cancelRequested, true);
    // 不调用releaseStream：必须由取消路径主动解除本地静默连接。
    const result = await poll(b);
    assert.equal(result.cancelled, true);
    assert.equal(result.pendingToolCalls, 0);
    for (let i = 0; i < 100 && ctx.streamDisconnects() === 0; i++) await pause(20);
    assert.equal(ctx.streamDisconnects(), 1, '取消结算后服务端必须观察到客户端断连');
    const stats = await b.request('ledger/stats');
    assert.equal(stats.pendingReservations.length, 0);
    // 上游已收到请求而usage未知，保留待核算事实，不能伪报费用为零。
    assert.equal(stats.unsettledAttempts.length, 1);
    const ledgerText = readFileSync(join(ctx.dir, 'settings/usage-ledger.log'), 'utf8');
    assert.ok(ledgerText.includes('attempt/failed'));
    assert.ok(ledgerText.includes('cancelled'));
    await b.stop(); await b.start(ctx.dir);
    const restored = await b.request('ledger/stats');
    assert.deepEqual(restored.unsettledAttempts, stats.unsettledAttempts);
    assert.equal(restored.pendingReservations.length, 0);
    await pause(100);
    assert.equal(requests.length, 1, '恢复不得自动重放已派发的取消请求');
  }, 200, 'hold');
});
test('Host模型中心：重复静默取消后可正常续跑且取消不污染新连接', { timeout: 20000 }, async () => {
  await withFixture(async (b, requests, ctx) => {
    for (let round = 0; round < 3; round++) {
      ctx.setHold(true);
      await b.request('task/start', { customModelId: 'test' });
      let observed = false;
      for (let i = 0; i < 100; i++) {
        const state = await b.request('turn/poll');
        if (state.frames.some(f => f.includes('等待取消'))) { observed = true; break; }
        await pause(20);
      }
      assert.ok(observed); await pause(100);
      const started = Date.now();
      await b.request('turn/cancel');
      const cancelled = await poll(b);
      assert.equal(cancelled.cancelled, true);
      assert.equal(cancelled.pendingToolCalls, 0);
      assert.ok(Date.now() - started < 3000, '每次取消须独立有界');
      for (let i = 0; i < 100 && ctx.streamDisconnects() < round + 1; i++) await pause(20);
      assert.equal(ctx.streamDisconnects(), round + 1);
      ctx.setHold(false);
      await b.request('task/start', { customModelId: 'test' });
      const normal = await poll(b);
      assert.equal(normal.cancelled, false);
      assert.equal(normal.interrupted, false);
      assert.equal(normal.text, '本地验证');
      assert.equal((await b.request('ledger/stats')).pendingReservations.length, 0);
    }
    assert.equal(requests.length, 6, '取消不自动重发，新请求各只发送一次');
  }, 200, 'hold');
});
test('Host模型中心：三次HTTP500后冷却阻止第四次派发', { timeout: 20000 }, async () => {
  await withFixture(async (b, requests) => {
    for (let i = 0; i < 3; i++) {
      await b.request('task/start', { customModelId: 'test' });
      assert.equal((await poll(b)).interrupted, true);
    }
    await assert.rejects(b.request('task/start', { customModelId: 'test' }), /route-cooling/);
    assert.equal(requests.length, 3);
  }, 500);
});
test('Host模型中心：同地址多实例独立凭据且工具步骤重新选路', { timeout: 20000 }, async () => {
  await withFixture(async (b, requests, ctx) => {
    const before = await b.request('model/registry/describe');
    await b.request('model/registry/update', { draft: { id: 'second', name: '第二实例', baseUrl: ctx.url, protocol: 'openai-completions', models: [
      { id: 'synthetic', name: '同名模型', contextWindow: '', maxTokens: '', image: false, availability: 'available', outputModalities: ['text'], supports: ['stream','tools'] },
    ] }, expectedRevision: before.revision });
    const view = await b.request('model/registry/describe');
    const refs = view.providers.map(p => p.credentialRef);
    assert.equal(new Set(refs).size, 2);
    await b.request('credential/set', { ref: view.providers.find(p => p.id === 'second').credentialRef, value: 'invalid-local-fixture-second' });
    await b.request('binding/upsert', { customId: 'test', binding: { providerId: 'second', modelId: 'synthetic', enabled: true, order: 1, weight: 1, priceInMicro: -1, priceOutMicro: -1, priceCacheReadMicro: -1, priceCacheWriteMicro: -1, priceVersion: 1, currency: 'CNY' }, expectedRevision: 2 });
    await b.request('task/start', { customModelId: 'test' });
    assert.equal((await poll(b)).interrupted, false);
    assert.equal(requests.length, 2);
    assert.deepEqual(ctx.credentialLabels, ['first', 'second']);
  }, 200, 'tools');
});
test('Host模型中心：显式零金额预算在派发前拒绝', { timeout: 20000 }, async () => {
  await withFixture(async (b, requests) => {
    const customs = await b.request('custom/describe');
    const existing = customs.models.find(m => m.id === 'test');
    assert.equal(existing.bindings.length, 1);
    await b.request('custom/upsert', { draft: { ...existing, dailyAmountMicro: 0 }, expectedRevision: customs.revision });
    await assert.rejects(b.request('task/start', { customModelId: 'test' }), /budget-exhausted/);
    assert.equal(requests.length, 0);
  });
});
for (const [label, change, expected] of [
  ['未声明工具能力', p => ({ ...p, models: p.models.map(m => ({ ...m, supports: ['stream'] })) }), /capability-unsatisfied/],
  ['登记但不支持的协议', p => ({ ...p, protocol: 'anthropic-messages' }), /protocol-not-supported/],
]) {
  test(`Host模型中心：${label}在发送前拒绝`, { timeout: 20000 }, async () => {
    await withFixture(async (b, requests) => {
      const view = await b.request('model/registry/describe');
      await b.request('model/registry/update', { draft: change(view.providers[0]), expectedRevision: view.revision });
      await assert.rejects(b.request('task/start', { customModelId: 'test' }), expected);
      assert.equal(requests.length, 0);
    });
  });
}
test('Host模型中心：缺凭据不发送请求', { timeout: 20000 }, async () => {
  await withFixture(async (b, requests) => {
    const view = await b.request('model/registry/describe');
    await b.request('credential/unset', { ref: view.providers[0].credentialRef });
    await assert.rejects(b.request('task/start', { customModelId: 'test' }), /credential-unconfigured/);
    assert.equal(requests.length, 0);
  });
});
test('隔离代码闭环：模型read与审批edit、驱动实际测试、冷启动不重发', { timeout: 25000 }, async () => {
  await withFixture(async (b, requests, ctx) => {
    writeFileSync(join(ctx.dir, 'sum.cjs'), 'module.exports = (a, b) => a - b;\n');
    writeFileSync(join(ctx.dir, 'sum.test.cjs'), "const {test}=require('node:test');const assert=require('node:assert/strict');test('加法',()=>assert.equal(require('./sum.cjs')(2,3),5));\n");
    await b.request('workspace/set-directory', { directory: ctx.dir });
    await b.request('session/submit', { eventType: 'user/message', data: '读取并修正sum.cjs的加法错误' });
    await b.request('task/start', { customModelId: 'test' });
    let ticket;
    for (let i = 0; i < 200 && !ticket; i++) {
      ticket = b.notifications.find(n => n.method === 'approval/asked' && n.params.tool === 'edit');
      if (!ticket) await pause(20);
    }
    assert.ok(ticket, '编辑必须请求一次性审批；已见工具='+JSON.stringify(b.notifications.filter(n => n.method === 'approval/asked').map(n => n.params.tool))+'；请求数='+requests.length+'；工具结果='+JSON.stringify(requests.flatMap(r => r.messages.filter(m => m.role === 'tool'))));
    assert.equal(ticket.params.argumentsJson, JSON.stringify({ path: 'sum.cjs', old_string: 'a - b', new_string: 'a + b' }));
    assert.equal((await b.request('approval/answer', { approvalId: ticket.params.approvalId, decision: 'allowed-once' })).accepted, true);
    const result = await poll(b); assert.equal(result.interrupted, false);
    assert.equal(readFileSync(join(ctx.dir, 'sum.cjs'), 'utf8'), 'module.exports = (a, b) => a + b;\n');
    assert.equal(requests.length, 3);
    const testEnv = {};
    for (const [k,v] of Object.entries(process.env)) {
      if (['path','systemroot','windir','temp','tmp'].includes(k.toLowerCase())) testEnv[k] = v;
    }
    for (const args of [['--check','sum.cjs'], ['--test','sum.test.cjs']]) {
      const check = spawnSync(process.execPath, args, { cwd: ctx.dir, env: testEnv, stdio: 'inherit', timeout: 5000 });
      assert.equal(check.status, 0, '测试驱动的实际语法/单测命令必须通过');
    }
    const log = readFileSync(join(ctx.dir, 'session.log'), 'utf8');
    assert.ok(log.includes('edit-code')); assert.ok(log.includes('read-code'));
    await b.stop(); await b.start(ctx.dir);
    assert.ok((await b.request('session/projection')).messages.length > 0);
    await pause(50); assert.equal(requests.length, 3);
  }, 200, 'edit');
});
test('隔离代码取消：待审批edit不修改文件且重启不补执行', { timeout: 20000 }, async () => {
  await withFixture(async (b, requests, ctx) => {
    const original = 'module.exports = (a, b) => a - b;\n';
    writeFileSync(join(ctx.dir, 'sum.cjs'), original);
    await b.request('workspace/set-directory', { directory: ctx.dir });
    await b.request('task/start', { customModelId: 'test' });
    let ticket;
    for (let i = 0; i < 200 && !ticket; i++) {
      ticket = b.notifications.find(n => n.method === 'approval/asked' && n.params.tool === 'edit');
      if (!ticket) await pause(20);
    }
    assert.ok(ticket);
    assert.equal((await b.request('turn/cancel')).cancelRequested, true);
    const result = await poll(b);
    assert.equal(result.cancelled, true); assert.equal(result.pendingToolCalls, 0);
    assert.equal(readFileSync(join(ctx.dir, 'sum.cjs'), 'utf8'), original);
    assert.equal(requests.length, 2);
    const log = readFileSync(join(ctx.dir, 'session.log'), 'utf8');
    assert.ok(log.includes('edit-code')); assert.ok(log.includes('cancelled'));
    await b.stop(); await b.start(ctx.dir);
    await b.request('session/projection'); await pause(50);
    assert.equal(readFileSync(join(ctx.dir, 'sum.cjs'), 'utf8'), original);
    assert.equal(requests.length, 2);
  }, 200, 'edit');
});
test('Host模型中心：上下文超限在派发前拒绝且保留原日志', { timeout: 20000 }, async () => {
  await withFixture(async (b, requests) => {
    const providers = await b.request('model/registry/describe');
    const p = providers.providers[0];
    await b.request('model/registry/update', { draft: { ...p, models: p.models.map(m => ({ ...m, contextWindow: '1', maxTokens: '1' })) }, expectedRevision: providers.revision });
    const customs = await b.request('custom/describe');
    await b.request('custom/upsert', { draft: { ...customs.models[0], maxOutputTokens: 1 }, expectedRevision: customs.revision });
    assert.equal((await b.request('custom/describe')).models[0].maxOutputTokens, 1);
    const content = '合成上下文预算验证'.repeat(200);
    await b.request('session/submit', { eventType: 'user/message', data: content });
    await b.request('task/start', { customModelId: 'test' });
    const result = await poll(b);
    assert.equal(result.interrupted, true);
    assert.equal(result.finishReason, 'error:request-context-limit');
    assert.equal(requests.length, 0);
    const stats = await b.request('ledger/stats');
    assert.equal(stats.pendingReservations.length, 0);
    assert.equal(stats.unsettledAttempts.length, 0);
    const snapshot = await b.request('session/projection');
    assert.ok(JSON.stringify(snapshot).includes(content), '拒绝请求不得截断原会话日志');
  });
});
test('Host模型中心：输出预算取自定义与模型较小值并写入实际请求', { timeout: 20000 }, async () => {
  await withFixture(async (b, requests) => {
    const providers = await b.request('model/registry/describe');
    const p = providers.providers[0];
    await b.request('model/registry/update', { draft: { ...p, models: p.models.map(m => ({ ...m, contextWindow: '1m', maxTokens: '16' })) }, expectedRevision: providers.revision });
    for (const cap of [8, 32]) {
      const customs = await b.request('custom/describe');
      await b.request('custom/upsert', { draft: { ...customs.models[0], maxOutputTokens: cap }, expectedRevision: customs.revision });
      await b.request('task/start', { customModelId: 'test' });
      assert.equal((await poll(b)).interrupted, false);
      assert.equal(requests.at(-1).max_tokens, Math.min(cap, 16));
      assert.equal(Object.hasOwn(requests.at(-1), 'max_completion_tokens'), false);
    }
    assert.equal(requests.length, 2);
    assert.equal((await b.request('ledger/stats')).pendingReservations.length, 0);
  });
});
test('Host模型中心：冷启动保留模型配置与待核算记录、不重发已完成请求', { timeout: 20000 }, async () => {
  await withFixture(async (b, requests, ctx) => {
    await b.request('task/start', { customModelId: 'test' });
    assert.equal((await poll(b)).interrupted, false);
    const before = await b.request('ledger/stats');
    assert.equal(before.unsettledAttempts.length, 1);
    await b.stop(); await b.start(ctx.dir);
    const after = await b.request('ledger/stats');
    assert.deepEqual(after.unsettledAttempts, before.unsettledAttempts);
    assert.equal((await b.request('custom/describe')).models[0].id, 'test');
    await pause(100); assert.equal(requests.length, 1);
  });
});

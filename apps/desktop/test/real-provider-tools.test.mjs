// 真实 StepFun 工具闭环：模型决定调用、仓颉执行、结果续答及冷进程日志回放。
// 凭据沿用真实往返测试入口，不写入源码或测试输出。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { HostBridge } = createRequire(import.meta.url)('../host-bridge.cjs');
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const host = process.env.SACODE_HOST || fileURLToPath(new URL('../dist/host/bin/sacode-host.exe', import.meta.url));

 test('真实 StepFun 调用 todo_write 后续答，冷宿主从日志恢复工具结果', { timeout: 180000 }, async t => {
  const keyFile = join(repo, 'target', 'step.key');
  const key = process.env.STEPFUN_API_KEY || (existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : '');
  if (!key) { t.skip('缺少 STEPFUN_API_KEY 或 target/step.key'); return; }
  assert.ok(existsSync(host), '缺少自包含宿主');
  const directory = mkdtempSync(join(tmpdir(), 'sacode-real-tools-'));
  const env = { ...process.env, SACODE_USER_SETTINGS_DIR: join(directory, 'settings') };
  // 不允许继承本地 provider 夹具覆盖本次真实测试。
  for (const name of ['SACODE_PROVIDER_BASE_URL', 'SACODE_PROVIDER_KEY', 'SACODE_PROVIDER_MODEL']) delete env[name];
  const bridge = new HostBridge(host, env);
  await bridge.start(directory);
  let expectedTodos;
  try {
    await bridge.request('model/registry/update', { draft: {
      id: 'stepfun', name: 'StepFun', baseUrl: 'https://api.stepfun.com/step_plan/v1', protocol: 'openai-completions',
      models: [{ id: 'step-5-preview', name: 'step-5-preview', contextWindow: '', maxTokens: '', image: false }],
    }, expectedRevision: 0 });
    await bridge.request('model/registry/set-default', { providerId: 'stepfun', model: 'step-5-preview', expectedRevision: 1 });
    const registry = await bridge.request('model/registry/describe');
    await bridge.request('credential/set', { ref: registry.providers[0].credentialRef, value: key });
    await bridge.request('session/submit', { eventType: 'user/message', data:
      '这是工具链路验收。请务必实际调用一次 todo_write 工具，不要只描述调用：把待办清单设为恰好一项，content 为“真实工具验收”，status 为“in_progress”。工具返回后不要再次调用工具，简短告诉我返回结果中待办状态。' });
    const started = await bridge.request('task/start');
    assert.equal(started.provider, 'real');
    let result; const frames = [];
    for (let i = 0; i < 850; i++) {
      result = await bridge.request('turn/poll'); frames.push(...result.frames);
      if (result.settled) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.equal(result.settled, true, '真实工具回合必须结算');
    assert.equal(result.interrupted, false);
    assert.equal(result.finishReason, 'stop');
    assert.ok(result.text.length > 0, '工具执行后必须有模型续答');
    assert.ok(result.used > 0, '真实 usage 必须累计');
    assert.ok(frames.includes('projection:todos'), '仓颉实际执行待办工具并发出投影更新');
    const projection = await bridge.request('session/projection');
    expectedTodos = [{ content: '真实工具验收', status: 'in_progress' }];
    assert.deepEqual(projection.todos, expectedTodos);
    assert.ok(projection.messages.some(row => row.startsWith('assistant/message: ')));
    const log = readFileSync(join(directory, 'session.log'), 'utf8');
    assert.ok(log.includes('todo_write'), '实际调用进入日志');
    assert.ok(log.includes('tool/result'), '工具结果进入日志');
    assert.ok(!log.includes(key), '日志不得包含模型凭据');
  } finally {
    const stopped = await bridge.stop();
    assert.equal(stopped.code, 0); assert.equal(stopped.forced, false);
  }
  const cold = new HostBridge(host, env);
  await cold.start(directory);
  try {
    const projection = await cold.request('session/projection');
    assert.deepEqual(projection.todos, expectedTodos, '冷进程仅靠持久日志恢复工具结果');
    assert.ok(projection.messages.some(row => row.startsWith('assistant/message: ')), '续答重启后仍在');
  } finally {
    const stopped = await cold.stop();
    assert.equal(stopped.code, 0); assert.equal(stopped.forced, false);
  }
});

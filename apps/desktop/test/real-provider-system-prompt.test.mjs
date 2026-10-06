// 真实 StepFun 回合必须收到系统提示（缺口一正证）。
// 修复前 task/start 只从会话日志重建 messages，而没有任何人往日志里写
// system/message——模型收到的是空系统提示，答不出自己的角色定义。
// 不要求泄露隐藏提示原文；用户问题不给品牌，检查身份遵循及持久系统消息。
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

test('真实 StepFun 回合收到系统提示，并能从冷进程日志重建', { timeout: 180000 }, async t => {
  const keyFile = join(repo, 'target', 'step.key');
  const key = process.env.STEPFUN_API_KEY || (existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : '');
  if (!key) { t.skip('缺少 STEPFUN_API_KEY 或 target/step.key'); return; }
  assert.ok(existsSync(host), '缺少自包含宿主');
  const directory = mkdtempSync(join(tmpdir(), 'sacode-real-sysprompt-'));
  const env = { ...process.env, SACODE_USER_SETTINGS_DIR: join(directory, 'settings') };
  // 不允许继承本地 provider 夹具覆盖本次真实测试。
  for (const name of ['SACODE_PROVIDER_BASE_URL', 'SACODE_PROVIDER_KEY', 'SACODE_PROVIDER_MODEL']) delete env[name];
  const bridge = new HostBridge(host, env);
  await bridge.start(directory);
  try {
    await bridge.request('model/registry/update', { draft: {
      id: 'stepfun', name: 'StepFun', baseUrl: 'https://api.stepfun.com/step_plan/v1', protocol: 'openai-completions',
      models: [{ id: 'step-5-preview', name: 'step-5-preview', contextWindow: '', maxTokens: '', image: false }],
    }, expectedRevision: 0 });
    await bridge.request('model/registry/set-default', { providerId: 'stepfun', model: 'step-5-preview', expectedRevision: 1 });
    const registry = await bridge.request('model/registry/describe');
    await bridge.request('credential/set', { ref: registry.providers[0].credentialRef, value: key });
    await bridge.request('session/submit', { eventType: 'user/message', data:
      '请告诉我你在当前应用中的助手名称，只输出名称。' });
    const started = await bridge.request('task/start');
    assert.equal(started.provider, 'real');
    let result;
    for (let i = 0; i < 850; i++) {
      result = await bridge.request('turn/poll');
      if (result.settled) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.equal(result.settled, true, '真实回合必须结算');
    assert.equal(result.interrupted, false);
    assert.equal(result.finishReason, 'stop');
    assert.ok(result.text.length > 0, '必须有模型续答');
    // 系统提示首行是 "you are SaCode"：模型收得到才复述得出来，
    // 收不到时它只会说「我没有系统提示」之类，不可能吐出这个专名。
    assert.ok(/sacode/i.test(result.text), '模型应遵循系统定义的助手身份；问题中没有提供 SaCode 名称');
    const log = readFileSync(join(directory, 'session.log'), 'utf8');
    assert.ok(log.includes('system/message'), '系统提示必须落会话日志');
    assert.ok(log.includes('you are SaCode'), '日志里是 SystemPromptBuilder 的原文');
    assert.ok(!log.includes(key), '日志不得包含模型凭据');
  } finally {
    const stopped = await bridge.stop(); assert.equal(stopped.code, 0); assert.equal(stopped.forced, false);
  }
  // 冷进程回放：系统提示是日志里的事实，不靠进程内存
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

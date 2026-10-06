// 真实 StepFun 工具闭环（read）：模型决定调用 read、仓颉执行、结果续答（缺口二正证）。
// 修复前请求里只有 todo_write 一个工具，模型根本没有 read 可调——它只能道歉，
// 续答里不会出现文件正文。反证即把 toolRuntime 传回 None 重跑，本用例转红。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { HostBridge } = createRequire(import.meta.url)('../host-bridge.cjs');
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const host = process.env.SACODE_HOST || fileURLToPath(new URL('../dist/host/bin/sacode-host.exe', import.meta.url));

test('真实 StepFun 调用 read 读盘上文件并把正文带进续答', { timeout: 180000 }, async t => {
  const keyFile = join(repo, 'target', 'step.key');
  const key = process.env.STEPFUN_API_KEY || (existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : '');
  if (!key) { t.skip('缺少 STEPFUN_API_KEY 或 target/step.key'); return; }
  assert.ok(existsSync(host), '缺少自包含宿主');
  const directory = mkdtempSync(join(tmpdir(), 'sacode-real-read-'));
  // 文件放在宿主 CWD（= 本目录）下：未设工作区时相对路径就落在进程 CWD
  const secret = '菠萝-42-信号';
  writeFileSync(join(directory, 'real-read-demo.txt'), secret, 'utf8');
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
      '这是工具链路验收。请务必实际调用一次 read 工具读取当前目录下的 real-read-demo.txt（参数 path 填 real-read-demo.txt），然后把读到的正文逐字复述出来。除了 read 之外不要调用任何工具，也不要自己编造正文。' });
    const started = await bridge.request('task/start');
    assert.equal(started.provider, 'real');
    let result;
    for (let i = 0; i < 850; i++) {
      result = await bridge.request('turn/poll');
      if (result.settled) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.equal(result.settled, true, '真实工具回合必须结算');
    assert.equal(result.interrupted, false);
    assert.equal(result.finishReason, 'stop');
    assert.ok(result.text.length > 0, '工具执行后必须有模型续答');
    // 只有 read 真被执行、结果真被带回模型，续答里才可能出现这串正文
    assert.ok(result.text.includes(secret), '续答必须带上 read 读到的文件正文');
    const log = readFileSync(join(directory, 'session.log'), 'utf8');
    assert.ok(log.includes('"name":"read"'), 'read 调用必须进日志');
    assert.ok(log.includes('ok-read:'), 'read 结果必须进日志');
    assert.ok(!log.includes(key), '日志不得包含模型凭据');
  } finally {
    const stopped = await bridge.stop(); assert.equal(stopped.code, 0); assert.equal(stopped.forced, false);
  }
  // 冷进程回放：调用与结果都只在盘上那份日志里，重启后仍答得出
  const cold = new HostBridge(host, env);
  await cold.start(directory);
  try {
    const projection = await cold.request('session/projection');
    assert.ok(projection.messages.some(line => line.startsWith('assistant/message: ')), '续答重启后仍在');
    const log = readFileSync(join(directory, 'session.log'), 'utf8');
    assert.ok(log.includes('ok-read:'), '冷进程仍能从日志认出 read 结果');
  } finally {
    const stopped = await cold.stop(); assert.equal(stopped.code, 0); assert.equal(stopped.forced, false);
  }
});

import {realProviderCredential} from './support/real-provider-credential.mjs';
// 真模型端到端：不打本地桩，直接走 TLS 打给配置面里登记的提供商。
// 凭据仅在显式启用测试后从进程环境注入，绝不写进源码、日志或回执。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { realHostEnv } from '../test-support/real-host-env.mjs';
import { fileURLToPath } from 'node:url';
const { HostBridge } = createRequire(import.meta.url)('../host-bridge.cjs');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const HOST = process.env.SACODE_HOST || join(HERE, '..', 'dist', 'host', 'bin', 'sacode-host.exe');
// 随包信任锚与「不带 SSL_CERT_FILE」两条由 test-support/real-host-env.mjs 统一保证
// （复用壳层 paths.cjs 的同一套接线）；缺锚仍然会在 TLS 层如实失败，不降级校验。
// 2026-10-11 实测：/step_plan/v1 + step-5-preview 对本账号回 403 real_name_required（账号侧限制，
// 不是解析器缺陷），同一条键打 /v1 + step-3.7-flash 能出真答复，故夹具换成后者。
const BASE_URL = 'https://api.stepfun.com/v1';
const MODEL = 'step-3.7-flash';
const CRED_REF = 'STEPFUN_API_KEY';

function readKey() { return realProviderCredential(); }

test('真实提供商往返：配置面登记的模型能出真答复', { timeout: 180000 }, async (t) => {
  const key = readKey();
  if (key.length === 0) { t.skip('缺少真模型凭据（需显式启用 SACODE_RUN_REAL_PROVIDER_TESTS=1 并注入 STEPFUN_API_KEY）'); return; }
  assert.ok(existsSync(HOST), '缺少自包含宿主');
  const dir = mkdtempSync(join(tmpdir(), 'sacode-real-'));
  const bridge = new HostBridge(HOST, realHostEnv(dir, HOST));
  await bridge.start(dir);
  try {
    await bridge.request('model/registry/update', {
      draft: {
        id: 'stepfun', name: 'StepFun', baseUrl: BASE_URL, protocol: 'openai-completions',
        models: [{ id: MODEL, name: MODEL, contextWindow: '', maxTokens: '', image: false }],
      },
      expectedRevision: 0,
    });
    await bridge.request('model/registry/set-default', { providerId: 'stepfun', model: MODEL, expectedRevision: 1 });
    const stored = await bridge.request('model/registry/describe');
    const ref = stored.providers[0].credentialRef;
    await bridge.request('credential/set', { ref, value: key });
    assert.equal(ref, 'SA_CODE_STEPFUN_API_KEY', '凭据名按 ID 派生');

    await bridge.request('session/submit', { eventType: 'user/message', data: '只回复四个字：收到就好' });
    const start = await bridge.request('task/start');
    assert.equal(start.provider, 'real', '已配置注册表时必须走真实 provider');

    let result;
    const frames = [];
    for (let i = 0; i < 900; i++) {
      result = await bridge.request('turn/poll');
      frames.push(...result.frames);
      if (result.settled) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(result.settled, true, '真模型回合必须在时限内结算');
    assert.equal(result.interrupted, false);
    assert.ok(result.text.length > 0, '真答复正文不能为空');
    assert.ok(result.used > 0, '计量要从真实 usage 累计');
    assert.ok(/stop|max-tokens/.test(result.finishReason), `终止原因要来自真流：${result.finishReason}`);
    assert.ok(frames.some((f) => f.startsWith('text:')), '流式增量要帧帧交给桌面');

    const projection = await bridge.request('session/projection');
    assert.ok(projection.messages.some((m) => m.startsWith('assistant/message: ')), '答复要落进会话投影');
    const logged = readFileSync(join(dir, 'session.log'), 'utf8');
    assert.ok(!logged.includes(key), '会话日志里不得出现凭据材料');
  } finally {
    const stopped = await bridge.stop();
    assert.equal(stopped.code, 0);
    assert.equal(stopped.forced, false);
  }
});

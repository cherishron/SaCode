// 真模型增强验收：不打本地桩，直接走 TLS 打给配置面登记的提供商。
// 凭据只从环境变量或 gitignore 的 target/step.key 读，绝不写进源码、日志或回执。
// 这一条证的是「增强用的是当前会话那颗模型，并且真拿到了改写」——本地夹具只能证形状，证不了语义。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const { HostBridge } = createRequire(import.meta.url)('../host-bridge.cjs');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const HOST = process.env.DSH_HOST || join(HERE, '..', 'dist', 'host', 'bin', 'dsh-host.exe');
const BASE_URL = 'https://api.stepfun.com/step_plan/v1';
const MODEL = 'step-5-preview';
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

function readKey() {
  if ((process.env.STEPFUN_API_KEY || '').length > 0) { return process.env.STEPFUN_API_KEY; }
  const file = join(REPO, 'target', 'step.key');
  if (!existsSync(file)) { return ''; }
  return readFileSync(file, 'utf8').trim();
}

test('真模型增强：当前会话的模型把草稿改写得更清楚，且不落进会话消息', { timeout: 240000 }, async (t) => {
  const key = readKey();
  if (key.length === 0) { t.skip('缺少真模型凭据（需 STEPFUN_API_KEY 环境变量或 gitignore 的 target/step.key）'); return; }
  assert.ok(existsSync(HOST), '缺少自包含宿主');

  const sessionDir = mkdtempSync(join(tmpdir(), 'sacode-enh-real-'));
  const settingsDir = mkdtempSync(join(tmpdir(), 'sacode-enh-cfg-'));
  // 全新的配置根 + 环境变量兜底：增强取的就是这一颗模型，而不是本机已配的别的提供商。
  const bridge = new HostBridge(HOST, {
    ...process.env,
    SACODE_USER_SETTINGS_DIR: settingsDir,
    DSH_PROVIDER_BASE_URL: BASE_URL,
    DSH_PROVIDER_MODEL: MODEL,
    STEPFUN_API_KEY: key,
  });
  await bridge.start(sessionDir);
  try {
    const draft = '想要队列能在跑的时候插一句话，别打断正在做的事';
    const started = await bridge.request('prompt/enhance', { draft });
    assert.equal(started.started, true, `增强须启动，实得: ${JSON.stringify(started)}`);
    // 回执必须点名本次用的模型：这就是「点击时定档」的可核对证据。
    assert.equal(started.model, MODEL, `启动帧须回显当前会话模型，实得: ${JSON.stringify(started)}`);

    let settled = null;
    for (let i = 0; i < 1800; i++) {
      const p = await bridge.request('prompt/poll', {});
      if (p.settled) { settled = p; break; }
      await nap(100);
    }
    assert.ok(settled, '真模型增强须在期限内结算');
    assert.equal(settled.cancelled, false, `不得被取消，实得: ${JSON.stringify(settled)}`);
    assert.equal(settled.ok, true, `真模型增强须成功，错误「${settled.error}」`);
    assert.ok(settled.text.trim().length > 0, '增强文本非空');
    assert.ok(settled.text !== draft, '增强文本应是改写后的另一份表述');
    // 语义底线：原话里的两个意图都得留着，改写不得把人说的换成别的需求。
    assert.ok(settled.text.includes('队列') || settled.text.includes('插'), `须保留「队列/插话」这一意图，实得: ${settled.text}`);
    assert.ok(!/\b(React|Vue|Kubernetes|Docker)\b/.test(settled.text), `不得凭空加技术栈，实得: ${settled.text}`);
    // 真往返一定会有用量；没有 usage 就是没计量。
    assert.match(String(settled.usage), /^\d+$/, `须带回真实 token 用量，实得: ${JSON.stringify(settled)}`);
    assert.ok(!JSON.stringify(settled).includes(key), '回执里不得出现凭据明文');
    assert.equal(settled.model, MODEL, '结算帧须仍指向同一颗模型（中途换模型不影响这一笔）');

    const proj = await bridge.request('session/projection', {});
    const msgs = proj.messages || [];
    assert.ok(!msgs.some((m) => m.startsWith('assistant/message:')), `增强不得落成会话消息，实得: ${JSON.stringify(msgs)}`);
    assert.ok(!msgs.some((m) => m.includes(draft)), '草稿本身也不得被写进会话');
    const usage = await bridge.request('usage/status', {});
    assert.ok(usage.used >= Number(settled.usage), `用量须进同一份账（used=${usage.used}, 本次=${settled.usage}）`);
  } finally {
    await bridge.stop();
  }
});

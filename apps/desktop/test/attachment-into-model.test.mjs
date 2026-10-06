// 附件进模型请求的端到端验收：上传的图片引用必须被装配点物化成 provider 请求体里
// 的 image_url part，而会话日志始终只带引用。判定权交给 provider 侧——夹具把收到的
// 请求体里真正的图片 part 数回声进答复，装配点没物化就是 parts=0。
// 上游口径（attachment.en.md L5 与 L149-166）：事件与模型可见附件块只含引用与元数据，
// 请求字节是另一件事（RequestImageAttachment：attachment 引用 + 编码后的请求字节）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { HostBridge } = require('../host-bridge.cjs');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const HOST = process.env.SACODE_HOST || join(HERE, '..', 'dist', 'host', 'bin', 'sacode-host.exe');
const FIXTURE = join(REPO, 'scripts', 'sse-contract-server.cjs');
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

// 与 attachment-upload.test.mjs 同一份 2x1 PNG 头（33 字节）。
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAAAAAAA';

async function startFixture() {
  const proc = spawn(process.execPath, [FIXTURE], { stdio: ['pipe', 'pipe', 'pipe'] });
  const port = await new Promise((res, rej) => {
    let buf = '';
    const to = setTimeout(() => rej(new Error('SSE 夹具启动超时')), 8000);
    proc.stdout.on('data', (d) => { buf += d.toString(); const i = buf.indexOf('\n'); if (i >= 0) { clearTimeout(to); res(buf.slice(0, i).trim()); } });
    proc.stderr.on('data', (d) => process.stderr.write(`[into-model-fixture] ${d}`));
    proc.on('error', (e) => { clearTimeout(to); rej(e); });
  });
  return { proc, port: Number(port) };
}

test('上传的图片随消息进到 provider 请求体，而日志里仍只有引用', { timeout: 120000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sacode-att-model-'));
  const fixture = await startFixture();
  const bridge = new HostBridge(HOST, { ...process.env, SACODE_USER_SETTINGS_DIR: join(dir, 'settings') });
  await bridge.start(dir);
  try {
    // baseUrl 指到夹具的 vision 路由：provider 请求会变成 /vision/chat/completions。
    await bridge.request('model/registry/update', {
      draft: {
        id: 'fixture', name: 'Fixture', baseUrl: `http://127.0.0.1:${fixture.port}/vision`,
        protocol: 'openai-completions',
        models: [{ id: 'vision-model', name: 'vision-model', contextWindow: '', maxTokens: '', image: true }],
      },
      expectedRevision: 0,
    });
    await bridge.request('model/registry/set-default', { providerId: 'fixture', model: 'vision-model', expectedRevision: 1 });

    const up = await bridge.request('attachment/upload', { kind: 'image', name: 'a.png', mediaType: 'image/png', data: PNG_B64 });
    await bridge.request('session/append', { data: '这张图里是什么？', receiptIds: [up.receiptId] });

    const start = await bridge.request('task/start');
    assert.equal(start.provider, 'real', '已配置注册表时必须走真实 provider 路径');

    let done;
    for (let i = 0; i < 400; i++) {
      done = await bridge.request('turn/poll');
      if (done.settled) break;
      await nap(50);
    }
    assert.equal(done.settled, true, '回合必须在时限内结算');
    // provider 回声：装配点物化了几条 data:image/ part。
    assert.match(done.text, /parts=1\b/, `请求体里要有一条图片 part，实际答复是「${done.text}」`);
    assert.match(done.text, /text=[1-9]\d*/, '文字 part 也要在场，不能只剩图片');

    const logged = readFileSync(join(dir, 'session.log'), 'utf8');
    assert.ok(!logged.includes('base64'), '会话日志不能出现 base64：请求物化只发生在装配点');
    assert.ok(!logged.includes(PNG_B64), '会话日志不能出现提交的原始 base64');
    assert.ok(logged.includes('sha256:'), '日志侧留下的应当只有内容寻址引用');
  } finally {
    await bridge.stop();
    fixture.proc.kill();
  }
});

test('没有附件的消息仍然走纯字符串 content', { timeout: 120000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sacode-att-plain-'));
  const fixture = await startFixture();
  const bridge = new HostBridge(HOST, { ...process.env, SACODE_USER_SETTINGS_DIR: join(dir, 'settings') });
  await bridge.start(dir);
  try {
    await bridge.request('model/registry/update', {
      draft: {
        id: 'fixture', name: 'Fixture', baseUrl: `http://127.0.0.1:${fixture.port}/vision`,
        protocol: 'openai-completions',
        models: [{ id: 'vision-model', name: 'vision-model', contextWindow: '', maxTokens: '', image: true }],
      },
      expectedRevision: 0,
    });
    await bridge.request('model/registry/set-default', { providerId: 'fixture', model: 'vision-model', expectedRevision: 1 });
    await bridge.request('session/append', { data: '纯文字的一轮' });
    const start = await bridge.request('task/start');
    assert.equal(start.provider, 'real');
    let done;
    for (let i = 0; i < 400; i++) {
      done = await bridge.request('turn/poll');
      if (done.settled) break;
      await nap(50);
    }
    assert.equal(done.settled, true);
    // 一条图片 part 都没有（parts=0），说明新分支没有把普通消息也改成数组形态。
    assert.match(done.text, /parts=0\b/, `普通消息不该被塞成多 part，实际答复是「${done.text}」`);
  } finally {
    await bridge.stop();
    fixture.proc.kill();
  }
});

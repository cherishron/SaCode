// 队列路径的附件凭证验收：上游 file-upload 生成面（冻结 639ed01，attachment.en.md L341-355）
// 写得很死——「Bind receipts while one prompt enters an Agent inbox … binding kept after
// commit until queue or history observation retires its receipts」，以及
// 「Retire every receipt accepted by one removed queue occurrence」。
// 翻成本仓的行为：入队即把凭证换成条目上的引用（同一凭证第二次使用没有通路），
// 轮次边界送达时才落成 attachment/record + user/message，provider 才看到图片 part；
// 条目在送达前被删掉，则引用随条目一起作废，日志里一个字都不该多。
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
const HOST = process.env.DSH_HOST || join(HERE, '..', 'dist', 'host', 'bin', 'dsh-host.exe');
const FIXTURE = join(REPO, 'scripts', 'sse-contract-server.cjs');
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAAAAAAA';
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

async function startFixture() {
  const proc = spawn(process.execPath, [FIXTURE, '--watchdog-ms', '120000'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const port = await new Promise((res, rej) => {
    let buf = '';
    const to = setTimeout(() => rej(new Error('SSE 夹具启动超时')), 8000);
    proc.stdout.on('data', (d) => { buf += d.toString(); const i = buf.indexOf('\n'); if (i >= 0) { clearTimeout(to); res(buf.slice(0, i).trim()); } });
    proc.stderr.on('data', (d) => process.stderr.write(`[queue-att-fixture] ${d}`));
    proc.on('error', (e) => { clearTimeout(to); rej(e); });
  });
  return { proc, port: Number(port) };
}

async function open(tag) {
  const dir = mkdtempSync(join(tmpdir(), `sacode-queue-att-${tag}-`));
  const fixture = await startFixture();
  const bridge = new HostBridge(HOST, { ...process.env, SACODE_USER_SETTINGS_DIR: join(dir, 'settings') });
  await bridge.start(dir);
  // provider 指到夹具的 vision 回显路由：图片 part 到底有没有到，只有 provider 侧能证。
  await bridge.request('model/registry/update', {
    draft: {
      id: 'fixture', name: 'Fixture', baseUrl: `http://127.0.0.1:${fixture.port}/vision`,
      protocol: 'openai-completions',
      models: [{ id: 'vision-model', name: 'vision-model', contextWindow: '', maxTokens: '', image: true }],
    },
    expectedRevision: 0,
  });
  await bridge.request('model/registry/set-default', { providerId: 'fixture', model: 'vision-model', expectedRevision: 1 });
  return { dir, fixture, bridge };
}

async function settle(bridge) {
  for (let i = 0; i < 400; i++) {
    const poll = await bridge.request('turn/poll');
    if (poll.settled) return poll;
    await nap(50);
  }
  throw new Error('回合未在时限内结算');
}

test('排队那条带图的消息在轮次边界落为引用与正文，provider 看到一条图片 part', { timeout: 120000 }, async () => {
  const { dir, fixture, bridge } = await open('commit');
  try {
    await bridge.request('session/submit', { eventType: 'user/message', data: '第一句' });
    const up = await bridge.request('attachment/upload', { kind: 'image', name: 'q.png', mediaType: 'image/png', data: PNG_B64 });
    const enq = await bridge.request('queue/enqueue', { text: '排队时带了一张图', rpcId: 'rpc-att', receiptIds: [up.receiptId] });
    assert.equal(enq.accepted, true, '带合法凭证的排队要被接受');
    // 入队即消费：同一个凭证再拿出来用，必须报「认不出」而不是静默再造一条
    await assert.rejects(() => bridge.request('session/append', { data: '想用同一张图的另一句', receiptIds: [up.receiptId] }), /attachment-receipt-unknown/);

    const start = await bridge.request('task/start');
    assert.equal(start.provider, 'real');
    // 队首那条被摘走：它已经从队列消失
    const view = await bridge.request('queue/describe');
    assert.equal(view.nextTurn.length, 0, '送达后条目不再留在队列里');

    const done = await settle(bridge);
    assert.match(done.text, /parts=1\b/, `排队带图要物化成一条图片 part，实际答复是「${done.text}」`);
    assert.match(done.text, /text=[1-9]\d*/, '正文文字 part 也要在场');

    const logged = readFileSync(join(dir, 'session.log'), 'utf8');
    assert.ok(logged.includes('attachment/record'), '送达要写成紧邻正文的引用事件');
    assert.ok(!logged.includes('base64'), '日志只有引用，不带 base64');
    assert.ok(!logged.includes(PNG_B64), '日志不出现上传的原始字节');
    // 上游那条顺序规则：引用块必须紧邻在它所服务的那条正文之前，中间不插别的事实
    const lines = logged.split('\n').filter((l) => l.trim().length > 0);
    const paired = lines.some((line, i) => line.includes('attachment/record') && (lines[i + 1] || '').includes('排队时带了一张图'));
    assert.ok(paired, 'attachment/record 要紧邻在它服务的那条 user/message 之前');
  } finally {
    await bridge.stop();
    fixture.proc.kill();
  }
});

test('排队条目在送达前被删掉，凭证随之作废，日志一条引用都不多', { timeout: 120000 }, async () => {
  const { dir, fixture, bridge } = await open('retire');
  try {
    await bridge.request('session/submit', { eventType: 'user/message', data: '先说一句' });
    const up = await bridge.request('attachment/upload', { kind: 'image', name: 'x.png', mediaType: 'image/png', data: PNG_B64 });
    const enq = await bridge.request('queue/enqueue', { text: '这条会被删掉', rpcId: 'rpc-del', receiptIds: [up.receiptId] });
    const removed = await bridge.request('queue/update', { itemId: enq.id, kind: 'remove' });
    assert.equal(removed.accepted, true);

    const start = await bridge.request('task/start');
    assert.equal(start.provider, 'real');
    const done = await settle(bridge);
    assert.match(done.text, /parts=0\b/, `删掉的条目不该把图带进请求，实际答复是「${done.text}」`);
    // 上游那句「removed queue occurrence」的结算：凭证不还原，也永远不会变成某条消息的引用
    await assert.rejects(() => bridge.request('session/append', { data: '想回收这张图', receiptIds: [up.receiptId] }), /attachment-receipt-unknown/);
    const logged = readFileSync(join(dir, 'session.log'), 'utf8');
    assert.ok(!logged.includes('attachment/record'), '没有送达就没有引用事件');
    // 会话日志是 `seq⇥eventType⇥正文`；被删掉的条目作为**队列事实**留在日志里是对的
    // （入列本身就是一条 agent/inbox/spliced），但它绝不能变成一条 user/message。
    const asUserMessage = logged.split('\n')
      .map((line) => line.split('\t'))
      .some((parts) => parts[1] === 'user/message' && (parts[2] || '').includes('这条会被删掉'));
    assert.ok(!asUserMessage, '被删掉的条目不得冒充成一句用户消息');
  } finally {
    await bridge.stop();
    fixture.proc.kill();
  }
});

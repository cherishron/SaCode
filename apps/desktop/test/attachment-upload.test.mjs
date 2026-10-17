// 附件通道的接入验收：上传的字节必须真的落到宿主文件后端的内容寻址目录里，
// 会话日志只携带引用与元数据（绝不含 base64），且引用只能由「本宿主发放的
// 暂存凭证」解析出来——对端自报的 attachmentId 没有通路。
// 上游口径（冻结 639ed01 直读 attachment.md / file-upload 一节）：
// persist-before-event、AttachmentId 不透明、凭证一次性、未知或外来的凭证返回空。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { HostBridge } = require('../host-bridge.cjs');

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST = process.env.SACODE_HOST || join(HERE, '..', 'dist', 'host', 'bin', 'sacode-host.exe');

// 2x1 的 PNG 头（33 字节），sha256 由 Node crypto 算出；base64 同源生成。
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAAAAAAA';
const PNG_HEX = '496b9d0c20230f204855e8ece795c15394493e4f32200f742f46f3bdd73576cf';
const ABC_HEX = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

const freshDir = () => mkdtempSync(join(tmpdir(), 'sacode-att-'));

async function withHost(dir) {
  const bridge = new HostBridge(HOST, { ...process.env, SACODE_USER_SETTINGS_DIR: join(dir, 'settings') });
  await bridge.start(dir);
  return bridge;
}

test('图片上传落盘为内容寻址对象并回出不透明引用', async () => {
  const dir = freshDir();
  const bridge = await withHost(dir);
  try {
    const up = await bridge.request('attachment/upload', { kind: 'image', name: 'a.png', mediaType: 'image/png', data: PNG_B64 });
    assert.equal(up.attachment.attachmentId, `sha256:${PNG_HEX}`);
    assert.equal(up.attachment.kind, 'image');
    assert.equal(up.attachment.mediaType, 'image/png');
    assert.equal(up.attachment.bytes, 33);
    assert.equal(up.attachment.width, 2);
    assert.equal(up.attachment.height, 1);
    assert.equal(up.attachment.name, 'a.png');
    assert.ok(up.receiptId, '上传必须换回一个暂存凭证');
    const object = join(dir, 'attachments', 'v1', PNG_HEX);
    assert.ok(existsSync(object), '对象要先落到 attachments/v1 下');
    assert.equal(readFileSync(object).length, 33);
  } finally {
    await bridge.stop();
  }
});

test('通用文件不设准入额度，空内容也原样落盘', async () => {
  const dir = freshDir();
  const bridge = await withHost(dir);
  try {
    const file = await bridge.request('attachment/upload', { kind: 'file', name: '报告.txt', mediaType: '', data: 'YWJj' });
    assert.equal(file.attachment.attachmentId, `sha256:${ABC_HEX}`);
    assert.equal(file.attachment.kind, 'file');
    assert.equal(readFileSync(join(dir, 'attachments', 'v1', ABC_HEX)).toString('utf8'), 'abc');
    const empty = await bridge.request('attachment/upload', { kind: 'file', name: '空.dat', mediaType: '', data: '' });
    assert.equal(empty.attachment.bytes, 0);
  } finally {
    await bridge.stop();
  }
});

test('上传拒绝把字节说成别的类型，也拒绝非规范 base64', async () => {
  const dir = freshDir();
  const bridge = await withHost(dir);
  try {
    await assert.rejects(
      () => bridge.request('attachment/upload', { kind: 'image', name: 'x', mediaType: 'image/jpeg', data: PNG_B64 }),
      /attachment-media-type-mismatch/,
      '声明与魔数不符必须先拒，否则照声明去读宽高会读出垃圾',
    );
    await assert.rejects(
      () => bridge.request('attachment/upload', { kind: 'image', name: 'x', mediaType: 'image/bmp', data: 'AAA=' }),
      /attachment-unsupported-media-type/,
    );
    await assert.rejects(
      () => bridge.request('attachment/upload', { kind: 'file', name: 'x', mediaType: '', data: 'not base64!!' }),
      /attachment-bad-base64/,
    );
    assert.ok(!existsSync(join(dir, 'attachments')), '被拒的上传不能留下任何对象');
  } finally {
    await bridge.stop();
  }
});

test('凭证随消息结算：引用事件先于用户消息，且日志里没有 base64', async () => {
  const dir = freshDir();
  const bridge = await withHost(dir);
  try {
    const up = await bridge.request('attachment/upload', { kind: 'image', name: '看图.png', mediaType: 'image/png', data: PNG_B64 });
    // session/append 自己就是落盘屏障（append 后 flush 并放租约），不再另发一次 flush
    await bridge.request('session/append', { eventType: 'user/message', data: '看下这张图', receiptIds: [up.receiptId] });
    const log = readFileSync(join(dir, 'session.log'), 'utf8');
    const lines = log.trim().split('\n');
    const recordAt = lines.findIndex((l) => l.includes('attachment/record'));
    const messageAt = lines.findIndex((l) => l.includes('user/message'));
    assert.ok(recordAt >= 0, '引用要成为会话日志里的事实');
    assert.ok(recordAt < messageAt, '先持久化、后事件：引用事件排在它服务的用户消息之前');
    assert.ok(lines[recordAt].includes(PNG_HEX), '引用事件携带内容寻址 id');
    assert.ok(!log.includes('iVBOR'), '事件里绝不出现 base64 载荷');
    assert.ok(!log.includes(join(dir, 'attachments')), '事件里绝不出现宿主路径');
    // 凭证是一次性的：同一条再结算一次等于引用别人上传的东西
    await assert.rejects(
      () => bridge.request('session/append', { eventType: 'user/message', data: '再发一次', receiptIds: [up.receiptId] }),
      /attachment-receipt-unknown/,
    );
  } finally {
    await bridge.stop();
  }
});

test('未知凭证整条拒掉，但不烧掉同批里的好凭证', async () => {
  const dir = freshDir();
  const bridge = await withHost(dir);
  try {
    const up = await bridge.request('attachment/upload', { kind: 'file', name: 'x.txt', mediaType: '', data: 'YWJj' });
    await assert.rejects(
      () => bridge.request('session/append', { eventType: 'user/message', data: '带个不存在凭证', receiptIds: [up.receiptId, 'u9999'] }),
      /attachment-receipt-unknown/,
    );
    // 拒掉就不能有半结算：这条消息带着同一张凭证重试，必须成功
    await bridge.request('session/append', { eventType: 'user/message', data: '重试的正文', receiptIds: [up.receiptId] });
    const log = readFileSync(join(dir, 'session.log'), 'utf8');
    assert.ok(!log.includes('带个不存在凭证'), '被拒的那条不能落盘');
    assert.ok(log.includes('重试的正文'), '被拒批次里的好凭证不该一起作废');
    assert.equal(log.trim().split('\n').filter((l) => l.includes('attachment/record')).length, 1, '一次结算只写一条引用事件');
  } finally {
    await bridge.stop();
  }
});

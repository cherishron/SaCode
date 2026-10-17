import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { HostBridge } = require('../host-bridge.cjs');
const host = process.env.SACODE_HOST;

test('未启动宿主时请求明确拒绝', async () => {
  await assert.rejects(new HostBridge(process.execPath).request('initialize'), /host-unavailable/);
});

test('真实 stdin 错误事件拒绝全部在途请求且不成为未捕获异常', async () => {
  const b = new HostBridge(process.execPath);
  await b.start(tmpdir());
  try {
    const first = assert.rejects(b.request('initialize'), /host-write-error: EPIPE/);
    const second = assert.rejects(b.request('session/projection'), /host-write-error: EPIPE/);
    b.proc.stdin.destroy(Object.assign(new Error('断管故障注入'), { code: 'EPIPE' }));
    await Promise.all([first, second]);
    assert.equal(b.pending.size, 0);
    await assert.rejects(b.request('custom/describe'), /host-write-error: EPIPE/);
  } finally { await b.stop(); }
});

test('真实宿主退出后不再向死管道写入', async () => {
  const b = new HostBridge(process.execPath);
  await b.start(tmpdir());
  const exited = new Promise(done => b.proc.once('exit', done));
  b.proc.kill();
  await exited;
  await assert.rejects(b.request('custom/describe'), /host-gone/);
  assert.equal(b.pending.size, 0);
});

test('实际 Host：首次启动读取默认通用设置，后续模型读取仍可执行', { skip: !host }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'sacode-settings-bootstrap-'));
  const b = new HostBridge(host, { ...process.env, SACODE_USER_SETTINGS_DIR: join(root, 'settings') });
  await b.start(root);
  try {
    const result = await b.request('global/settings/get');
    assert.equal(result.transcriptView, 'default');
    assert.equal(result.composerEnter, 'send');
    assert.equal(result.sessionLog, 'off');
    const models = await b.request('custom/describe');
    assert.ok(models && typeof models === 'object');
    assert.equal((await b.request('initialize')).protocolVersion, '0.1');
  } finally { await b.stop(); }
});

test('实际 Host：设置文件读取失败返回协议错误，宿主继续响应', { skip: !host }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'sacode-settings-invalid-'));
  writeFileSync(join(root, 'general-settings.txt'), Buffer.from([0xff, 0xfe, 0xff]));
  const b = new HostBridge(host, { ...process.env, SACODE_USER_SETTINGS_DIR: join(root, 'settings') });
  await b.start(root);
  try {
    await assert.rejects(b.request('global/settings/get'), /-32003/);
    assert.equal((await b.request('initialize')).protocolVersion, '0.1');
  } finally { await b.stop(); }
});

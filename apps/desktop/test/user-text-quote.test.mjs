// 宿主读请求体的字段靠的是裸扫字符串，遇到转义引号就停在第一个 " 上：
// 用户在输入框里打一个引号，落盘的消息就被静默截短。这条用例盯的是那条边界。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { HostBridge } = createRequire(import.meta.url)('../host-bridge.cjs');

const HOST = process.env.SACODE_HOST || fileURLToPath(new URL('../dist/host/bin/sacode-host.exe', import.meta.url));

async function boot(t, prefix) {
  assert.ok(existsSync(HOST), '缺少自包含宿主');
  const dir = mkdtempSync(join(tmpdir(), `sacode-${prefix}-`));
  const bridge = new HostBridge(HOST, { ...process.env, SACODE_USER_SETTINGS_DIR: join(dir, 'settings') });
  await bridge.start(dir);
  t.after(() => bridge.stop());
  return { bridge, dir };
}

// 引号、反斜杠、换行、制表、Unicode 转义与真实多字节混在一条正文里
const TRICKY = '他说"引用"，路径 C:\\临时\\a.txt，\n第二行\t制表，\u{1F600} 表情与 "结尾引号';

test('用户正文里的引号反斜杠与换行逐字落盘且不截断', { timeout: 20000 }, async (t) => {
  const { bridge, dir } = await boot(t, 'text-quote');
  await bridge.request('initialize');
  const res = await bridge.request('session/append', { eventType: 'user/message', data: TRICKY });
  assert.equal(res.events, 1, '这一条必须被当作一条完整事件收下');
  const projection = await bridge.request('session/projection');
  assert.equal(projection.messages.length, 1);
  assert.equal(projection.messages[0], `user/message: ${TRICKY}`, '投影里的正文必须逐字一致');
  // 唯一真源：盘上那一行确实是这条事件，而不是被截短后的残句
  const onDisk = readFileSync(join(dir, 'session.log'), 'utf8');
  assert.ok(onDisk.startsWith('0\tuser/message\t'), onDisk.slice(0, 40));
  assert.ok(onDisk.includes('结尾引号'), '截断会让盘上丢掉句尾');
});

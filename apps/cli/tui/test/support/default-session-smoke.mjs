// 主包默认入口伪TTY烟测；隔离会话、无SACODE_HOST覆盖、不请求模型。
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAbsolute, join, relative, resolve } from 'node:path';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const run = resolve(process.argv[2] || '');
const local = relative(join(root, 'target/tmp'), run);
if (!process.argv[2] || !local || local.startsWith('..') || isAbsolute(local)) throw new Error('请指定target/tmp下的独立输出目录');
const explicit = process.argv[3] !== 'noargs';
const workspace = join(run, explicit ? 'explicit-workspace' : 'noargs-workspace');
mkdirSync(workspace, { recursive: true });
writeFileSync(join(workspace, '引用烟测.txt'), '只作本地确认取消验证，不应发送到模型。');
for (const key of Object.keys(process.env)) {
  if (/^(SACODE_HOST|SACODE_TUI_BUNDLE|SACODE_PROVIDER_.*|STEPFUN_API_KEY)$/i.test(key)) delete process.env[key];
}
process.env.SACODE_USER_SETTINGS_DIR = join(workspace, 'settings');
process.env.SACODE_PROVIDER_BASE_URL = 'http://127.0.0.1:1';
process.env.SACODE_PROVIDER_MODEL = 'never-requested';
process.chdir(workspace);
const stdin = new PassThrough();
Object.assign(stdin, { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
Object.defineProperty(process, 'stdin', { value: stdin, configurable: true });
Object.assign(process.stdout, { isTTY: true, columns: 80, rows: 24 });
let output = '';
let complete = false;
const write = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...args) => { output += String(chunk); return write(chunk, ...args); };
const originalExit = process.exit.bind(process);
process.exit = (code) => {
  try {
    assert.equal(code, 0); assert.ok(complete, '未完成会话烟测');
    assert.ok(output.replaceAll('\\', '/').includes('apps/desktop/dist/host/bin/sacode-host.exe'));
    process.stderr.write(`\n[session-smoke] ${explicit ? 'explicit' : 'noargs'} PASS exit=0; default Host; rename/search/archive/restore; no model turn\n`);
    originalExit(0);
  } catch (error) { process.stderr.write(`\n[session-smoke] FAIL ${error.message}\n`); originalExit(98); }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (text, since = 0) => {
  for (let i = 0; i < 150 && !output.slice(since).includes(text); i++) await sleep(30);
  assert.ok(output.slice(since).includes(text), `没有等到${text}`); await sleep(80);
};
const key = async (input) => { stdin.write(input); await sleep(80); };
const command = async (text, expected) => {
  const since = output.length; await key(text); await key('\r'); await waitFor(expected, since);
};
const cli = join(root, 'npm/sacode-cli/bin/cli.js');
process.argv = [process.execPath, cli, ...(explicit ? ['tui'] : [])];
createRequire(import.meta.url)(cli);
setTimeout(() => originalExit(99), 30000).unref();
try {
  await waitFor('输入任务，或');
  await command('解释 @"引用烟测.txt" ', '确认读取并发送文本引用');
  await key('\r'); // 默认取消，不读文件、不发模型请求，草稿保留。
  await key('\x03');
  await command('/rename 入口烟测会话', '确认重命名');
  await key('\x1b[A'); await key('\r'); await waitFor('会话已重命名');
  await command('/new 切换用会话', '已切换到新会话');
  await command('/archive ', '搜索：');
  await key('入口烟测会话'); await key('\r'); await waitFor('确认归档');
  await key('\x1b[A'); await key('\r'); await waitFor('已归档，记录未删除');
  await command('/resume ', '搜索：'); await key('\x01'); await key('入口烟测会话');
  await key('\r'); await waitFor('确认恢复归档');
  await key('\x1b[A'); await key('\r'); await waitFor('已恢复归档；请用/resume选择会话');
  await command('/about', 'apps');
  complete = true; await key('\x04');
} catch (error) { process.stderr.write(`[session-smoke] FAIL ${error.message}\n`); originalExit(97); }

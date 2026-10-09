import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 真实 CLI 的黑盒验收：提示一律走 stderr，stdout 的制表符行与 JSON 一个字都不许多。
// 轮换、冷却、隐藏都是跨会话状态，所以同一组断言必须跑在同一个用户设置目录里。
const exe = path.resolve(process.env.SACODE_CLI || fileURLToPath(new URL('../target/release/bin/main.exe', import.meta.url)));
const dllPath = [
  process.env.SACODE_STDX_DLL_DIR || 'C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx',
  process.env.SACODE_RUNTIME_DLL_DIR || 'D:/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative',
];

async function run(settings, args, extra = {}) {
  const cwd = settings ? path.join(settings, '..') : await mkdtemp(path.join(tmpdir(), 'sacode-tips-cli-'));
  const env = { ...process.env };
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = [...dllPath, env[pathKey]].join(path.delimiter);
  if (settings) env.SACODE_USER_SETTINGS_DIR = settings; else delete env.SACODE_USER_SETTINGS_DIR;
  delete env.SACODE_TIPS;
  delete env.SACODE_ACCESSIBILITY;
  for (const [key, value] of Object.entries(extra)) {
    if (value === null) delete env[key]; else env[key] = value;
  }
  const result = await new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('真实 CLI 超时')); }, 20000);
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
  });
  assert.equal(result.signal, null, result.stderr);
  return {
    ...result,
    tipLines: stderr.split('\n').filter(line => line.startsWith('tip\t')),
    tips: stderr.split('\n').filter(line => line.startsWith('tip\t')).length,
  };
}

async function withSettings(body) {
  const root = await mkdtemp(path.join(tmpdir(), 'sacode-tips-cli-'));
  const settings = path.join(root, 'user-settings');
  try { return await body({ root, settings }); } finally { await rm(root, { recursive: true, force: true }); }
}

test('面向人的子命令把提示写到 stderr，stdout 保持原样', () => withSettings(async ({ settings }) => {
  const plain = await run(settings, ['tools']);
  assert.equal(plain.code, 0, plain.stderr);
  assert.ok(plain.stdout.split('\n').filter(Boolean).every(line => line.startsWith('tool\t')), '工具清单的 stdout 格式不得被提示改动');
  assert.equal(plain.tips, 1, `真人在终端前应看到一条提示（stderr=${JSON.stringify(plain.stderr)}）`);

  const json = await run(settings, ['tools', '--json']);
  assert.equal(json.code, 0, json.stderr);
  assert.match(json.stdout.trim(), /^[{[]/, 'JSON 模式 stdout 仍是单个 JSON 值');
  assert.equal(json.tips, 0, '机器输出模式不得出提示');
}));

test('自测与协议模式全程静默', () => withSettings(async ({ settings }) => {
  // sig 需要真人按 Ctrl+C，本机投递不通，不放进这条黑盒断言里。
  for (const mode of ['projection', 'seed', 'headless']) {
    const result = await run(settings, [mode]);
    assert.equal(result.tips, 0, `${mode} 不该出提示（stderr=${JSON.stringify(result.stderr.slice(0, 120))}）`);
    assert.ok(!result.stdout.includes('tip\t'), `${mode} 的 stdout 混入了提示`);
  }
}));

test('显式关闭与无障碍声明都不出提示，且不消耗轮换', () => withSettings(async ({ settings }) => {
  assert.equal((await run(settings, ['tools'], { SACODE_TIPS: '0' })).tips, 0);
  const before = await run(settings, ['tips']);
  assert.equal(before.tips, 1);
  const quiet = await run(settings, ['tips'], { SACODE_ACCESSIBILITY: '1' });
  assert.equal(quiet.tips, 0, '读屏声明下取提示必须空手');
  const after = await run(settings, ['tips']);
  assert.notEqual(after.tipLines[0], before.tipLines[0], '空手而归不该占掉这条轮换位');
}));

test('hide 让两个子命令一起停，show 立刻恢复，且状态跨进程留存', () => withSettings(async ({ settings }) => {
  const first = await run(settings, ['tips']);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.tipLines.length, 1);
  const second = await run(settings, ['tips']);
  assert.notEqual(second.tipLines[0], first.tipLines[0], '同一份历史里连续两次取到同一条就不算轮换');

  const hidden = await run(settings, ['tips', 'hide']);
  assert.equal(hidden.code, 0, hidden.stderr);
  assert.match(hidden.stderr, /tips\thidden=true\tchanged=true/);
  assert.equal((await run(settings, ['tips'])).tips, 0, '隐藏后不得再出提示');
  assert.equal((await run(settings, ['tools'])).tips, 0, '隐藏开关对另一个子命令同样生效');
  const again = await run(settings, ['tips', 'hide']);
  assert.match(again.stderr, /tips\thidden=true\tchanged=false/, '重复隐藏不该报成已改');

  const shown = await run(settings, ['tips', 'show']);
  assert.match(shown.stderr, /tips\thidden=false\tchanged=true/);
  assert.equal((await run(settings, ['tools'])).tips, 1, '重新打开立刻恢复');
}));

test('非法子命令用法回退出码 64 且不写历史', () => withSettings(async ({ settings }) => {
  const bad = await run(settings, ['tips', 'sideways']);
  assert.equal(bad.code, 64);
  assert.match(bad.stderr, /usage: sacode tips/);
  assert.equal(bad.tips, 0);
}));

test('提示历史落在独立文件，绝不写会话日志', () => withSettings(async ({ root, settings }) => {
  const result = await run(settings, ['tips']);
  assert.equal(result.code, 0, result.stderr);
  const { readdir } = await import('node:fs/promises');
  const outer = await readdir(root);
  assert.ok(!outer.includes('session.log'), `取提示不得创建会话日志（${JSON.stringify(outer)}）`);
  assert.ok(outer.includes('user-settings'), '用户设置目录应由核心建出来');
  const history = await readdir(settings);
  assert.ok(history.includes('tips-history.log'), `展示历史应落在用户设置目录（${JSON.stringify(history)}）`);
  assert.ok(!history.includes('user-settings.log'), '提醒历史不能混进外观配置');
}));

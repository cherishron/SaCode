import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// 必须显式传入本轮编译产物，不回退到旧 release 二进制。
const exe = process.env.SACODE_BATCH_TEST_EXE;
assert.ok(exe, '必须设置 SACODE_BATCH_TEST_EXE 为本轮 CLI 产物');
function fixture(t) {
  const root = mkdtempSync(join(process.env.TMP || tmpdir(), 'batch-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const settings = { batch: { model: 'qwen', authType: 'openai', baseUrl: 'https://example.com/v1', credentialRef: 'DASHSCOPE_API_KEY' }, env: { DASHSCOPE_API_KEY: '测试密钥不可输出' } };
  const plan = { task: '翻译中文😀', inputs: ['源.txt'], outputDir: 'docs/en', maxOutputTokens: 100, maxCostUsd: 2, thinking_budget: 0 };
  writeFileSync(join(root, 'settings.json'), JSON.stringify(settings));
  writeFileSync(join(root, '源.txt'), '正文😀\0tail');
  writeFileSync(join(root, 'plan.json'), JSON.stringify(plan));
  const env = { ...process.env, TMP: root, TEMP: root, SACODE_BATCH_HOME: join(root, 'batch'), SACODE_BATCH_CONFIG: join(root, 'settings.json'), QWEN_BATCH_INPUT_PRICE_PER_1M_USD: '', QWEN_BATCH_OUTPUT_PRICE_PER_1M_USD: '' };
  const run = (...args) => {
    const result = spawnSync(resolve(exe), ['batch', ...args], { cwd: root, env, encoding: 'utf8', timeout: 15000 });
    assert.ifError(result.error);
    assert.ok(!result.signal, `进程异常终止: ${result.signal}`);
    return result;
  };
  return { root, settings, plan, env, run };
}
test('batch check 独立配置、下划线引用与无密钥泄漏', t => {
  const f = fixture(t); const r = f.run('check');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).credentialRef, 'DASHSCOPE_API_KEY');
  assert.ok(!r.stdout.includes('测试密钥'));
  rmSync(join(f.root, 'settings.json'));
  assert.notEqual(f.run('check').status, 0);
});
test('batch run 接收计划路径、Unicode 无损、稳定快照且不创建任务', t => {
  const f = fixture(t); const a = f.run('run', 'plan.json', '--dry-run');
  assert.equal(a.status, 0, a.stderr); const p = JSON.parse(a.stdout);
  assert.equal(p.plan.task, f.plan.task); assert.equal(p.inputs[0].content, '正文😀\0tail');
  assert.equal(p.costEstimateUsd, null); assert.equal(p.submitted, false);
  assert.equal(f.run('run', 'plan.json', '--dry-run').stdout, a.stdout);
  assert.equal(existsSync(join(f.root, 'batch')), false);
  assert.deepEqual(JSON.parse(f.run('list').stdout), []);
  assert.notEqual(f.run('run', '翻译自然语言', '--dry-run').status, 0);
});
test('batch expect 捕获原计划、输入路径、内容和配置变化', t => {
  const f = fixture(t); let r = f.run('run', 'plan.json', '--dry-run');
  assert.equal(r.status, 0, r.stderr); let snapshot = JSON.parse(r.stdout).snapshot;
  writeFileSync(join(f.root, 'plan.json'), JSON.stringify(f.plan) + ' ');
  assert.match(f.run('run', 'plan.json', '--dry-run', '--expect', snapshot).stderr, /snapshot-mismatch/);
  snapshot = JSON.parse(f.run('run', 'plan.json', '--dry-run').stdout).snapshot;
  writeFileSync(join(f.root, '同内容.txt'), readFileSync(join(f.root, '源.txt'))); f.plan.inputs = ['同内容.txt'];
  writeFileSync(join(f.root, 'plan.json'), JSON.stringify(f.plan));
  assert.match(f.run('run', 'plan.json', '--dry-run', '--expect', snapshot).stderr, /snapshot-mismatch/);
  snapshot = JSON.parse(f.run('run', 'plan.json', '--dry-run').stdout).snapshot;
  writeFileSync(join(f.root, '同内容.txt'), '改变');
  assert.match(f.run('run', 'plan.json', '--dry-run', '--expect', snapshot).stderr, /snapshot-mismatch/);
  snapshot = JSON.parse(f.run('run', 'plan.json', '--dry-run').stdout).snapshot;
  f.settings.batch.model = 'other'; writeFileSync(join(f.root, 'settings.json'), JSON.stringify(f.settings));
  assert.match(f.run('run', 'plan.json', '--dry-run', '--expect', snapshot).stderr, /snapshot-mismatch/);
});
test('batch 远端四动作非零 BLOCKED 且不造任务', t => {
  const f = fixture(t);
  for (const args of [['run', 'plan.json'], ['collect', 'task-1', '--wait', '--timeout', '1'], ['retry', 'task-1', '--max-output-tokens', '200'], ['cancel', 'task-1']]) {
    const r = f.run(...args); assert.notEqual(r.status, 0); assert.match(r.stderr, /BLOCKED/);
    assert.ok(!r.stdout.includes('success')); assert.equal(existsSync(join(f.root, 'batch')), false);
  }
});
test('batch 所有任务动作阻止穿越，clean 仅删本地且需 force', t => {
  const f = fixture(t); const directory = join(f.root, 'batch/tasks/task-1'); mkdirSync(directory, { recursive: true });
  const record = { id: 'task-1', status: 'submitted', createdAt: '2026-10-08T00:00:00Z', providerJobId: '真实已有记录' };
  writeFileSync(join(directory, 'task.json'), JSON.stringify(record));
  writeFileSync(join(f.root, 'remote-sentinel'), '不准删除');
  assert.equal(f.run('list').status, 0); assert.deepEqual(JSON.parse(f.run('list').stdout), [record]);
  for (const action of ['clean', 'cancel', 'collect', 'retry']) for (const id of ['../outside', 'a/b', 'a\\b', '.hidden', 'CON']) {
    const r = f.run(action, id, ...(action === 'clean' ? ['--force'] : []));
    assert.notEqual(r.status, 0); assert.match(r.stderr, /task-id-invalid/);
  }
  assert.notEqual(f.run('clean', 'task-1').status, 0); assert.equal(existsSync(directory), true);
  assert.equal(f.run('clean', 'task-1', '--force').status, 0); assert.equal(existsSync(directory), false);
  assert.equal(readFileSync(join(f.root, 'remote-sentinel'), 'utf8'), '不准删除');
});
test('batch 输出项目边界与隐藏目录拒绝', t => {
  const f = fixture(t);
  for (const output of ['../escape', '.secret', 'docs/.secret', 'C:/escape', 'docs/../escape']) {
    f.plan.outputDir = output; writeFileSync(join(f.root, 'plan.json'), JSON.stringify(f.plan));
    assert.notEqual(f.run('run', 'plan.json', '--dry-run').status, 0);
  }
});
test('batch 上游 provider 配置形状与缺凭证、OAuth、responses 拒绝', t => {
  const f = fixture(t);
  f.settings.batch = { model: 'qwen', authType: 'openai' };
  f.settings.modelProviders = { openai: [{ id: 'qwen', envKey: 'DASHSCOPE_API_KEY', baseUrl: 'https://example.com/v1' }] };
  writeFileSync(join(f.root, 'settings.json'), JSON.stringify(f.settings));
  assert.equal(f.run('check').status, 0);
  f.settings.modelProviders.openai[0].wireApi = 'responses'; writeFileSync(join(f.root, 'settings.json'), JSON.stringify(f.settings));
  assert.notEqual(f.run('check').status, 0);
  delete f.settings.modelProviders.openai[0].wireApi; f.settings.batch.authType = 'oauth';
  writeFileSync(join(f.root, 'settings.json'), JSON.stringify(f.settings)); assert.notEqual(f.run('check').status, 0);
  f.settings.batch.authType = 'openai'; f.settings.modelProviders.openai[0].envKey = 'BATCH_P0_NEVER_SET';
  writeFileSync(join(f.root, 'settings.json'), JSON.stringify(f.settings)); assert.notEqual(f.run('check').status, 0);
});

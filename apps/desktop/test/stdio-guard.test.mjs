import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const guard = fileURLToPath(new URL('../stdio-guard.cjs', import.meta.url));

function run(code, disconnect = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('子进程未按时退出')); }, 10000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (disconnect) child.stdout.destroy();
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => { clearTimeout(timeout); resolve({ code, stdout, stderr }); });
  });
}

test('标准输出管道断开后仍正常退出，并继续向标准错误写诊断', async () => {
  const result = await run(`
    require(${JSON.stringify(guard)}).installStdioGuard();
    process.stdout.write('ready\\n');
    setTimeout(() => {
      process.stdout.write('after disconnect\\n', (error) => {
        process.stderr.write(error ? error.code : 'NO_ERROR');
        setTimeout(() => process.exit(error?.code === 'EPIPE' ? 0 : 2), 20);
      });
    }, 200);
  `, true);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, 'EPIPE');
});

test('正常输出和非管道错误不会被吞掉', async () => {
  const normal = await run(`require(${JSON.stringify(guard)}).installStdioGuard(); console.log('正常日志'); console.error('诊断');`);
  assert.equal(normal.code, 0);
  assert.match(normal.stdout, /正常日志/);
  assert.match(normal.stderr, /诊断/);
  const failed = await run(`require(${JSON.stringify(guard)}).installStdioGuard(); process.stdout.emit('error', Object.assign(new Error('unexpected'), {code:'EIO'}));`);
  assert.notEqual(failed.code, 0);
  assert.match(failed.stderr, /unexpected/);
});

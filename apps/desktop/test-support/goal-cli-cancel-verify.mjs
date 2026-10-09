import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fixtureHostEnv } from './fixture-env.mjs';
const exe = resolve(process.env.SACODE_CLI || '');
assert.ok(process.env.SACODE_CLI && existsSync(exe));
const root = mkdtempSync(resolve('apps/desktop/.tmp-test/goal-cli-cancel-'));
const result = { root, requests: [] };
const server = createServer(async (req, res) => {
  let text = ''; for await (const b of req) text += b;
  result.requests.push(JSON.parse(text));
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write('data: {"choices":[{"index":0,"delta":{"content":"signal-ready"}}]}\n\n');
  writeFileSync(join(root, 'request-ready'), 'true');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const env = fixtureHostEnv(root, { PATH: join(process.env.SystemRoot, 'System32'), TMP: root, TEMP: root,
  SACODE_PROVIDER_BASE_URL: `http://127.0.0.1:${server.address().port}/v1/chat/completions`, SACODE_PROVIDER_MODEL: 'local-signal-goal' });
async function run(file, args) {
  const child = spawn(file, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
  return await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code, signal) => resolve({ code, signal, stdout, stderr })); });
}
try {
  const driver = await run(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve(import.meta.dirname, 'goal-cli-signal.ps1'), '-Exe', exe, '-WorkDir', root]);
  result.driver = driver;
  result.signal = JSON.parse(readFileSync(join(root, 'signal-result.json'), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(driver.code, 0); assert.equal(result.signal.passed, true); assert.equal(result.signal.forcedCleanup, false);
  assert.equal(result.signal.exitCode, 130); assert.equal(result.requests.length, 1);
  assert.ok(result.signal.elapsedMs < 5000, `取消到退出超出 5 秒：${result.signal.elapsedMs}ms`);
  assert.equal(existsSync(join(root, 'session.log.lease')), false);
  const read = await run(exe, ['goal', 'describe']); result.describe = read;
  assert.equal(read.code, 0); assert.equal(JSON.parse(read.stdout.trim()).phase, 'active');
  assert.equal(result.requests.length, 1, '恢复读取不能重新发模型请求');
  result.passed = true; console.log('GOAL_CLI_CANCEL_PASS');
} finally {
  server.closeAllConnections(); await new Promise(r => server.close(r));
  writeFileSync(join(root, 'result.json'), JSON.stringify(result, null, 2));
  console.log('GOAL_CLI_CANCEL_EVIDENCE=' + root);
}

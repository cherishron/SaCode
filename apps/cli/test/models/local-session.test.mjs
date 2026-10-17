// CLI普通会话黑盒：隔离环境、本地服务，不读取真实提供方配置。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '../../../..');
async function runCli(exe, args, cwd, env) {
  const child = spawn(exe, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
  const timer = setTimeout(() => child.kill(), 8000);
  try {
    const [code] = await once(child, 'close');
    assert.equal(code, 0, `CLI退出失败：${err.slice(0, 200)}`);
    return JSON.parse(out.trim());
  } finally { clearTimeout(timer); }
}
test('CLI普通会话：实际请求无工具schema，恢复保留上下文', { timeout: 25000 }, async () => {
  assert.ok(process.env.SACODE_CLI, '必须显式指定本轮CLI产物');
  const requests = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    requests.push(JSON.parse(raw));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: '+JSON.stringify({ choices: [{ index: 0, delta: { content: 'CLI本地答复' }, finish_reason: 'stop' }] })+'\n\ndata: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = join(root, 'target/tmp/cli-model-verification'); mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'run-'));
  const env = {};
  for (const [k,v] of Object.entries(process.env)) if (['path','systemroot','windir','temp','tmp'].includes(k.toLowerCase())) env[k] = v;
  Object.assign(env, { SACODE_PROVIDER_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, SACODE_PROVIDER_MODEL: 'cli-synthetic', SACODE_PROVIDER_KEY: 'invalid-local-only', SACODE_USER_SETTINGS_DIR: join(dir, 'settings') });
  try {
    const exe = resolve(process.env.SACODE_CLI);
    const first = await runCli(exe, ['--resume', 'current', '--json', '第一条合成消息'], dir, env);
    assert.equal(first.reply, 'CLI本地答复');
    const second = await runCli(exe, ['--resume', 'current', '--json', '第二条合成消息'], dir, env);
    assert.equal(second.reply, 'CLI本地答复'); assert.equal(requests.length, 2);
    assert.equal(requests[0].model, 'cli-synthetic');
    assert.equal(Object.hasOwn(requests[0], 'tools'), false);
    assert.ok(requests[1].messages.some(m => m.role === 'user' && m.content === '第一条合成消息'));
    assert.ok(requests[1].messages.some(m => m.role === 'assistant' && m.content === 'CLI本地答复'));
  } finally {
    await new Promise(r => { server.closeAllConnections(); server.close(r); });
    assert.equal(resolve(dir, '..'), resolve(base));
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

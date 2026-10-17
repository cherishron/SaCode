import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
test('匹配SDK探针：Client.close唤醒阻塞body.read并join原Reader', { timeout: 10000 }, async () => {
  assert.ok(process.env.SACODE_CLOSE_PROBE);
  let disconnected = false;
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: first\n\n');
    res.on('close', () => { disconnected = true; });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const env = {};
  for (const [k,v] of Object.entries(process.env)) if (['path','systemroot','windir','temp','tmp'].includes(k.toLowerCase())) env[k] = v;
  env.SACODE_CLOSE_PROBE_URL = `http://127.0.0.1:${server.address().port}/`;
  const child = spawn(resolve(process.env.SACODE_CLOSE_PROBE), [], { env, stdio: ['ignore','pipe','pipe'] });
  let out = '', err = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
  const timer = setTimeout(() => child.kill(), 5000);
  try {
    const [code] = await once(child, 'close');
    assert.equal(code, 0, `探针阶段：${out}；诊断：${err.slice(0, 1500)}`); assert.match(out, /reader-joined/);
    assert.equal(disconnected, true);
  } finally {
    clearTimeout(timer); if (child.exitCode === null) child.kill();
    server.closeAllConnections(); await new Promise(r => server.close(r));
  }
});

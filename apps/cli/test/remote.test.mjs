import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const exe = path.resolve(process.env.SACODE_CLI || 'D:/Project/sa/saai/sa-code/apps/cli/target/release/bin/main.exe');
const env = { ...process.env };
const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
env[pathKey] = [process.env.SACODE_STDX_DLL_DIR || 'C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx', process.env.SACODE_RUNTIME_DLL_DIR || 'D:/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative', env[pathKey]].join(path.delimiter);
// 错误代理必须被忽略；请求仍需到达随机 loopback 端口。
env.http_proxy = env.HTTP_PROXY = 'http://127.0.0.1:1';

async function run(args, onOutput) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'sacode-d3-'));
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(exe, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('CLI 超时')); }, 12000);
      child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); onOutput?.(stdout); });
      child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
    });
    assert.equal(result.signal, null, result.stderr);
    assert.deepEqual(await readdir(cwd), [], '远程入口不得写本地会话或退回本地 agent');
    return result;
  } finally { await rm(cwd, { recursive: true, force: true }); }
}

async function fixture(handler, body) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await body(String(server.address().port)); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

async function rpcFixture(reply, body) {
  const seen = [];
  return fixture(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    seen.push({ url: req.url, method: req.method, type: req.headers['content-type'], json: JSON.parse(text) });
    res.writeHead(reply.status || 200, { 'Content-Type': 'application/json', ...(reply.headers || {}) });
    res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
  }, port => body(port, seen));
}

// 破坏请求构造、默认方法、参数透传或响应验证，分别由真实网络边界断言捕获。
test('RPC 成功透传嵌套参数且请求为 JSON-RPC id=1', async () => {
  await rpcFixture({ body: { jsonrpc: '2.0', id: 1, result: { text: '你好', nested: [1, null] } } }, async (port, seen) => {
    const r = await run(['--remote', port, 'rpc', 'session/catalog', '{"nested":{"x":[1,true]}}']);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { jsonrpc: '2.0', id: 1, result: { text: '你好', nested: [1, null] } });
    assert.equal(r.stderr, '');
    assert.deepEqual(seen, [{ url: '/rpc', method: 'POST', type: 'application/json', json: { jsonrpc: '2.0', id: 1, method: 'session/catalog', params: { nested: { x: [1, true] } } } }]);
  });
});

test('无子命令默认 initialize', async () => {
  await rpcFixture({ body: { jsonrpc: '2.0', id: 1, result: null } }, async (port, seen) => {
    const r = await run(['--remote', port]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(seen[0].json.method, 'initialize');
    assert.deepEqual(seen[0].json.params, {});
    assert.equal(JSON.parse(r.stdout).result, null);
  });
});

test('RPC error 保留完整错误结构并非零退出', async () => {
  const response = { jsonrpc: '2.0', id: 1, error: { code: -32601, message: '未实现', data: { method: 'ghost' } } };
  await rpcFixture({ body: response }, async port => {
    const r = await run(['--remote', port, 'rpc', 'ghost']);
    assert.notEqual(r.code, 0);
    assert.deepEqual(JSON.parse(r.stdout), response);
    assert.match(r.stderr, /remote/);
  });
});

for (const [name, reply] of [
  ['错误ID', { body: { jsonrpc: '2.0', id: 2, result: {} } }],
  ['字符串ID', { body: { jsonrpc: '2.0', id: '1', result: {} } }],
  ['错误版本', { body: { jsonrpc: '1.0', id: 1, result: {} } }],
  ['缺少result和error', { body: { jsonrpc: '2.0', id: 1 } }],
  ['result和error并存', { body: { jsonrpc: '2.0', id: 1, result: {}, error: {} } }],
  ['坏JSON', { body: '{broken' }],
  ['HTTP失败', { status: 503, body: 'unavailable' }],
  ['禁止重定向', { status: 302, headers: { Location: 'http://example.invalid/' }, body: '' }],
  ['超大RPC响应', { body: 'x'.repeat(1048577) }],
]) test(`RPC 拒绝${name}`, async () => {
  await rpcFixture(reply, async (port, seen) => {
    const r = await run(['--remote', port, 'rpc', 'initialize']);
    assert.notEqual(r.code, 0);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /remote/);
    assert.equal(seen.length, 1);
  });
});

for (const args of [
  ['--remote'], ['--remote', '0'], ['--remote', '65536'], ['--remote', '-1'],
  ['--remote', 'abc'], ['--remote', '127.0.0.1:80'], ['--remote', '+80'], ['--remote', '80.0'],
  ['--remote', '80', '--remote', '81'], ['tools', '--remote', '80'],
  ['--remote', '80', 'rpc'], ['--remote', '80', 'rpc', ''],
  ['--remote', '80', 'rpc', '--json'], ['--remote', '80', 'rpc', 'x', '{broken'],
  ['--remote', '80', 'rpc', 'x', 'null'], ['--remote', '80', 'rpc', 'x', '{}', 'extra'],
  ['--remote', '80', 'subscribe', 'extra'], ['--remote', '80', 'unknown'],
]) test(`非法远程参数返回64: ${JSON.stringify(args)}`, async () => {
  const r = await run(args);
  assert.equal(r.code, 64);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /--remote/);
});

test('拒绝连接返回网络错误而非本地fallback', async () => {
  let port;
  await fixture((_req, res) => res.end(), async p => { port = p; });
  const r = await run(['--remote', port, 'rpc', 'initialize']);
  assert.notEqual(r.code, 0);
  assert.notEqual(r.code, 64);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /remote/);
});

test('SSE 跨块中文、多data行CRLF、忽略注释且在EOF前输出', async () => {
  let response, requests = 0, published = false;
  await fixture(async (req, res) => {
    requests++;
    assert.equal(req.url, '/sse'); assert.equal(req.method, 'GET');
    assert.equal(req.headers.accept, 'text/event-stream');
    response = res;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const bytes = Buffer.from(': keepalive\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0",\r\ndata: "method":"session/event","params":{"text":"中文"}}\r\n\r\n');
    const split = bytes.indexOf(Buffer.from('中')) + 1;
    res.write(bytes.subarray(0, split));
    await new Promise(resolve => setTimeout(resolve, 15));
    res.write(bytes.subarray(split));
  }, async port => {
    const r = await run(['--remote', port, 'subscribe'], stdout => {
      if (!published && stdout.includes('\n')) { published = true; response.end('data: {"jsonrpc":"2.0","method":"unfinished"}'); }
    });
    assert.equal(published, true, '必须在连接仍开放时交付通知');
    assert.notEqual(r.code, 0); assert.match(r.stderr, /remote/);
    assert.deepEqual(r.stdout.trim().split('\n').map(JSON.parse), [{ jsonrpc: '2.0', method: 'session/event', params: { text: '中文' } }]);
    assert.equal(requests, 1, '不得自动重连');
  });
});

for (const [name, content, status, type] of [
  ['坏JSON', 'data: {broken\n\n', 200, 'text/event-stream'],
  ['非通知', 'data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n', 200, 'text/event-stream'],
  ['错误版本', 'data: {"jsonrpc":"1.0","method":"event"}\n\n', 200, 'text/event-stream'],
  ['非字符串method', 'data: {"jsonrpc":"2.0","method":1}\n\n', 200, 'text/event-stream'],
  ['超大帧', 'data: ' + 'x'.repeat(1048577), 200, 'text/event-stream'],
  ['空流EOF', '', 200, 'text/event-stream'],
  ['HTTP失败', '', 500, 'text/event-stream'],
  ['错误媒体类型', 'data: {}\n\n', 200, 'application/json'],
]) test(`SSE ${name}不输出伪通知并非零退出`, async () => {
  await fixture((_req, res) => { res.writeHead(status, { 'Content-Type': type }); res.end(content); }, async port => {
    const r = await run(['--remote', port, 'subscribe']);
    assert.notEqual(r.code, 0); assert.equal(r.stdout, ''); assert.match(r.stderr, /remote/);
  });
});

test('SSE 对端中途断连丢弃未完成帧', async () => {
  await fixture((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"jsonrpc":"2.0","method":"unfinished"}');
    setTimeout(() => res.destroy(), 20);
  }, async port => {
    const r = await run(['--remote', port, 'subscribe']);
    assert.notEqual(r.code, 0); assert.equal(r.stdout, ''); assert.match(r.stderr, /remote/);
  });
});

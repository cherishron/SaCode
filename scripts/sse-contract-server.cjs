'use strict';
// 仅本机契约夹具；临时非生产证书，不修改系统信任库。
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-sse-contract-'));
let targetHits = 0;
let credentialHits = 0;
const sockets = new Set();
const timers = new Set();
const servers = [];
// 启动/测试失控也不能留下服务；正常退出会撤销此看门狗。
const watchdog = setTimeout(() => process.exit(2), 20000);
function later(fn, ms) { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); }
function track(server) {
  servers.push(server);
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  return new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
}
function frame(text) { return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`; }
function longExpected(i) {
  const c = { kind: 'text', text: `第${i}帧\n"中文" data: \\尾\t`, reason: '', choiceIndex: 0, toolIndex: null, toolId: null, toolName: null };
  if (i < 4) {
    c.kind = 'tool-call-delta'; c.toolIndex = i % 2;
    c.text = i < 2 ? '{"路径":"' : `中文${i % 2}\\目录\\n data: ","值":1}`;
    if (i < 2) { c.toolId = `call-${i}`; c.toolName = i === 0 ? 'read' : 'write'; }
  } else if (i === 10004) { c.kind = 'usage'; c.text = '12345'; c.choiceIndex = null; }
  else if (i === 10005) { c.kind = 'finish'; c.text = ''; c.reason = 'tool_calls'; }
  return c;
}
function longWire(i) {
  // 与期望记录分开构造 SSE；不调用被测序列化器。
  if (i < 4) {
    const tool = { index: i % 2, function: { arguments: i < 2 ? '{"路径":"' : `中文${i % 2}\\目录\\n data: ","值":1}` } };
    if (i < 2) { tool.id = `call-${i}`; tool.function.name = i === 0 ? 'read' : 'write'; }
    return { choices: [{ index: 0, delta: { tool_calls: [tool] } }] };
  }
  if (i === 10004) return { usage: { total_tokens: 12345 } };
  if (i === 10005) return { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] };
  return { choices: [{ index: 0, delta: { content: `第${i}帧\n"中文" data: \\尾\t` } }] };
}
function handler(req, res) {
  req.resume();
  const route = req.url.split('/')[1];
  if (route === 'long-expected') {
    res.setHeader('Content-Type', 'application/x-ndjson');
    for (let i = 0; i < 10006; i++) res.write(JSON.stringify(longExpected(i)) + '\n');
    res.end(); return;
  }
  if (route === 'long') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    let i = 0;
    function pump() {
      while (i < 10006) {
        if (!res.write(`data: ${JSON.stringify(longWire(i++))}\n\n`)) { res.once('drain', pump); return; }
      }
      res.end('data: [DONE]\n\n');
    }
    pump(); return;
  }
  if (route === 'stats') { res.end(`${targetHits},${credentialHits}`); return; }
  if (route === 'target') { targetHits++; if (req.headers.authorization) credentialHits++; res.end('target'); return; }
  if (route === 'redirect') { res.writeHead(307, { Location: `http://127.0.0.1:${target.address().port}/target` }); res.end('private response'); return; }
  if (['401', '429', '500'].includes(route)) { res.writeHead(Number(route)); res.end('private response Bearer fixture-only'); return; }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  res.write(frame('first'));
  if (route === 'stall') { later(() => { res.end(frame('late')); }, 5000); return; }
  if (route === 'cancel') { later(() => { res.end(frame('late')); }, 1500); return; }
  if (route === 'disconnect') { later(() => res.destroy(), 150); return; }
  res.end('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":22}}\n\ndata: [DONE]\n\n');
}
const target = http.createServer(handler);
const plain = http.createServer(handler);
function cleanup() {
  clearTimeout(watchdog);
  for (const t of timers) clearTimeout(t);
  for (const s of sockets) s.destroy();
  for (const s of servers) s.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
process.on('exit', cleanup);
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.stdin.resume();
process.stdin.on('data', () => process.exit(0));
process.stdin.on('end', () => process.exit(0));
(async () => {
  try {
    const openssl = process.env.SSE_OPENSSL || 'openssl';
    execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { stdio: 'ignore', timeout: 10000 });
    const secure = https.createServer({ key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) }, handler);
    await track(target); await track(plain); await track(secure);
    process.stdout.write(`${plain.address().port}\n${secure.address().port}\n`);
  } catch (_) { process.stderr.write('本机 SSE 夹具启动失败（需 openssl，或设置 SSE_OPENSSL）\n'); process.exit(1); }
})();

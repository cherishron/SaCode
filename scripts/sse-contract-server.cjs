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
let toolTurns = 0;
const sockets = new Set();
const timers = new Set();
const servers = [];
// 启动/测试失控也不能留下服务；正常退出会撤销此看门狗。
// 默认仍是 20 秒硬时限；需要跨多轮停滞路由的夹具（金路径）自己声明更长的预算，
// 不能靠「碰运气没超时」通过，也不能悄悄把默认值抬高。
// 声明通道有两个，优先级是命令行 > 环境变量：核心单测里最长的 SSE 用例实测要 23.45 秒，
// 在 20 秒硬时限上必然赌运气（真红过一次：夹具中途 exit(2)，后续连接 10061 被拒），
// 而仓颉侧的 launch 传不了子进程环境变量，所以命令行也得能用。
const watchdogArg = process.argv.indexOf('--watchdog-ms');
const watchdogMs = Number(watchdogArg > 0 ? process.argv[watchdogArg + 1] : (process.env.SSE_WATCHDOG_MS || '20000'));
const watchdog = setTimeout(() => process.exit(2), watchdogMs);
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
  const route = req.url.split('/')[1];
  if (route === 'vision') {
    // 「附件到底有没有到 provider」只有 provider 侧能证：把收到的请求体里
    // 真正的 image_url part 数原样回声进答复，装配点没物化就是 0。
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      let parts = -1;
      let messages = -1;
      let textChars = 0;
      try {
        const parsed = JSON.parse(raw);
        messages = (parsed.messages || []).length;
        parts = 0;
        for (const m of parsed.messages || []) {
          if (!Array.isArray(m.content)) continue;
          for (const p of m.content) {
            if (p && p.type === 'text') textChars += (p.text || '').length;
            if (p && p.type === 'image_url' && p.image_url && typeof p.image_url.url === 'string' && p.image_url.url.startsWith('data:image/')) parts += 1;
          }
        }
      } catch (e) { /* 保持 -1：请求体不是合法 JSON 也要能被断言发现 */ }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(frame(`vision parts=${parts} messages=${messages} text=${textChars}`));
      res.end('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":3}}\n\ndata: [DONE]\n\n');
    });
    return;
  }
  // 增强这条车道的请求形状同样只有 provider 侧能证：把收到的请求体形状原样回声，
  // 多带一条会话历史、多出一个 tools、或草稿被改写了，都会在这条回文里露出来。
  // 必须排在 req.resume() 之前——resume 会把正文吃掉。
  if (route === 'enhance') {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      let model = '';
      let messages = -1;
      let tools = -1;
      let draft = '';
      try {
        const parsed = JSON.parse(raw);
        model = parsed.model || '';
        const list = parsed.messages || [];
        messages = list.length;
        tools = Array.isArray(parsed.tools) ? parsed.tools.length : 0;
        draft = list.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : '')).join('|');
      } catch (e) { /* 请求体不是合法 JSON 时保持默认值，让断言看得见 */ }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(frame(`model=${model} messages=${messages} tools=${tools} draft=${draft}`));
      res.end('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":22}}\n\ndata: [DONE]\n\n');
    });
    return;
  }
  req.resume();
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
  // 断言 53 的专用夹具：429 且响应头里**真有** Retry-After。
  // 常量注入不算那条的绿——必须走真实响应头这条通路。
  if (route === 'quota') { res.writeHead(429, { 'Retry-After': '42' }); res.end('private response Bearer fixture-only'); return; }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  if (route === 'tools') {
    // 步边界夹具：第一次请求先出一段正文再拖 1.5 秒抛 todo_write 工具调用，
    // 给调用方留出「运行中排队 + 即时补充」的窗口；第二次请求也拖 1.2 秒才收尾，
    // 否则摘取与送达全在毫秒内跑完，界面读到的已经是结算后的空闲态，
    // 「轮次还在跑、面板已经清空」这一条就没有可观察的时刻。
    toolTurns += 1;
    const first = toolTurns === 1;
    res.write(frame('tool-step-first'));
    later(() => {
      if (first) {
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-step', function: { name: 'todo_write', arguments: '{"todos":[{"content":"步边界","status":"in_progress"}]}' } }] } }] })}\n\n`);
        res.end('data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n');
        return;
      }
      res.end('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":7}}\n\ndata: [DONE]\n\n');
    }, first ? 1500 : 1200);
    return;
  }
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
// openssl 定位：SSE_OPENSSL 显式指定优先；其次从 PATH 上 git 的安装根推导
// （Git for Windows 自带 openssl，但它自己的 bin 目录按默认安装不进 PATH，
//  本机实测 `where openssl` 为空而 `D:\Program Files\Git\mingw64\bin\openssl.exe` 存在）；
// 再次扫一遍标准安装位置。仓颉侧 launch 传不了子进程环境变量，所以这层自愈
// 必须落在夹具内部——否则 9 条网络用例只能靠人工先设变量，否则整组 ERROR。
function resolveOnPath(name) {
  try {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(probe, [name], { encoding: 'utf8', timeout: 5000 });
    const first = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
    return first || null;
  } catch (_) { return null; }
}

function opensslCandidates() {
  const list = [];
  if (process.env.SSE_OPENSSL) list.push(process.env.SSE_OPENSSL);
  if (process.platform === 'win32') {
    try {
      const where = execFileSync('where', ['git'], { encoding: 'utf8', timeout: 5000 });
      for (const line of where.split(/\r?\n/)) {
        const found = line.trim();
        if (!found) continue;
        // <root>\cmd\git.exe 与 <root>\bin\git.exe 都上推两级拿到安装根
        const root = path.resolve(path.dirname(found), '..');
        list.push(path.join(root, 'mingw64', 'bin', 'openssl.exe'));
        list.push(path.join(root, 'usr', 'bin', 'openssl.exe'));
      }
    } catch (_) { /* git 不在 PATH 上就只走标准位置 */ }
    list.push(
      'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe',
      'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
      'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
      path.join(os.homedir(), 'scoop', 'apps', 'openssl', 'current', 'bin', 'openssl.exe'),
      'C:\\ProgramData\\chocolatey\\bin\\openssl.exe',
    );
  }
  return list;
}

function findOpenssl() {
  for (const candidate of opensslCandidates()) {
    if (fs.existsSync(candidate)) return { command: candidate, source: candidate };
  }
  // 裸名字（PATH 上的 openssl）最后才认：先查它是否真的解析得到，
  // 解析不到就返回 null，让调用方拿到「找不到」而不是一句 spawn ENOENT。
  const onPath = resolveOnPath('openssl');
  if (onPath) return { command: onPath, source: 'PATH' };
  return null;
}

(async () => {
  try {
    const openssl = findOpenssl();
    if (!openssl) throw new Error('openssl 未找到（SSE_OPENSSL 未设，PATH 与常见安装位置都没有）');
    execFileSync(openssl.command, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { stdio: 'ignore', timeout: 10000 });
    const secure = https.createServer({ key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) }, handler);
    await track(target); await track(plain); await track(secure);
    process.stdout.write(`${plain.address().port}\n${secure.address().port}\n`);
  } catch (e) {
    const why = e && e.message ? e.message : String(e);
    process.stderr.write(`本机 SSE 夹具启动失败：${why}（可用 SSE_OPENSSL 指定 openssl 可执行文件）\n`);
    process.exit(1);
  }
})();

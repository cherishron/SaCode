import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

// 批次 S：daemon 端点接收**非法 UTF-8 字节**时的行为（plan 第 181 行前半句「真实网络测试 UTF-8 分片」的最小可用面）。
// 客户端可以发任意字节流——Node 的 fetch 会把 latin1 字符串当 Buffer 送出去，
// 服务端如果把字节解码失败当成解析异常处理就会崩进程或把原始字节写进审计。
// 这一批只关心：不崩、错误结构化、审计与快照里没有原始非法字节。
//
// 分片这一半（TCP 半帧 / 慢流）留给网络栈自己：Node 的 http parser 已经
// 处理 Content-Length 分片、chunked 拼接。本批只钉住「解码失败」这一种，
// 不去测「chunked 中间断掉」——那是 stdx 的 http 层，不是本仓代码。
const root = path.resolve(import.meta.dirname, '../../..');
const daemonExe = process.env.SACODE_DAEMON || path.join(root, 'apps/daemon/target/release/bin/main.exe');
const policyFile = path.join(root, 'docs/plans/remote-capability-contract.json');
const baseEnv = { ...process.env };
const pathKey = Object.keys(baseEnv).find(k => k.toLowerCase() === 'path') || 'PATH';
baseEnv[pathKey] = [
  process.env.SACODE_STDX_DLL_DIR || 'C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx',
  process.env.SACODE_RUNTIME_DLL_DIR || 'D:/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative',
  baseEnv[pathKey],
].join(path.delimiter);

const delay = ms => new Promise(r => setTimeout(r, ms));

// 用 node:http 而不是 fetch：fetch 会把 latin1 body 强转成 UTF-8，字节被替换成 U+FFFD。
// 我们要发**原始字节**，让服务端自己面对非法 UTF-8。
function rawPost(port, path, buf, headers = {}) {
  return new Promise(resolve => {
    const req = http.request({
      host: '127.0.0.1', port, path, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': buf.length, ...headers },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const bodyBuf = Buffer.concat(chunks);
        let text = '';
        try { text = bodyBuf.toString('utf8'); } catch { text = `<non-utf8>`; }
        let json = null;
        try { json = JSON.parse(text); } catch { /* 交给断言去红 */ }
        resolve({ status: res.statusCode, text, json, body: bodyBuf });
      });
    });
    req.on('error', e => resolve({ error: e.message, status: 0, text: '', json: null, body: Buffer.alloc(0) }));
    req.end(buf);
  });
}

async function boot(cwd) {
  const proc = spawn(daemonExe, ['--port', '0'], {
    cwd,
    env: {
      ...baseEnv,
      SACODE_USER_SETTINGS_DIR: path.join(cwd, 'settings'),
      SACODE_REMOTE_ACCESS: '1',
      SACODE_REMOTE_IDENTITY: path.join(cwd, 'instance.id'),
      SACODE_REMOTE_POLICY: policyFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { err += d; });
  const closed = new Promise(resolve => proc.on('close', resolve));
  const end = Date.now() + 20000;
  while (!/127\.0\.0\.1:(\d+)/.test(out) && proc.exitCode === null && Date.now() < end) await delay(20);
  assert.match(out, /127\.0\.0\.1:(\d+)/, `daemon 未监听：stdout=${out} stderr=${err}`);
  const port = Number(out.match(/127\.0\.0\.1:(\d+)/)[1]);
  return {
    port, cwd, proc,
    auditFile: path.join(cwd, 'instance.id.audit.log'),
    stderr: () => err,
    stop: async () => {
      if (proc.exitCode !== null) return proc.exitCode;
      proc.kill('SIGKILL');
      await Promise.race([closed, delay(3000)]);
      return proc.exitCode;
    },
  };
}

async function readAudit(d) {
  if (!existsSync(d.auditFile)) return '';
  const text = await readFile(d.auditFile, 'utf8');
  return text.replace(/\r/g, '');
}

// 三种典型非法形状（UTF-8 spec §3）：
//  0xFF   单字节保留字节，任何合法序列都不以它开头
//  0xC3 0x28  两位序列的 continuation byte 落在 0x28（应 ≥ 0x80）
//  0xED 0xA0 0x80  三字节序列解码到 U+D800，surrogate 半平面（RFC 3629 §3）
const BAD_BODIES = [
  ['bare-0xff', Buffer.from([0xFF])],
  ['truncated-lead', Buffer.from([0xC3, 0x28])],
  ['surrogate', Buffer.from([0xED, 0xA0, 0x80])],
];

test('/rpc 收到非法 UTF-8 正文：结构化错误，不回显原文，daemon 不崩', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-utf8-rpc-'));
  const d = await boot(cwd);
  try {
    for (const [name, buf] of BAD_BODIES) {
      const r = await rawPost(d.port, '/rpc', buf);
      assert.equal(d.proc.exitCode, null,
        `${name}: daemon 进程不该死：exit=${d.proc.exitCode} stderr=${d.stderr().slice(-400)}`);
      // JSON-RPC 2.0 spec：parse error 走响应体里的 error 对象，HTTP 层用 200 或 500 都合规。
      // 关键是响应必须是**结构化 JSON-RPC error**（-32xxx 系），且**不带原始字节回显**。
      assert.ok(r.json !== null,
        `${name}: 响应必须能 JSON.parse，实得 ${r.text.slice(0, 200)}`);
      assert.ok(r.json.error !== undefined,
        `${name}: 非法 UTF-8 必须回 JSON-RPC error 对象，实得 ${r.text.slice(0, 200)}`);
      const code = r.json.error.code;
      assert.ok(code === -32600 || code === -32700,
        `${name}: error.code 应是 parse error（-32700）或 invalid request（-32600），实得 ${code}`);
      // 关键：不能把非法字节原样回给客户端。
      assert.ok(!r.text.includes('\uFFFD'),
        `${name}: 响应里出现了 U+FFFD 替换字符，说明把非法字节解码后回显了`);
      // 也不能把 id 塞成 null 之后又回显原文——那两种形状都会把原文漏出去。
      assert.equal(r.json.id, null,
        `${name}: parse error 的 id 必须是 null（spec §5.1），实得 ${r.json.id}`);
    }
  } finally {
    await d.stop();
    await rm(cwd, { recursive: true, force: true });
  }
});

test('/auth/token 收到非法 UTF-8 正文：结构化错误，不落凭据日志原文', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-utf8-auth-'));
  const d = await boot(cwd);
  try {
    for (const [name, buf] of BAD_BODIES) {
      const r = await rawPost(d.port, '/auth/token', buf);
      assert.equal(d.proc.exitCode, null,
        `${name}: daemon 进程不该死：exit=${d.proc.exitCode} stderr=${d.stderr().slice(-400)}`);
      assert.ok(r.status === 400 || r.status === 500,
        `非法 UTF-8 应 400/500，实得 ${r.status}，body=${r.text.slice(0, 120)}`);
      const audit = await readAudit(d);
      const latin = Buffer.from(buf).toString('latin1');
      assert.ok(!audit.includes(latin),
        `${name}: 审计里出现了原始非法字节的 latin1 形态`);
      assert.ok(!audit.includes('\uFFFD'),
        `${name}: 审计里出现了 U+FFFD 替换字符`);
    }
  } finally {
    await d.stop();
    await rm(cwd, { recursive: true, force: true });
  }
});

// 合法 UTF-8 对照：同一 daemon、同一端点，能收到合法多字节字符的 JSON 请求，
// 就证明「拒绝」不是「所有请求都被拒」——两条同时通过才立得住。
test('/rpc 合法多字节 UTF-8 参数照常打到分派', async () => {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-utf8-legal-'));
  const d = await boot(cwd);
  try {
    // 未认证，任何业务分派都会被 authz-denied 挡住；但**方法名识别**发生在 authz 之前，
    // 所以 32001 authz-denied 就说明解析过了。这已经是「合法 UTF-8 被正确解析」的证据。
    const buf = Buffer.from(JSON.stringify({
      jsonrpc: '2.0',
      id: 'utf-8-ok',
      method: 'initialize',
      params: { workspaceName: '会话-测试-日本語-한글-🌟' },
    }));
    const r = await rawPost(d.port, '/rpc', buf);
    assert.ok(d.proc?.exitCode === null, `daemon 因合法多字节请求死掉：stderr=${d.stderr().slice(-400)}`);
    // 期望：JSON-RPC error，code = -32001（authz-denied），或者 200 result（若已认证）。
    // 关键是响应必须能 JSON.parse。
    assert.ok(r.json !== null, `合法 UTF-8 请求的响应必须能解析：${r.text.slice(0, 200)}`);
    // 且响应里必须能读回原始 operationId。
    assert.ok(r.text.includes('utf-8-ok'),
      `合法多字节请求必须走完整解析路径：${r.text.slice(0, 200)}`);
  } finally {
    await d.stop();
    await rm(cwd, { recursive: true, force: true });
  }
});

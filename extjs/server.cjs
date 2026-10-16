// 扩展宿主的 stdio 服务面：NDJSON JSON-RPC 2.0，stdout 只走协议，诊断走 stderr。
"use strict";
const { ExtHost } = require("./host.cjs");
const { isAbsolute: jabs } = require("node:path");

const host = new ExtHost();
const out = process.stdout;
const CAPABILITIES = ["extension/load", "extension/list", "extension/call", "extension/cancel", "extension/dispose", "host/shutdown"];

// NDJSON 单帧上限：与同仓 provider.mjs 的 MAX_FRAME_BYTES 对齐，防止异常/恶意 stdin
// 发送超长无换行帧把 Node 撑爆 OOM。
const MAX_FRAME_BYTES = 256 * 1024;

function send(obj) {
  out.write(JSON.stringify(obj) + "\n");
}
function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

// JSON-RPC 2.0 入站结构校验：缺 jsonrpc/method、或 id 类型非法（对象/数组）都拒，
// 避免 null 输入在 dispatch 里 TypeError 并在 catch 二次访问 req.id 造成 unhandled rejection。
function isValidRequest(req) {
  if (!req || typeof req !== "object" || Array.isArray(req)) return false;
  if (req.jsonrpc !== "2.0") return false;
  if (typeof req.method !== "string") return false;
  const id = req.id;
  if (id !== undefined && id !== null && typeof id !== "number" && typeof id !== "string") return false;
  return true;
}

// 扩展加载路径白名单：只允许 __dirname 子目录下的相对路径，拒绝绝对路径与 `..` 越界，
// 否则 `host.load` 的 require() 会执行宿主目录外的任意 .cjs/.js（见 H-4）。
function isSafeExtensionPath(p) {
  if (typeof p !== "string" || p.length === 0) return false;
  if (jabs(p)) return false;
  if (p.includes("..")) return false;
  return true;
}

async function dispatch(req) {
  const id = req.id;
  switch (req.method) {
    case "initialize":
      return send({
        jsonrpc: "2.0",
        id,
        result: { protocolVersion: "0.1", capabilities: CAPABILITIES, process: { pid: process.pid } },
      });
    case "extension/list":
      return send({ jsonrpc: "2.0", id, result: { names: host.list() } });
    case "extension/load": {
      if (!isSafeExtensionPath(req.params && req.params.path)) {
        return replyError(id, -32602, "invalid-extension-path");
      }
      const ok = await host.load(req.params.path);
      return send({ jsonrpc: "2.0", id, result: { ok, names: host.list() } });
    }
    case "extension/call": {
      const callId = req.params.callId;
      try {
        const result = await host.call(req.params.name, req.params.args || {}, callId);
        // 应答仍只按 RPC id 配对：callId 是「取消哪一笔」的键，不是第二套相关 id
        return send({ jsonrpc: "2.0", id, result });
      } catch (e) {
        if (/duplicate-callId/.test(e.message)) return replyError(id, -32022, e.message);
        if (/cancelled/.test(e.message)) return replyError(id, -32021, e.message);
        return replyError(id, /host-exiting/.test(e.message) ? -32002 : -32010, e.message);
      }
    }
    case "extension/cancel":
      // 只回「有没有真结算到一笔在途调用」，不替调用方编结果；结果帧仍由那条 call 写出。
      // 扩展是否真的停止了另说：那部分记在宿主的 stderr 上，不混进协议面。
      return send({ jsonrpc: "2.0", id, result: { cancelled: host.cancel(req.params.callId) } });
    case "extension/dispose":
      return send({ jsonrpc: "2.0", id, result: { disposed: host.dispose(req.params.name) } });
    case "host/shutdown":
      // 先应答再结算：父进程要拿到确认才去等退出；在途调用的 -32002 应答随后写出。
      send({ jsonrpc: "2.0", id, result: { ok: true, inflight: host.pendingCount() } });
      safeShutdown();
      return;
    default:
      return replyError(id, -32601, `method-not-found: ${req.method}`);
  }
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d;
  // 缓冲总量超上限：丢弃已缓冲内容并回报错误，避免 OOM（H-5）。
  if (buf.length > MAX_FRAME_BYTES) {
    buf = "";
    replyError(null, -32700, "frame-too-large");
    return;
  }
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    if (line.length > MAX_FRAME_BYTES) {
      replyError(null, -32700, "frame-too-large");
      continue;
    }
    let req;
    try {
      req = JSON.parse(line);
    } catch (e) {
      replyError(null, -32700, `parse-error: ${e.message}`);
      continue;
    }
    // 结构校验：非法请求回 -32600，不让坏帧进 dispatch（M-15）。
    if (!isValidRequest(req)) {
      replyError(req && req.id !== undefined ? req.id : null, -32600, "invalid-request");
      continue;
    }
    dispatch(req).catch((e) => replyError(req && req.id !== undefined ? req.id : null, -32020, "internal-error"));
  }
});

// 退出前必须结算在途调用，否则客户端会永远等一个不会再有回答的 id。
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const pending = host.pendingCount();
  host.close();
  // host.close() 里 reject 的应答要真写出去，就得先让微任务跑一轮再收尾 stdout
  if (pending > 0) await new Promise((r) => setImmediate(r));
  if (pending > 0) process.stderr.write(`settled-inflight=${pending}\n`);
  out.end(() => process.exit(0));
}
// 三处触发点（host/shutdown 应答后、stdin end、stdin close）统一走这里，
// 保证 shutdown() 的异常被捕获，不会变成 unhandled rejection 污染 stdout（M-17）。
function safeShutdown() {
  shutdown().catch((e) => process.stderr.write(`shutdown-error: ${e.message}\n`));
}
process.stdin.on("end", safeShutdown);
process.stdin.on("close", () => {
  if (!process.stdin.readable) safeShutdown();
});

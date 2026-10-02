// 扩展宿主的 stdio 服务面：NDJSON JSON-RPC 2.0，stdout 只走协议，诊断走 stderr。
"use strict";
const { ExtHost } = require("./host.cjs");

const host = new ExtHost();
const out = process.stdout;
const CAPABILITIES = ["extension/load", "extension/list", "extension/call", "extension/cancel", "extension/dispose", "host/shutdown"];

function send(obj) {
  out.write(JSON.stringify(obj) + "\n");
}
function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
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
      // 只回「有没有真结算到一笔在途调用」，不替调用方编结果；结果帧仍由那条 call 写出
      return send({ jsonrpc: "2.0", id, result: { cancelled: host.cancel(req.params.callId) } });
    case "extension/dispose":
      return send({ jsonrpc: "2.0", id, result: { disposed: host.dispose(req.params.name) } });
    case "host/shutdown":
      // 先应答再结算：父进程要拿到确认才去等退出；在途调用的 -32002 应答随后写出。
      send({ jsonrpc: "2.0", id, result: { ok: true, inflight: host.pendingCount() } });
      shutdown();
      return;
    default:
      return replyError(id, -32601, `method-not-found: ${req.method}`);
  }
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let req;
    try {
      req = JSON.parse(line);
    } catch (e) {
      replyError(null, -32700, `parse-error: ${e.message}`);
      continue;
    }
    dispatch(req).catch((e) => replyError(req.id, -32020, e.message));
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
process.stdin.on("end", shutdown);
process.stdin.on("close", () => {
  if (!process.stdin.readable) shutdown();
});

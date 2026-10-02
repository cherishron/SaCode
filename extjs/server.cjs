// 扩展宿主的 stdio 服务面：NDJSON JSON-RPC 2.0，stdout 只走协议，诊断走 stderr。
"use strict";
const { ExtHost } = require("./host.cjs");

const host = new ExtHost();
const out = process.stdout;
const CAPABILITIES = ["extension/load", "extension/list", "extension/call", "extension/dispose"];

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
      try {
        const result = await host.call(req.params.name, req.params.args || {});
        return send({ jsonrpc: "2.0", id, result });
      } catch (e) {
        return replyError(id, /host-exiting/.test(e.message) ? -32002 : -32010, e.message);
      }
    }
    case "extension/dispose":
      return send({ jsonrpc: "2.0", id, result: { disposed: host.dispose(req.params.name) } });
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
async function shutdown() {
  const pending = host.pendingCount();
  host.close();
  if (pending > 0) process.stderr.write(`settled-inflight=${pending}\n`);
  out.end(() => process.exit(0));
}
process.stdin.on("end", shutdown);
process.stdin.on("close", () => {
  if (!process.stdin.readable) shutdown();
});

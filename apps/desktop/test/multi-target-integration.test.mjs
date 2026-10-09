// 端到端整合：TargetStore + TargetBridge + RemoteTransport 打到真 Node HTTP
// 服务端，模拟桌面已注册两个远程 target（A/B），并验证：
//   - 两个 target 各自走自己的 baseUrl 与 token；
//   - 默认 target 切换不影响另一个的在途请求；
//   - 移除 A 时只关 A 的 transport，B 保持。
// 这一层不测 daemon 授权决策（那是 Task 6），只测客户端多目标隔离。

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { createRequire } from "node:module";
import { TargetBridge } from "../target-bridge.mjs";
import { RemoteTransport } from "../remote-transport.mjs";
const require = createRequire(import.meta.url);
const { TargetStore } = require("../target-store.cjs");

function startRpcServer({ token }) {
  const events = { rpcCalls: [] };
  const srv = http.createServer((req, res) => {
    const auth = req.headers["authorization"];
    if (auth !== `Bearer ${token}`) { res.writeHead(401); res.end("{}"); return; }
    if (req.url === "/rpc") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const parsed = JSON.parse(body);
        events.rpcCalls.push({ token, method: parsed.method, id: parsed.id });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: { servedBy: token } }));
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve({ srv, events })));
}

async function shutdown(...servers) {
  for (const s of servers) {
    s.srv.closeAllConnections?.();
    s.srv.close();
    await once(s.srv, "close");
  }
}

function mkTarget(store, bridge, targetId, token, server) {
  // 走 http 回环：kind 用 "local" 让 target-store 的 https 强制过关；
  // 传输/桥本身与 kind 无关，本文件只验多目标隔离。
  store.add({
    targetId, displayName: targetId, kind: "local",
    baseUrl: `http://127.0.0.1:${server.srv.address().port}`,
    instanceFingerprint: "", credentialRef: `test:${token}`,
  });
  const transport = new RemoteTransport({
    baseUrl: store.get(targetId).baseUrl,
    tokenProvider: async () => token,
    fetchImpl: globalThis.fetch,
  });
  bridge.register(store.get(targetId), transport);
  return transport;
}

test("集成：两个远程 target 各自路由，不共享 token/baseUrl", async () => {
  const store = new TargetStore();
  const bridge = new TargetBridge();
  const a = await startRpcServer({ token: "tk-a" });
  const b = await startRpcServer({ token: "tk-b" });
  mkTarget(store, bridge, "A", "tk-a", a);
  mkTarget(store, bridge, "B", "tk-b", b);

  const [ra, rb] = await Promise.all([
    bridge.request("A", "list_sessions", {}),
    bridge.request("B", "list_sessions", {}),
  ]);
  assert.equal(ra.servedBy, "tk-a");
  assert.equal(rb.servedBy, "tk-b");
  assert.equal(a.events.rpcCalls.length, 1);
  assert.equal(b.events.rpcCalls.length, 1);

  await shutdown(a, b);
});

test("集成：A 移除时只关 A 的 transport，B 保持可用", async () => {
  const store = new TargetStore();
  const bridge = new TargetBridge();
  const a = await startRpcServer({ token: "tk-a" });
  const b = await startRpcServer({ token: "tk-b" });
  const ta = mkTarget(store, bridge, "A", "tk-a", a);
  const tb = mkTarget(store, bridge, "B", "tk-b", b);

  bridge.remove("A");
  await assert.rejects(() => bridge.request("A", "m", {}), /target-not-found: A/);
  const rb = await bridge.request("B", "m", {});
  assert.equal(rb.servedBy, "tk-b");
  assert.equal(ta.closed, true);
  assert.equal(tb.closed, false);

  await shutdown(b);
  a.srv.closeAllConnections?.();
  a.srv.close();
  await once(a.srv, "close");
});

test("集成：切换 default 不影响已在途请求的归属", async () => {
  const store = new TargetStore();
  const bridge = new TargetBridge();
  const a = await startRpcServer({ token: "tk-a" });
  const b = await startRpcServer({ token: "tk-b" });
  mkTarget(store, bridge, "A", "tk-a", a);
  mkTarget(store, bridge, "B", "tk-b", b);

  const p = bridge.request("A", "m", {});   // 在途归 A
  bridge.setDefault("B");                    // 切默认，但请求仍属 A
  const r = await p;
  assert.equal(r.servedBy, "tk-a");
  assert.equal(bridge.getDefault().targetId, "B");

  await shutdown(a, b);
});

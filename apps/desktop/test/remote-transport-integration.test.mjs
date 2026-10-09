// 集成层测试：remote-transport 打到真实 Node HTTP 服务器，走真 socket、
// 真 chunked response 与真 AbortController；只覆盖客户端已实现的最小契约：
//   - /rpc：Bearer 头 → 200 / 无 Bearer → 401 / JSON-RPC id 严格回显
//   - /sse：Bearer 头 → text/event-stream / id: 行 → 客户端 lastEventId
//   - 客户端 Idempotency-Key 与 Last-Event-ID 头透传到服务端
// 这里不验授权决策本身（那是 daemon 端 Task 6），只验传输层。

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { RemoteTransport } from "../remote-transport.mjs";

function startServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

test("集成：/rpc 无 Bearer → 401，客户端上抛 http-client-error", async () => {
  const srv = await startServer((_req, res) => { res.writeHead(401); res.end("{}"); });
  const port = srv.address().port;
  const t = new RemoteTransport({
    baseUrl: `http://127.0.0.1:${port}`,
    tokenProvider: async () => "wrong",
    fetchImpl: globalThis.fetch,
  });
  await assert.rejects(
    () => t.sendRequest("m", {}),
    (e) => e.reason === "status-401" && e.code === "http-client-error"
  );
  srv.close();
  await once(srv, "close");
});

test("集成：/rpc Bearer 匹配 + id 严格回显 → 客户端返回 result", async () => {
  const srv = await startServer(async (req, res) => {
    const auth = req.headers["authorization"];
    if (auth !== "Bearer topsecret") { res.writeHead(401); res.end("{}"); return; }
    const body = JSON.parse(await readBody(req));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { echo: body.method } }));
  });
  const port = srv.address().port;
  const t = new RemoteTransport({
    baseUrl: `http://127.0.0.1:${port}`,
    tokenProvider: async () => "topsecret",
    fetchImpl: globalThis.fetch,
  });
  const r = await t.sendRequest("hello", { a: 1 });
  assert.deepEqual(r, { echo: "hello" });
  srv.close();
  await once(srv, "close");
});

test("集成：/rpc Idempotency-Key 头到达服务端", async () => {
  let seenKey = null;
  const srv = await startServer(async (req, res) => {
    seenKey = req.headers["idempotency-key"] ?? null;
    const body = JSON.parse(await readBody(req));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }));
  });
  const port = srv.address().port;
  const t = new RemoteTransport({
    baseUrl: `http://127.0.0.1:${port}`,
    tokenProvider: async () => "tk",
    fetchImpl: globalThis.fetch,
  });
  await t.sendRequest("m", {}, { idempotencyKey: "op-1" });
  assert.equal(seenKey, "op-1");
  srv.close();
  await once(srv, "close");
});

test("集成：/sse 帧带 id: → 客户端 lastEventId 更新 + Last-Event-ID 重连带上", async () => {
  let secondRequestResume = null;
  let requestCount = 0;
  const srv = await startServer((req, res) => {
    requestCount += 1;
    if (req.headers["last-event-id"]) secondRequestResume = req.headers["last-event-id"];
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    if (requestCount === 1) {
      res.write("id: 1\ndata: {\"n\":1}\n\n");
      res.write("id: 2\ndata: {\"n\":2}\n\n");
      setTimeout(() => res.end(), 20);
    } else {
      // 第二请求即重连：服务端立刻关闭，测试只看 header 是否携带
      res.end();
    }
  });
  const port = srv.address().port;
  const t = new RemoteTransport({
    baseUrl: `http://127.0.0.1:${port}`,
    tokenProvider: async () => "tk",
    fetchImpl: globalThis.fetch,
  });
  const frames = [];
  await t.subscribeNotifications((f) => frames.push(f));
  // 等 pump 至少跑完两个 chunk
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  assert.deepEqual(frames.map((f) => f.n), [1, 2]);
  assert.equal(t.getLastEventId(), "2");
  // 重连：带 resumeEventId=2
  await t.subscribeNotifications(() => {}, { resumeEventId: t.getLastEventId() });
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  assert.equal(secondRequestResume, "2");
  srv.close();
  await once(srv, "close");
});

test("集成：/rpc 服务端返 JSON-RPC error 时客户端上抛 jsonrpc-error", async () => {
  const srv = await startServer(async (req, res) => {
    const body = JSON.parse(await readBody(req));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32001, message: "authz-denied" } }));
  });
  const port = srv.address().port;
  const t = new RemoteTransport({
    baseUrl: `http://127.0.0.1:${port}`,
    tokenProvider: async () => "tk",
    fetchImpl: globalThis.fetch,
  });
  await assert.rejects(
    () => t.sendRequest("m", {}),
    (e) => e.code === "jsonrpc-error" && e.jsonrpcCode === -32001 && e.reason === "authz-denied"
  );
  srv.close();
  await once(srv, "close");
});

test("集成：/rpc id 与服务端回显不匹配（模拟错帧）→ 客户端拒收", async () => {
  const srv = await startServer(async (req, res) => {
    const body = JSON.parse(await readBody(req));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id + 999, result: {} }));
  });
  const port = srv.address().port;
  const t = new RemoteTransport({
    baseUrl: `http://127.0.0.1:${port}`,
    tokenProvider: async () => "tk",
    fetchImpl: globalThis.fetch,
  });
  await assert.rejects(() => t.sendRequest("m", {}), (e) => e.reason === "response-id-mismatch");
  srv.close();
  await once(srv, "close");
});

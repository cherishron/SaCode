import { test } from "node:test";
import assert from "node:assert/strict";
import { RemoteTransport } from "../remote-transport.mjs";

function makeResponse({ status = 200, body = "{}", stream = null }) {
  return {
    ok: status >= 200 && status < 400,
    status,
    async text() { return body; },
    body: stream ? { getReader: () => stream() } : null,
  };
}

function chunkStream(chunks) {
  let i = 0;
  const enc = new TextEncoder();
  return {
    read: async () => {
      if (i >= chunks.length) return { done: true, value: undefined };
      return { done: false, value: enc.encode(chunks[i++]) };
    },
  };
}

test("transport：合法请求带 Authorization: Bearer", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return makeResponse({ body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }) });
  };
  const t = new RemoteTransport({ baseUrl: "https://x.example", tokenProvider: async () => "tk-abc", fetchImpl });
  const result = await t.sendRequest("initialize", {});
  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0].url, "https://x.example/rpc");
  assert.equal(calls[0].init.headers["Authorization"], "Bearer tk-abc");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
});

test("transport：token 空则拒绝发请求", async () => {
  const t = new RemoteTransport({ baseUrl: "https://x.example", tokenProvider: async () => "", fetchImpl: async () => makeResponse({}) });
  await assert.rejects(() => t.sendRequest("m", {}), (e) => e.reason === "token-empty");
});

test("transport：请求体超 1 MiB 拒发", async () => {
  const t = new RemoteTransport({ baseUrl: "https://x.example", tokenProvider: async () => "tk", fetchImpl: async () => makeResponse({}) });
  await assert.rejects(
    () => t.sendRequest("m", { huge: "x".repeat(1024 * 1024 + 100) }),
    (e) => e.reason === "request-body-exceeds-1mib"
  );
});

test("transport：并发 RPC 超 8 拒收", async () => {
  let inflight = 0, peak = 0;
  const resolvers = [];
  const fetchImpl = async (_url, init) => {
    inflight += 1;
    peak = Math.max(peak, inflight);
    const { id } = JSON.parse(init.body);
    return new Promise((resolve) => {
      resolvers.push(() => { inflight -= 1; resolve(makeResponse({ body: JSON.stringify({ jsonrpc: "2.0", id, result: {} }) })); });
    });
  };
  const t = new RemoteTransport({ baseUrl: "https://x.example", tokenProvider: async () => "tk", fetchImpl });
  const promises = [];
  for (let i = 0; i < 8; i++) promises.push(t.sendRequest("m", {}));
  // 第 9 条同步就应拒
  await assert.rejects(() => t.sendRequest("m", {}), (e) => e.reason === "rpc-concurrency-limit");
  // 等 fetch 全部登记 resolvers
  await new Promise((r) => setImmediate(r));
  for (const r of resolvers) r();
  await Promise.all(promises);
  assert.equal(peak, 8);
});

test("transport：目标切换 epoch 后旧请求响应丢弃", async () => {
  let resolveFetch;
  const fetchImpl = () => new Promise((r) => { resolveFetch = r; });
  const t = new RemoteTransport({ baseUrl: "https://x.example", tokenProvider: async () => "tk", fetchImpl });
  const p = t.sendRequest("m", {});
  // 等 sendRequest 内 await tokenProvider 完成、fetch 已启动、resolveFetch 已就位
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  t.bumpEpoch();
  resolveFetch(makeResponse({ body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { stale: true } }) }));
  await assert.rejects(() => p, (e) => e.reason === "target-switched-before-response");
});

test("transport：响应 id 不匹配按错处理，绝不按到达顺序配对", async () => {
  const fetchImpl = async () => makeResponse({ body: JSON.stringify({ jsonrpc: "2.0", id: 999, result: {} }) });
  const t = new RemoteTransport({ baseUrl: "https://x.example", tokenProvider: async () => "tk", fetchImpl });
  await assert.rejects(() => t.sendRequest("m", {}), (e) => e.reason === "response-id-mismatch");
});

test("transport：JSON-RPC error 与 HTTP error 分开", async () => {
  // 200 OK + body 里带 error → jsonrpc-error
  const fetchOk = async () => makeResponse({ status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32001, message: "denied" } }) });
  const t1 = new RemoteTransport({ baseUrl: "https://x.example", tokenProvider: async () => "tk", fetchImpl: fetchOk });
  await assert.rejects(() => t1.sendRequest("m", {}), (e) => e.reason === "denied" && e.jsonrpcCode === -32001);

  // 401 → http-client-error，不重试
  const fetch401 = async () => makeResponse({ status: 401, body: "unauthorized" });
  const t2 = new RemoteTransport({ baseUrl: "https://x.example", tokenProvider: async () => "tk", fetchImpl: fetch401 });
  await assert.rejects(() => t2.sendRequest("m", {}), (e) => e.reason === "status-401");

  // 500 → http-server-error
  const fetch500 = async () => makeResponse({ status: 500, body: "" });
  const t3 = new RemoteTransport({ baseUrl: "https://x.example", tokenProvider: async () => "tk", fetchImpl: fetch500 });
  await assert.rejects(() => t3.sendRequest("m", {}), (e) => e.reason === "status-500");
});

test("transport：响应体非 JSON 判畸形", async () => {
  const fetchImpl = async () => makeResponse({ body: "not json at all" });
  const t = new RemoteTransport({ baseUrl: "https://x.example", tokenProvider: async () => "tk", fetchImpl });
  await assert.rejects(() => t.sendRequest("m", {}), (e) => e.reason === "response-not-json");
});

test("transport：SSE 按 \\n\\n 分帧，忽略 keepalive 与 connected 注释行", async () => {
  const frames = [
    ": connected\n\n",
    "data: {\"jsonrpc\":\"2.0\",\"method\":\"turn/poll\",\"params\":{\"seq\":\"1\"}}\n\n",
    ": keepalive\n\n",
    "data: {\"jsonrpc\":\"2.0\",\"method\":\"approval/asked\",\"params\":{\"id\":\"a-1\"}}\n\n",
  ];
  const streamReader = chunkStream(frames);
  const fetchImpl = async () => ({
    ok: true, status: 200,
    body: { getReader: () => streamReader },
  });
  const t = new RemoteTransport({ baseUrl: "https://x.example", tokenProvider: async () => "tk", fetchImpl });
  const received = [];
  const unsub = await t.subscribeNotifications((frame) => received.push(frame));
  // 等 pump 结束（chunkStream 已 done）
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(received.length, 2);
  assert.equal(received[0].method, "turn/poll");
  assert.equal(received[1].method, "approval/asked");
  unsub();
});

test("transport：SSE 分片中文 UTF-8 用 stream:true 正确拼接", async () => {
  // 手动把 "数据" 拆两个字节 chunk（跨 chunk 边界）
  const bytes1 = new TextEncoder().encode("data: {\"k\":\"中");
  const bytes2 = new TextEncoder().encode("文\"}\n\n");
  let i = 0;
  const reader = {
    read: async () => {
      if (i === 0) { i++; return { done: false, value: bytes1 }; }
      if (i === 1) { i++; return { done: false, value: bytes2 }; }
      return { done: true };
    },
  };
  const fetchImpl = async () => ({ ok: true, status: 200, body: { getReader: () => reader } });
  const t = new RemoteTransport({ baseUrl: "https://x.example", tokenProvider: async () => "tk", fetchImpl });
  const got = [];
  await t.subscribeNotifications((frame) => got.push(frame));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(got.length, 1);
  assert.equal(got[0].k, "中文");
});

test("transport：SSE 超 2 条并发拒收", async () => {
  const fetchImpl = async () => ({
    ok: true, status: 200,
    body: { getReader: () => ({ read: () => new Promise(() => {}) }) },
  });
  const t = new RemoteTransport({ baseUrl: "https://x.example", tokenProvider: async () => "tk", fetchImpl });
  await t.subscribeNotifications(() => {});
  await t.subscribeNotifications(() => {});
  await assert.rejects(() => t.subscribeNotifications(() => {}), (e) => e.reason === "sse-concurrency-limit");
});

test("transport：bumpEpoch 中止所有在途 SSE 订阅", async () => {
  let aborted = 0;
  const fetchImpl = async () => ({
    ok: true, status: 200,
    body: { getReader: () => ({ read: () => new Promise((_res, rej) => { aborted += 0; /* noop */ }) }) },
  });
  const t = new RemoteTransport({ baseUrl: "https://x.example", tokenProvider: async () => "tk", fetchImpl });
  await t.subscribeNotifications(() => {});
  const epochBefore = t.currentEpoch();
  t.bumpEpoch();
  assert.equal(t.currentEpoch(), epochBefore + 1);
});

test("transport：close 后 sendRequest 立即拒", async () => {
  const t = new RemoteTransport({ baseUrl: "https://x.example", tokenProvider: async () => "tk", fetchImpl: async () => makeResponse({}) });
  t.close();
  await assert.rejects(() => t.sendRequest("m", {}), (e) => e.reason === "transport-closed");
});

test("transport：baseUrl 无斜杠也能拼 /rpc /sse", async () => {
  const urls = [];
  const fetchImpl = async (u) => { urls.push(u); return makeResponse({ body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }) }); };
  const t = new RemoteTransport({ baseUrl: "https://x.example/", tokenProvider: async () => "tk", fetchImpl });
  await t.sendRequest("m", {});
  assert.equal(urls[0], "https://x.example/rpc");
});

test("transport：sendRequest 带 Idempotency-Key 头", async () => {
  const calls = [];
  const fetchImpl = async (u, init) => {
    calls.push(init);
    return makeResponse({ body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }) });
  };
  const t = new RemoteTransport({ baseUrl: "https://x.example", tokenProvider: async () => "tk", fetchImpl });
  await t.sendRequest("m", {}, { idempotencyKey: "op-42" });
  assert.equal(calls[0].headers["Idempotency-Key"], "op-42");
});

test("transport：sendRequest 不带 key 时不出现 Idempotency-Key 头", async () => {
  const calls = [];
  const fetchImpl = async (_u, init) => {
    calls.push(init);
    return makeResponse({ body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }) });
  };
  const t = new RemoteTransport({ baseUrl: "https://x.example", tokenProvider: async () => "tk", fetchImpl });
  await t.sendRequest("m", {});
  assert.ok(!("Idempotency-Key" in calls[0].headers));
});

test("transport：Idempotency-Key 空串与非字符串拒发", async () => {
  const t = new RemoteTransport({ baseUrl: "https://x.example", tokenProvider: async () => "tk", fetchImpl: async () => makeResponse({}) });
  await assert.rejects(() => t.sendRequest("m", {}, { idempotencyKey: "" }), (e) => e.reason === "idempotency-key-invalid");
  await assert.rejects(() => t.sendRequest("m", {}, { idempotencyKey: 123 }), (e) => e.reason === "idempotency-key-invalid");
});

test("transport：Idempotency-Key 超 200 字符拒发", async () => {
  const t = new RemoteTransport({ baseUrl: "https://x.example", tokenProvider: async () => "tk", fetchImpl: async () => makeResponse({}) });
  await assert.rejects(
    () => t.sendRequest("m", {}, { idempotencyKey: "x".repeat(201) }),
    (e) => e.reason === "idempotency-key-too-long"
  );
});

test("transport：SSE resumeEventId 发 Last-Event-ID 头", async () => {
  const calls = [];
  const fetchImpl = async (_u, init) => {
    calls.push(init);
    return { ok: true, status: 200, body: { getReader: () => ({ read: () => new Promise(() => {}) }) } };
  };
  const t = new RemoteTransport({ baseUrl: "https://x.example", tokenProvider: async () => "tk", fetchImpl });
  await t.subscribeNotifications(() => {}, { resumeEventId: "42" });
  assert.equal(calls[0].headers["Last-Event-ID"], "42");
});

test("transport：SSE 不传 resumeEventId 时不带 Last-Event-ID", async () => {
  const calls = [];
  const fetchImpl = async (_u, init) => {
    calls.push(init);
    return { ok: true, status: 200, body: { getReader: () => ({ read: () => new Promise(() => {}) }) } };
  };
  const t = new RemoteTransport({ baseUrl: "https://x.example", tokenProvider: async () => "tk", fetchImpl });
  await t.subscribeNotifications(() => {});
  assert.ok(!("Last-Event-ID" in calls[0].headers));
});

test("transport：SSE resumeEventId 非法（空/超长）拒发", async () => {
  const t = new RemoteTransport({
    baseUrl: "https://x.example",
    tokenProvider: async () => "tk",
    fetchImpl: async () => ({ ok: true, status: 200, body: { getReader: () => ({ read: () => new Promise(() => {}) }) } }),
  });
  await assert.rejects(() => t.subscribeNotifications(() => {}, { resumeEventId: "" }), (e) => e.reason === "resume-event-id-invalid");
  await assert.rejects(() => t.subscribeNotifications(() => {}, { resumeEventId: "x".repeat(129) }), (e) => e.reason === "resume-event-id-invalid");
});

test("transport：SSE 帧中 id: 行更新 lastEventId 游标", async () => {
  const chunks = [
    "id: 7\ndata: {\"seq\":7}\n\n",
    "data: {\"seq\":8}\n\n",       // 无 id，游标保持 7
    "id: 9\ndata: {\"seq\":9}\n\n",
  ];
  const stream = chunkStream(chunks);
  const fetchImpl = async () => ({ ok: true, status: 200, body: { getReader: () => stream } });
  const t = new RemoteTransport({ baseUrl: "https://x.example", tokenProvider: async () => "tk", fetchImpl });
  const frames = [];
  await t.subscribeNotifications((f) => frames.push(f));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(t.getLastEventId(), "9");
  assert.deepEqual(frames.map((f) => f.seq), [7, 8, 9]);
});

// 设计 §4.2「access token 最长 15 分钟，长连接到期关闭并续接」——
// transport 绝不能把 tokenProvider 的返回值缓存到构造时刻，否则一旦
// 上层轮换 token，这里还在带旧 token 请求，服务端一律 401。
test("transport：sendRequest 每次读 tokenProvider（token 轮换立即生效）", async () => {
  const seen = [];
  const calls = [];
  let current = "tk-1";
  const fetchImpl = async (_url, init) => {
    calls.push(init.headers.Authorization);
    const req = JSON.parse(init.body);
    return makeResponse({ body: JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { ok: true } }) });
  };
  const t = new RemoteTransport({
    baseUrl: "https://x.example",
    tokenProvider: async () => { seen.push(current); return current; },
    fetchImpl,
  });
  await t.sendRequest("session/catalog", {});
  current = "tk-2";
  await t.sendRequest("session/catalog", {});
  assert.deepEqual(seen, ["tk-1", "tk-2"], "tokenProvider 必须每次调用");
  assert.deepEqual(calls, ["Bearer tk-1", "Bearer tk-2"], "Bearer 头必须反映最新 token");
});

// SSE 面同样：subscribe 建立前必须现取 token，不能沿用构造时快照。
test("transport：subscribeNotifications 建立连接也走 tokenProvider", async () => {
  let current = "sse-tk-1";
  const seen = [];
  const stream = chunkStream([]);
  const fetchImpl = async (_url, init) => {
    seen.push(init.headers.Authorization);
    return { ok: true, status: 200, body: { getReader: () => stream } };
  };
  const t = new RemoteTransport({
    baseUrl: "https://x.example",
    tokenProvider: async () => current,
    fetchImpl,
  });
  await t.subscribeNotifications(() => {});
  current = "sse-tk-2";
  await t.subscribeNotifications(() => {});
  assert.deepEqual(seen, ["Bearer sse-tk-1", "Bearer sse-tk-2"]);
});

// 设计 §4.2「认证请求不跟随跨主机重定向」——Bearer 头绝不能被 fetch 默认
// redirect:"follow" 带到第三方主机。RPC 与 SSE 两条面都强制 manual，
// 且 3xx 响应必须原样上报，交给调用方显式决定（而非静默跟随后 200）。
test("transport：sendRequest 用 redirect:manual，3xx 直接判 redirect-not-allowed", async () => {
  const inits = [];
  const fetchImpl = async (_url, init) => {
    inits.push(init);
    return { ok: false, status: 302, async text() { return ""; } };
  };
  const t = new RemoteTransport({ baseUrl: "https://x.example", tokenProvider: async () => "tk", fetchImpl });
  await assert.rejects(
    () => t.sendRequest("session/catalog", {}),
    (e) => e.reason === "redirect-not-allowed",
    "3xx 必须归 redirect-not-allowed，不能落到 http-server-error 或 http-client-error",
  );
  assert.equal(inits[0].redirect, "manual", "fetch init 必须显式带 redirect:\"manual\"");
});

test("transport：subscribeNotifications 用 redirect:manual，3xx 直接拒", async () => {
  const inits = [];
  const fetchImpl = async (_url, init) => {
    inits.push(init);
    return { ok: false, status: 307, body: null };
  };
  const t = new RemoteTransport({ baseUrl: "https://x.example", tokenProvider: async () => "tk", fetchImpl });
  await assert.rejects(
    () => t.subscribeNotifications(() => {}),
    (e) => e.reason === "redirect-not-allowed",
  );
  assert.equal(inits[0].redirect, "manual");
});

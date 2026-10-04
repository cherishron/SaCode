import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join as jj } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = jj(HERE, "..");
const { ExtHost } = require("../host.cjs");

const ECHO = jj(ROOT, "example", "echo.cjs");
const BROKEN = jj(ROOT, "example", "broken.cjs");
const SLOW = jj(ROOT, "example", "slow.cjs");
const DELAYED = jj(ROOT, "example", "delayed.cjs");

// 一条 stdio NDJSON 客户端：next() 按到达顺序取帧，extra() 数「没人取的多余帧」。
function stdio(p) {
  const lines = [];
  const waiters = [];
  p.stdout.on("data", (d) => {
    for (const l of d.toString("utf8").split("\n")) {
      if (!l.trim()) continue;
      lines.push(JSON.parse(l));
      waiters.shift()?.();
    }
  });
  return {
    send: (o) => p.stdin.write(JSON.stringify(o) + "\n"),
    next: () =>
      new Promise((res, rej) => {
        if (lines.length > 0) return res(lines.shift());
        const timer = setTimeout(() => rej(new Error("server 无响应")), 5000);
        timer.unref();
        waiters.push(() => {
          clearTimeout(timer);
          res(lines.shift());
        });
      }),
    extra: () => lines.length,
  };
}

test("加载扩展后可列出描述符", async () => {
  const h = new ExtHost();
  assert.equal(await h.load(ECHO), true);
  assert.deepEqual(h.list(), ["example.echo"]);
  assert.equal(h.describe("example.echo").description, "回显传入文本，不触碰文件系统");
  assert.equal(h.listenerCount(), 0, "echo 不登记监听");
});

test("重名加载被拒绝且先注册的描述不被覆盖", async () => {
  const h = new ExtHost();
  await h.load(ECHO);
  assert.equal(await h.load(ECHO), false);
  assert.equal(h.list().length, 1);
  assert.equal(h.describe("example.echo").description, "回显传入文本，不触碰文件系统");
});

test("坏扩展进不了注册表，已注册工具不受影响", async () => {
  const h = new ExtHost();
  await h.load(ECHO);
  await assert.rejects(() => h.load(BROKEN), /broken-extension/);
  assert.deepEqual(h.list(), ["example.echo"]);
});

test("相对路径按宿主根解析，缺文件回报 load-error", async () => {
  const h = new ExtHost();
  assert.equal(await h.load("example/echo.cjs"), true, "相对路径须相对 extjs/ 解析");
  await assert.rejects(() => h.load("example/nope.cjs"), /load-error/);
  assert.deepEqual(h.list(), ["example.echo"]);
});

test("调用把参数透传给 handler 并回传结果", async () => {
  const h = new ExtHost();
  await h.load(ECHO);
  assert.deepEqual(await h.call("example.echo", { text: "hi" }), { echoed: "hi" });
});

test("调用未注册工具明确失败", async () => {
  const h = new ExtHost();
  await h.load(ECHO);
  await assert.rejects(() => h.call("no.such", {}), /unknown-tool/);
});

test("卸载后注册与监听残留为 0，二次卸载失败", async () => {
  const h = new ExtHost();
  assert.equal(await h.load(SLOW), true);
  assert.equal(h.listenerCount(), 2, "setup 登记了 2 个监听");
  assert.equal(h.list().length, 1);
  assert.equal(h.dispose("example.slow"), true);
  assert.deepEqual(h.list(), []);
  assert.equal(h.listenerCount(), 0);
  assert.equal(h.dispose("example.slow"), false, "句柄一次性，不得重复撤销凑数");
});

test("宿主退出时在途调用被结算而不是悬挂", async () => {
  const h = new ExtHost();
  await h.load(SLOW);
  const inflight = h.call("example.slow", {});
  await new Promise((r) => setImmediate(r));
  h.close();
  await assert.rejects(() => inflight, /host-exiting/);
  assert.equal(h.pendingCount(), 0);
});

test("list 是快照，改它不影响注册表", async () => {
  const h = new ExtHost();
  await h.load(ECHO);
  const snap = h.list();
  snap.push("ghost");
  assert.equal(h.list().length, 1);
});

// 协议层：独立 Node 进程 + NDJSON，证明宿主不依赖 Electron 也能被两端复用
test("server.cjs 走 NDJSON JSON-RPC 往返并支持 dispose", async () => {
  const p = spawn(process.execPath, [jj(ROOT, "server.cjs")], { stdio: ["pipe", "pipe", "pipe"] });
  const lines = [];
  const waiters = [];
  p.stdout.on("data", (d) => {
    for (const l of d.toString("utf8").split("\n")) {
      if (!l.trim()) continue;
      lines.push(JSON.parse(l));
      waiters.shift()?.();
    }
  });
  const next = () =>
    new Promise((res, rej) => {
      if (lines.length > 0) return res(lines.shift());
      const timer = setTimeout(() => rej(new Error("server 无响应")), 5000);
      timer.unref();
      waiters.push(() => {
        clearTimeout(timer);
        res(lines.shift());
      });
    });
  const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");

  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  const init = await next();
  assert.equal(init.result.protocolVersion, "0.1");
  assert.ok(init.result.capabilities.includes("extension/load"));

  send({ jsonrpc: "2.0", id: 2, method: "extension/load", params: { path: ECHO } });
  assert.equal((await next()).result.ok, true);

  send({ jsonrpc: "2.0", id: 3, method: "extension/call", params: { name: "example.echo", args: { text: "over-stdio" } } });
  assert.deepEqual((await next()).result, { echoed: "over-stdio" });

  send({ jsonrpc: "2.0", id: 4, method: "extension/dispose", params: { name: "example.echo" } });
  assert.equal((await next()).result.disposed, true);

  send({ jsonrpc: "2.0", id: 5, method: "extension/call", params: { name: "example.echo", args: {} } });
  const err = await next();
  assert.match(err.error.message, /unknown-tool/);

  p.stdin.end();
  await new Promise((r) => p.once("exit", r));
});

// 取消必须落在「在途那一次调用」上，而不是只把 handler 的 promise 丢掉：
// 每个 callId 只允许有一帧结算，迟到的 handler 结果不得再补一帧。
test("extension/cancel 按 callId 结算在途调用，只回一帧且迟到结果不再补帧", async () => {
  const p = spawn(process.execPath, [jj(ROOT, "server.cjs")], { stdio: ["pipe", "pipe", "pipe"] });
  const exited = new Promise((r) => p.once("exit", r));
  const c = stdio(p);
  try {
    c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const init = await c.next();
    assert.ok(init.result.capabilities.includes("extension/cancel"), "能力表须声明可取消");

    c.send({ jsonrpc: "2.0", id: 2, method: "extension/load", params: { path: DELAYED } });
    assert.equal((await c.next()).result.ok, true);

    c.send({ jsonrpc: "2.0", id: 3, method: "extension/call", params: { name: "example.delayed", args: { text: "never" }, callId: 77 } });
    await new Promise((r) => setImmediate(r));

    c.send({ jsonrpc: "2.0", id: 4, method: "extension/cancel", params: { callId: 77 } });
    const ack = await c.next();
    assert.equal(ack.id, 4);
    assert.equal(ack.result.cancelled, true, "取消在途调用须回 true");

    const settled = await c.next();
    assert.equal(settled.id, 3, "被取消的那次调用须按自己的 id 结算");
    assert.equal(settled.error.code, -32021);
    assert.match(settled.error.message, /cancelled/);

    // handler 是 300ms 后才 resolve 的：等到那之后再确认没有第二帧
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(c.extra(), 0, "取消后不得再为同一调用写出应答帧");
  } finally {
    p.stdin.end();
    p.kill();
    await exited;
  }
});

test("取消不存在或已结算的 callId 明确回 false，二次取消不重复结算", async () => {
  const p = spawn(process.execPath, [jj(ROOT, "server.cjs")], { stdio: ["pipe", "pipe", "pipe"] });
  const exited = new Promise((r) => p.once("exit", r));
  const c = stdio(p);
  try {
    c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await c.next();
    c.send({ jsonrpc: "2.0", id: 2, method: "extension/load", params: { path: DELAYED } });
    await c.next();

    c.send({ jsonrpc: "2.0", id: 3, method: "extension/cancel", params: { callId: 999 } });
    const miss = await c.next();
    assert.equal(miss.result.cancelled, false, "没有这条在途调用时不得假装取消成功");

    c.send({ jsonrpc: "2.0", id: 4, method: "extension/call", params: { name: "example.delayed", args: { text: "ok" }, callId: 88 } });
    c.send({ jsonrpc: "2.0", id: 5, method: "extension/cancel", params: { callId: 88 } });
    const ack = await c.next();
    assert.equal(ack.id, 5);
    assert.equal(ack.result.cancelled, true);
    const settled = await c.next();
    assert.equal(settled.id, 4);

    c.send({ jsonrpc: "2.0", id: 6, method: "extension/cancel", params: { callId: 88 } });
    const again = await c.next();
    assert.equal(again.result.cancelled, false, "已结算的调用二次取消须回 false");
    assert.equal(c.extra(), 0);
  } finally {
    p.stdin.end();
    p.kill();
    await exited;
  }
});

// 同一 callId 同时在途两次 = 调用方配对逻辑已经出错，宁可明确拒绝也不能把两笔混成一笔
test("重复的在途 callId 被明确拒绝，不与第一笔混账", async () => {
  const p = spawn(process.execPath, [jj(ROOT, "server.cjs")], { stdio: ["pipe", "pipe", "pipe"] });
  const exited = new Promise((r) => p.once("exit", r));
  const c = stdio(p);
  try {
    c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await c.next();
    c.send({ jsonrpc: "2.0", id: 2, method: "extension/load", params: { path: DELAYED } });
    await c.next();
    c.send({ jsonrpc: "2.0", id: 3, method: "extension/call", params: { name: "example.delayed", args: { text: "a" }, callId: 50 } });
    c.send({ jsonrpc: "2.0", id: 4, method: "extension/call", params: { name: "example.delayed", args: { text: "b" }, callId: 50 } });
    const dup = await c.next();
    assert.equal(dup.id, 4, "重复 callId 须按自己的 id 立刻报错");
    assert.equal(dup.error.code, -32022);
    assert.match(dup.error.message, /duplicate-callId/);
    const first = await c.next();
    assert.equal(first.id, 3, "第一笔仍须正常结算");
    assert.deepEqual(first.result, { echoed: "a" });
    assert.equal(c.extra(), 0);
  } finally {
    p.stdin.end();
    p.kill();
    await exited;
  }
});

// 父进程侧只用 std.io 的 OutputStream 接口（没有文档化的 close()），
// 所以温和退出必须有协议层的落点，不能只靠 stdin EOF。
test("host/shutdown 先应答、再结算在途调用、最后干净退出", async () => {
  const p = spawn(process.execPath, [jj(ROOT, "server.cjs")], { stdio: ["pipe", "pipe", "pipe"] });
  const exited = new Promise((r) => p.once("exit", r));
  // 断言失败也要收掉子进程，否则测试进程会一直被管道吊住（红灯变悬挂）
  try {
  const lines = [];
  const waiters = [];
  p.stdout.on("data", (d) => {
    for (const l of d.toString("utf8").split("\n")) {
      if (!l.trim()) continue;
      lines.push(JSON.parse(l));
      waiters.shift()?.();
    }
  });
  const next = () =>
    new Promise((res, rej) => {
      if (lines.length > 0) return res(lines.shift());
      const timer = setTimeout(() => rej(new Error("server 无响应")), 5000);
      timer.unref();
      waiters.push(() => {
        clearTimeout(timer);
        res(lines.shift());
      });
    });
  const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");

  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  const init = await next();
  assert.ok(init.result.capabilities.includes("host/shutdown"), "能力表须声明优雅退出");

  send({ jsonrpc: "2.0", id: 2, method: "extension/load", params: { path: SLOW } });
  assert.equal((await next()).result.ok, true);
  // 永不 resolve 的 handler：这一条请求按约定不会有应答，只能由 shutdown 结算
  send({ jsonrpc: "2.0", id: 3, method: "extension/call", params: { name: "example.slow", args: {} } });
  await new Promise((r) => setImmediate(r));

  send({ jsonrpc: "2.0", id: 4, method: "host/shutdown", params: {} });
  const bye = await next();
  assert.equal(bye.result.ok, true);
  assert.equal(bye.result.inflight, 1, "必须如实报在途条数，而不是假装没有");

  const settled = await next();
  assert.equal(settled.id, 3);
  assert.equal(settled.error.code, -32002);
  assert.match(settled.error.message, /host-exiting/);

  assert.equal(await exited, 0, "优雅退出必须是 0，不能靠强杀");
  } finally {
    p.stdin.end();
    p.kill();
  }
});

// 取消必须把「可以停了」这件事真交给扩展：只把等待者 reject 掉，扩展无从收手，
// 副作用照旧发生，而调用方拿到的却是一个叫「cancelled」的应答。
test("取消把 abort 信号交给扩展，等待者仍按 cancelled 结算", async () => {
  const WATCH = jj(ROOT, "example", "watchful.cjs");
  const mod = require(WATCH);
  mod.stats.started = 0;
  mod.stats.aborted = 0;
  mod.stats.ranOut = 0;
  const h = new ExtHost();
  assert.equal(await h.load(WATCH), true);
  const p = h.call("example.watchful", { text: "x" }, "w1");
  // 先把「这一笔会被结算」挂上去：拒绝发生在下一个 await 之前，晚一步认领就成了
  // 没人处理的 unhandledRejection
  const rejected = assert.rejects(p, /cancelled/);
  await new Promise((r) => setImmediate(r));

  // 契约不变：布尔只说「这条在途调用被结算了」
  assert.equal(h.cancel("w1"), true);
  await rejected;
  await new Promise((r) => setImmediate(r));
  assert.equal(mod.stats.aborted, 1, "扩展必须真的收到过 abort 信号");
  assert.equal(mod.stats.ranOut, 0, "收到信号就该提前收束，而不是跑满窗口");
});

// 「取消成功」不等于「副作用停止了」：这条区别不许被抹平。
// 协作的扩展记成 settled，不协作的记成 still-running，都写进 stderr 诊断面——
// 应答帧保持原样，否则取消的应答会排到那条 call 自己的结算帧之后。
test("收束情况记到诊断面：协作 settled，不协作 still-running", async () => {
  const WATCH = jj(ROOT, "example", "watchful.cjs");
  const wrote = [];
  const real = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { wrote.push(String(chunk)); return true; };
  try {
    const h1 = new ExtHost();
    await h1.load(SLOW);
    const p1 = h1.call("example.slow", {}, "s1");
    const r1 = assert.rejects(p1, /cancelled/);
    await new Promise((r) => setImmediate(r));
    assert.equal(h1.cancel("s1", { settleMs: 20 }), true);
    await r1;
    await new Promise((r) => setTimeout(r, 60));
    assert.ok(wrote.some((l) => /cancel-settle callId=s1 outcome=still-running/.test(l)),
      `没记到 still-running：${JSON.stringify(wrote)}`);
    require(SLOW).resolvePending();

    const h2 = new ExtHost();
    await h2.load(WATCH);
    const p2 = h2.call("example.watchful", { text: "y" }, "w2");
    const r2 = assert.rejects(p2, /cancelled/);
    await new Promise((r) => setImmediate(r));
    assert.equal(h2.cancel("w2", { settleMs: 500 }), true);
    await r2;
    await new Promise((r) => setTimeout(r, 60));
    assert.ok(wrote.some((l) => /cancel-settle callId=w2 outcome=settled/.test(l)),
      `没记到 settled：${JSON.stringify(wrote)}`);
  } finally {
    process.stderr.write = real;
  }
});

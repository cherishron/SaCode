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

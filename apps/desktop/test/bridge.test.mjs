import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join as jj, resolve } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { HostBridge } = require("../host-bridge.cjs");

const REPO = jj(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// 自包含 host（exe + 全部依赖 DLL 同目录，由 scripts/pack-host.mjs 生成），
// 因此测试不再拼 PATH，也不出现任何字面 Windows 路径。
const HOST = resolve(process.env.DSH_HOST || jj(REPO, "apps", "desktop", "dist", "host", "bin", "dsh-host.exe"));
const SEED = "0\tturn/start\tt\n1\tsystem\tx\n2\tuser/message\tfrom desktop\n3\tassistant/message\thello desktop\n";

async function boot() {
  // 不依赖仓库里预先存在某个临时目录：自己把它建出来
  const root = jj(REPO, "dualtest");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(jj(root, "dst-"));
  writeFileSync(join(dir, "session.log"), SEED);
  if (!existsSync(HOST)) {
    throw new Error(`缺少自包含 host：${HOST}，请先跑 node scripts/pack-host.mjs`);
  }
  const b = new HostBridge(HOST, process.env);
  await b.start(dir);
  return { b, dir };
}

test("握手声明协议与能力", async () => {
  const { b } = await boot();
  const r = await b.request("initialize");
  assert.equal(r.protocolVersion, "0.1");
  assert.ok(r.capabilities.includes("session/projection"));
  await b.stop();
});

test("投影与 CLI 同源", async () => {
  const { b } = await boot();
  const p = await b.request("session/projection");
  assert.equal(p.events, 4);
  assert.equal(p.projection, 2);
  await b.stop();
});

test("经协议写入后可见且落盘", async () => {
  const { b, dir } = await boot();
  const a = await b.request("session/append", { eventType: "user/message", data: "desktop write" });
  assert.equal(a.events, 5);
  const p = await b.request("session/projection");
  assert.equal(p.projection, 3);
  assert.ok(existsSync(join(dir, "session.log")));
  await b.stop();
});

test("租约冲突以 JSON-RPC 错误传播", async () => {
  const { b, dir } = await boot();
  writeFileSync(join(dir, "session.log.lease"), "held");
  await assert.rejects(() => b.request("session/append", { eventType: "user/message", data: "blocked" }), /already-owned/);
  await b.stop();
});

test("未知方法返回 -32601", async () => {
  const { b } = await boot();
  await assert.rejects(() => b.request("no/such"), /-32601|method not found/);
  await b.stop();
});

// C2 追加：durability 屏障 —— append/submit 只在实例内可见，flush 才跨进程可见
test("submit 未 flush 时订阅者看不到，flush 后跨进程可见", async () => {
  const { b, dir } = await boot();
  const s1 = await b.request("session/submit", { eventType: "user/message", data: "pending a" });
  assert.equal(s1.events, 5);
  assert.equal(s1.durable, 4);
  const p = await b.request("session/projection");
  assert.equal(p.events, 5, "实例内可见");
  assert.equal(p.pending, 1);
  assert.equal(p.durable, 4);
  const before = await b.request("session/subscribe", { cursor: 0 });
  assert.equal(before.events.length, 4, "未 flush 不得进入持久回放");
  const f = await b.request("session/flush");
  assert.equal(f.durable, 5);
  const after = await b.request("session/subscribe", { cursor: 4 });
  assert.deepEqual(after.events, [{ seq: 4, type: "user/message" }]);
  assert.equal(after.more, false);
  assert.ok(existsSync(join(dir, "session.log")));
  await b.stop();
});

test("无待写事件时 flush 明确拒绝", async () => {
  const { b } = await boot();
  await assert.rejects(() => b.request("session/flush"), /-32004|no-pending-writes/);
  await b.stop();
});

test("订阅按 cursor/limit 分页并给出 more", async () => {
  const { b } = await boot();
  const p1 = await b.request("session/subscribe", { cursor: 0, limit: 2 });
  assert.equal(p1.events.length, 2);
  assert.equal(p1.nextCursor, 2);
  assert.equal(p1.more, true);
  const p2 = await b.request("session/subscribe", { cursor: p1.nextCursor, limit: 2 });
  assert.equal(p2.events.length, 2);
  assert.equal(p2.nextCursor, 4);
  assert.equal(p2.more, false);
  const p3 = await b.request("session/subscribe", { cursor: 4 });
  assert.equal(p3.events.length, 0);
  assert.equal(p3.more, false);
  await b.stop();
});

// C5/C2：宿主退出时未 flush 的写入必须被结算（落盘 + 归还租约），不得静默丢失
test("宿主退出前结算未 flush 的写入并归还租约", async () => {
  const { b, dir } = await boot();
  const s = await b.request("session/submit", { eventType: "assistant/message", data: "settled on exit" });
  assert.equal(s.durable, 4);
  const r = await b.stop();
  assert.equal(r.forced, false, "必须走优雅退出而不是强杀");
  assert.equal(existsSync(join(dir, "session.log.lease")), false, "退出后不得留下写租约");
  assert.ok(readFileSync(join(dir, "session.log"), "utf8").includes("4\tassistant/message\tsettled on exit"));
  const b2 = new HostBridge(HOST, process.env);
  await b2.start(dir);
  const sub = await b2.request("session/subscribe", { cursor: 4 });
  assert.deepEqual(sub.events, [{ seq: 4, type: "assistant/message" }]);
  const a = await b2.request("session/append", { eventType: "user/message", data: "next writer" });
  assert.equal(a.events, 6, "结算后下一个写者能拿到租约");
  await b2.stop();
});

// C5：扩展注册表是 CLI 与桌面共用的唯一真源 —— 桌面入口必须看到同一内置工具集
test("桌面入口的 extension/list 与 CLI 内置注册表一致", async () => {
  const { b } = await boot();
  const l = await b.request("extension/list", {});
  assert.deepEqual(l.tools.map((t) => t.name), ["write"]);
  assert.equal(l.tools[0].needsApproval, true, "内置写文件工具必须默认要审批");
  await b.stop();
});

// 反向：未登记工具与无应答审批都必须走 JSON-RPC 错误，不得静默放行
test("extension/call 未登记工具与 fail-closed 审批都被拒", async () => {
  const { b } = await boot();
  await assert.rejects(() => b.request("extension/call", { name: "no.such", args: "a b", approval: "allowed-once" }), /unregistered-tool:no.such/);
  await assert.rejects(() => b.request("extension/call", { name: "write", args: "probe.txt hi", approval: "none" }), /approval-not-allowed-once/);
  const ok = await b.request("extension/call", { name: "write", args: "probe.txt hi", approval: "allowed-once" });
  assert.equal(ok.result, "ok:probe.txt");
  const l = await b.request("extension/list", {});
  assert.equal(l.misses, 1, "未登记拒绝必须计数");
  await b.stop();
});

test("extension/dispose 后注册表清空且二次卸载失败", async () => {
  const { b, dir } = await boot();
  const d = await b.request("extension/dispose", { name: "write" });
  assert.equal(d.disposed, true);
  assert.deepEqual((await b.request("extension/list", {})).tools, []);
  const again = await b.request("extension/dispose", { name: "write" });
  assert.equal(again.disposed, false, "句柄一次性，不得重复撤销凑数");
  await assert.rejects(() => b.request("extension/call", { name: "write", args: "x.txt y", approval: "allowed-once" }), /unregistered-tool:write/);
  await b.stop();
  assert.equal(existsSync(join(dir, "session.log.lease")), false, "工具事件写入后退出仍须归还租约");
});

// 全新会话（还没有 session.log 文件）是桌面的第一条黄金路径：
// 第一次写入与第一个 turn 都必须能进去，不能被当成损坏回放。
async function bootFresh() {
  const root = jj(REPO, "dualtest");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(jj(root, "fresh-"));
  const b = new HostBridge(HOST, process.env);
  await b.start(dir);
  return { b, dir };
}

const nap = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollUntilSettled(b, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const p = await b.request("turn/poll", {});
    if (p.settled) return p;
    await nap(10);
  }
  assert.fail(`turn 在 ${tries} 次轮询后仍未结算`);
}

test("turn 控制方法在握手能力里声明", async () => {
  const { b } = await boot();
  const r = await b.request("initialize");
  for (const m of ["turn/start", "turn/cancel", "turn/poll"]) {
    assert.ok(r.capabilities.includes(m), `能力表缺 ${m}`);
  }
  await b.stop();
});

test("全新会话第一个 turn 能在流中被取消并结算", async () => {
  const { b, dir } = await bootFresh();
  const s = await b.request("turn/start", { limit: 2 });
  assert.equal(s.started, true);
  let p = { frames: [] };
  for (let i = 0; i < 40 && p.frames.length < 2; i++) {
    p = await b.request("turn/poll", {});
    if (p.frames.length < 2) await nap(10);
  }
  assert.deepEqual(p.frames, ["text:你好，", "text:world"], "帧必须来自独立线程的投递");
  assert.equal(p.running, true);
  await assert.rejects(
    () => b.request("session/submit", { eventType: "user/message", data: "during turn" }),
    /turn-in-flight/,
    "turn 在途时不得出现第二个写者"
  );
  const c = await b.request("turn/cancel", {});
  assert.equal(c.cancelRequested, true);
  assert.equal(c.wasRunning, true);
  const done = await pollUntilSettled(b);
  assert.equal(done.cancelled, true);
  assert.equal(done.delivered, 2);
  assert.equal(done.text, "你好，world", "已产出的部分文本不得丢");
  assert.equal(done.finishReason, "", "被取消的 turn 没有终态原因");
  assert.equal(done.interrupted, true);
  assert.equal(done.pendingToolCalls, 0, "不留悬挂 tool call");
  assert.equal(done.dropped, 0, "背压只报信号，不丢帧");
  const proj = await b.request("session/projection");
  assert.equal(proj.events, 4, "turn/start + 2 帧 + turn/cancelled");
  assert.equal(proj.durable, 4);
  assert.equal(proj.pending, 0);
  await b.stop();
  assert.equal(existsSync(join(dir, "session.log.lease")), false, "结算后必须归还写租约");
  assert.ok(readFileSync(join(dir, "session.log"), "utf8").includes("turn/cancelled"));
});

test("没有在途 turn 时取消与轮询都不得编造终态", async () => {
  const { b } = await boot();
  const c = await b.request("turn/cancel", {});
  assert.equal(c.cancelRequested, false);
  assert.equal(c.wasRunning, false, "不得假装取消了一个不存在的 turn");
  const p = await b.request("turn/poll", {});
  assert.equal(p.turn, false);
  assert.equal(p.running, false);
  assert.equal(p.settled, false);
  assert.deepEqual(p.frames, []);
  await b.stop();
});

test("宿主退出前取消并结算在途 turn，不丢日志不留租约", async () => {
  const { b, dir } = await bootFresh();
  const s = await b.request("turn/start", { limit: 2 });
  assert.equal(s.started, true);
  await nap(60);
  // 直接关 stdin：在途 turn 必须被取消并 join，然后落盘、归还租约
  await b.stop();
  assert.equal(existsSync(join(dir, "session.log.lease")), false, "退出后不得留下写租约");
  const text = readFileSync(join(dir, "session.log"), "utf8");
  assert.ok(text.includes("turn/start"), "turn/start 必须已落盘");
  assert.ok(text.includes("turn/cancelled"), "退出结算必须写下取消终态");
});

// 流式期读侧不再被一律串行挡掉：桌面要能边流式边看状态。
// 依据是 core 的 SessionLog 访问已全部加锁（loglock_test 钉住），读的是自洽快照。
test("turn 在途时读投影与订阅不再被拒，写侧仍串行", async () => {
  const { b } = await bootFresh();
  const s = await b.request("turn/start", { limit: 2 });
  assert.equal(s.started, true);
  await nap(150);
  const p = await b.request("session/projection", {});
  assert.ok(p.events >= 3, `流式期读不到状态：${JSON.stringify(p)}`);
  assert.equal(p.durable, 0, "turn 在途尚未 flush，跨进程不可见");
  assert.equal(p.pending, p.events, "内存态与已落盘的差额必须如实报 pending");
  const sub = await b.request("session/subscribe", { cursor: 0 });
  assert.deepEqual(sub.events, [], "订阅只回放已落盘事件");
  await assert.rejects(
    () => b.request("session/submit", { eventType: "user/message", data: "mid-turn" }),
    /turn-in-flight/,
    "写侧仍是单一写者"
  );
  // 读侧验完再收：provider 停在帧间等取消，不发起取消就永远结算不了
  const c = await b.request("turn/cancel", {});
  assert.equal(c.cancelRequested, true);
  const done = await pollUntilSettled(b);
  assert.equal(done.settled, true);
  const after = await b.request("session/projection", {});
  assert.equal(after.durable, after.events, "结算后应全部落盘");
  assert.ok(after.events >= p.events, "结算后读数不得回退");
  await b.stop();
});

// C5 桌面入口：JS 动态扩展必须由仓颉核心驱动的子进程提供，桌面看到的应答只能来自子进程。
// 注：宿主侧 jsonStr 不做反斜杠解转义，所以路径参数一律用正斜杠形式。
const fwd = (p) => p.replace(/\\/g, "/");
const NODE_CMD = fwd(process.execPath);
const EXTJS_DIR = fwd(jj(REPO, "extjs"));

test("桌面入口经 core 拉起 JS 宿主并完成 load/list/call/dispose", async () => {
  const { b } = await boot();
  const sp = await b.request("extension/host/spawn", { node: NODE_CMD, dir: EXTJS_DIR });
  assert.equal(sp.spawned, true);
  assert.ok(sp.handshake.result.capabilities.includes("host/shutdown"), "能力表必须来自子进程真实应答");
  const pid = sp.handshake.result.process.pid;
  const ld = await b.request("extension/host/load", { path: "example/echo.cjs" });
  assert.equal(ld.forwarded.result.ok, true);
  const ls = await b.request("extension/host/list", {});
  assert.deepEqual(ls.forwarded.result.names, ["example.echo"]);
  const cl = await b.request("extension/host/call", { name: "example.echo", text: "from-desktop" });
  assert.deepEqual(cl.forwarded.result, { echoed: "from-desktop" });
  const dp = await b.request("extension/host/dispose", { name: "example.echo" });
  assert.equal(dp.forwarded.result.disposed, true);
  const after = await b.request("extension/host/list", {});
  assert.deepEqual(after.forwarded.result.names, [], "卸载残留必须为 0");
  const cs = await b.request("extension/host/close", {});
  assert.equal(cs.exit, 0, "JS 宿主须自己结算退出");
  assert.equal(cs.forced, false, "不得靠强杀收场");
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch (e) {
    alive = false;
  }
  assert.equal(alive, false, "close 后子进程不得存活");
  await b.stop();
});

test("未 spawn 时转调与结算都明确失败，不得静默返回空表", async () => {
  const { b } = await boot();
  await assert.rejects(() => b.request("extension/host/list", {}), /js-host-not-spawned/);
  await assert.rejects(() => b.request("extension/host/call", { name: "example.echo", text: "x" }), /js-host-not-spawned/);
  await assert.rejects(() => b.request("extension/host/close", {}), /js-host-not-spawned/);
  await b.stop();
});

test("重复 spawn 被拒且不得把已运行的宿主弄丢", async () => {
  const { b } = await boot();
  const sp = await b.request("extension/host/spawn", { node: NODE_CMD, dir: EXTJS_DIR });
  assert.equal(sp.spawned, true);
  await assert.rejects(() => b.request("extension/host/spawn", { node: NODE_CMD, dir: EXTJS_DIR }), /js-host-already-running/);
  const ls = await b.request("extension/host/list", {});
  assert.ok(Array.isArray(ls.forwarded.result.names), "第二次 spawn 失败后原宿主必须还可用");
  const cs = await b.request("extension/host/close", {});
  assert.equal(cs.forced, false);
  await b.stop();
});

test("桌面宿主退出前结算 JS 子进程，不留孤儿", async () => {
  const { b } = await boot();
  const sp = await b.request("extension/host/spawn", { node: NODE_CMD, dir: EXTJS_DIR });
  const pid = sp.handshake.result.process.pid;
  await b.stop();
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch (e) {
    alive = false;
  }
  assert.equal(alive, false, "父宿主退出后 JS 子进程不得存活");
});


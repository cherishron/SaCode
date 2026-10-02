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

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join as jj } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { HostBridge } = require("../host-bridge.cjs");

const REPO = jj(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HOST = process.env.DSH_HOST || join(REPO, "apps/host/target/release/bin/main.exe");
const STDX = process.env.DSH_STDX_BIN || "C:\\Users\\jingg\\stdx-work\\stdx-1.1.3.1\\windows_x86_64_cjnative\\dynamic\\stdx";
const SEED = "0\tturn/start\tt\n1\tsystem\tx\n2\tuser/message\tfrom desktop\n3\tassistant/message\thello desktop\n";

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), "dsh-desktop-"));
  writeFileSync(join(dir, "session.log"), SEED);
  const b = new HostBridge(HOST, { ...process.env, PATH: `${process.env.PATH};${STDX}` });
  await b.start(dir);
  return { b, dir };
}

test("握手声明协议与能力", async () => {
  const { b } = await boot();
  const r = await b.request("initialize");
  assert.equal(r.protocolVersion, "0.1");
  assert.ok(r.capabilities.includes("session/projection"));
  b.stop();
});

test("投影与 CLI 同源", async () => {
  const { b } = await boot();
  const p = await b.request("session/projection");
  assert.equal(p.events, 4);
  assert.equal(p.projection, 2);
  b.stop();
});

test("经协议写入后可见且落盘", async () => {
  const { b, dir } = await boot();
  const a = await b.request("session/append", { eventType: "user/message", data: "desktop write" });
  assert.equal(a.events, 5);
  const p = await b.request("session/projection");
  assert.equal(p.projection, 3);
  assert.ok(existsSync(join(dir, "session.log")));
  b.stop();
});

test("租约冲突以 JSON-RPC 错误传播", async () => {
  const { b, dir } = await boot();
  writeFileSync(join(dir, "session.log.lease"), "held");
  await assert.rejects(() => b.request("session/append", { eventType: "user/message", data: "blocked" }), /already-owned/);
  b.stop();
});

test("未知方法返回 -32601", async () => {
  const { b } = await boot();
  await assert.rejects(() => b.request("no/such"), /-32601|method not found/);
  b.stop();
});

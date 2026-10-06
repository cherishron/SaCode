import { fixtureHostEnv } from '../test-support/fixture-env.mjs';
// 桌面入口的「助手回复跨进程回放」验收（矩阵 71 conversation 的数据面前提）。
// 单独成文件而不加进 bridge.test.mjs，是因为那个文件里同时躺着另一路会话未落库的改动。
// 这里钉的是：turn 干净收束后，助手正文必须由核心落进 session.log，
// 投影与磁盘都读得到；被取消的一轮则不得冒充一份完整回复。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join as jj, resolve } from "node:path";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
const require = createRequire(import.meta.url);
const { HostBridge } = require("../host-bridge.cjs");

const REPO = jj(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HOST = resolve(process.env.SACODE_HOST || jj(REPO, "apps", "desktop", "dist", "host", "bin", "sacode-host.exe"));

async function bootFresh(tag) {
  const root = jj(REPO, "dualtest", "settle");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(jj(root, tag + "-"));
  if (!existsSync(HOST)) {
    throw new Error(`缺少自包含 host：${HOST}，请先跑 node scripts/pack-host.mjs`);
  }
  const b = new HostBridge(HOST, fixtureHostEnv(dir));
  await b.start(dir);
  return { b, dir };
}

async function pollUntilSettled(b, tries = 300) {
  for (let i = 0; i < tries; i++) {
    const p = await b.request("turn/poll", {});
    if (p.settled) return p;
    await sleep(10);
  }
  assert.fail(`turn 在 ${tries} 次轮询后仍未结算`);
}

test("干净收束后投影含助手正文", async () => {
  const { b } = await bootFresh("projection");
  try {
    const before = await b.request("session/projection", {});
    const st = await b.request("turn/start", { limit: 5 });
    assert.equal(st.started, true);
    const p = await pollUntilSettled(b);
    assert.equal(p.cancelled, false, "这一轮是干净收束，不是取消");

    const proj = await b.request("session/projection", {});
    assert.ok(
      proj.messages.includes("assistant/message: 你好，world"),
      `投影里没有助手正文：${JSON.stringify(proj.messages)}`
    );
    // 只多一条 surface 事件：落两次会让模型历史出现重复回复
    assert.equal(
      proj.projection - before.projection,
      1,
      `投影条数应从 ${before.projection} 增至 ${before.projection + 1}，实为 ${proj.projection}`
    );
  } finally {
    await b.stop();
  }
});

test("干净收束后助手正文已跨进程落盘", async () => {
  const { b, dir } = await bootFresh("durable");
  try {
    await b.request("turn/start", { limit: 5 });
    await pollUntilSettled(b);
    const log = readFileSync(jj(dir, "session.log"), "utf8");
    const lines = log.split("\n").filter((l) => l.length > 0);
    const hits = lines.filter((l) => /\tassistant\/message\t你好，world$/.test(l));
    assert.equal(hits.length, 1, `磁盘上助手正文应有 1 行，实为 ${hits.length}：${JSON.stringify(lines)}`);
    // 结算时的 flush 必须真的把这一行带出去：pending 归 0 才算跨进程可见
    const proj = await b.request("session/projection", {});
    assert.equal(proj.pending, 0, `结算后仍有 ${proj.pending} 条未落盘`);
  } finally {
    await b.stop();
  }
});

test("被取消的一轮不落助手正文", async () => {
  const { b, dir } = await bootFresh("cancelled");
  try {
    // limit=2：前两帧产出后停在帧间等取消，这一轮没有终态原因
    const st = await b.request("turn/start", { limit: 2 });
    assert.equal(st.started, true);
    let sawFrames = false;
    for (let i = 0; i < 300 && !sawFrames; i++) {
      const p = await b.request("turn/poll", {});
      sawFrames = (p.frames || []).length > 0;
      if (!sawFrames) await sleep(10);
    }
    assert.ok(sawFrames, "取消前必须已在流中投出过帧");
    await b.request("turn/cancel", {});
    const r = await pollUntilSettled(b);
    assert.equal(r.cancelled, true);
    assert.equal(r.text, "你好，world", "半截正文仍在结算帧里交给界面呈现");

    const proj = await b.request("session/projection", {});
    assert.ok(
      !proj.messages.some((m) => m.startsWith("assistant/message")),
      `取消的一轮不该进模型历史：${JSON.stringify(proj.messages)}`
    );
    const log = readFileSync(jj(dir, "session.log"), "utf8");
    assert.ok(!log.includes("assistant/message"), "磁盘日志同样不应出现冒充完整回复的行");
    assert.ok(log.includes("turn/cancelled"), "取消的一轮要留下 turn/cancelled");
  } finally {
    await b.stop();
  }
});

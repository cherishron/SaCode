// 桌面入口的 token 计量与预算验收（矩阵 53 token-meter）。
// 单独成文件而不是加进 bridge.test.mjs，是因为那个文件里同时躺着另一路会话未落库的改动；
// 这里的每条用例都自己建会话目录，跑多少次都不受别的用例的累计态影响。
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
const HOST = resolve(process.env.DSH_HOST || jj(REPO, "apps", "desktop", "dist", "host", "bin", "dsh-host.exe"));

async function bootFresh(tag) {
  // 落在已被 .gitignore 的 dualtest 里，不再往仓库根添新的临时目录
  const root = jj(REPO, "dualtest", "usage");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(jj(root, tag + "-"));
  const b = new HostBridge(HOST, process.env);
  await b.start(dir);
  return { b, dir };
}

async function pollUntilSettled(b, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const p = await b.request("turn/poll", {});
    if (p.settled) return p;
    await sleep(10);
  }
  assert.fail(`turn 在 ${tries} 次轮询后仍未结算`);
}

test("完整一轮把 usage 记进日志，usage/status 与 turn/poll 读数一致", async () => {
  const { b, dir } = await bootFresh("record");
  try {
    const st = await b.request("turn/start", { limit: 5 });
    assert.equal(st.started, true);
    const t = await pollUntilSettled(b);
    assert.equal(t.finishReason, "stop");
    assert.equal(t.usage, "12");
    assert.equal(t.usageVerdict, "recorded", "跑完的一轮必须真的记上账");
    // 全新会话的第一笔就是 12，不是 12 的其它倍数——这条钉住「起点为零」
    assert.equal(t.used, 12);
    assert.equal(t.budget, 200);
    assert.equal(t.over, false);
    const s = await b.request("usage/status", {});
    assert.equal(s.used, t.used, "读数以日志为准，两个入口不许给出两个数");
    assert.equal(s.budget, 200);
    assert.equal(s.badUsage, 0);
    assert.match(readFileSync(jj(dir, "session.log"), "utf8"), /turn\/usage\t12:12/);
  } finally {
    await b.stop();
  }
});

test("预算只可收紧：调大、持平、缺参数都被拒且停在原档", async () => {
  const { b } = await bootFresh("tighten");
  try {
    const up = await b.request("usage/set-budget", { budget: 999999 });
    assert.equal(up.applied, false, "调大预算就是放宽防额，必须拒");
    assert.equal(up.budget, 200);
    const same = await b.request("usage/set-budget", { budget: 200 });
    assert.equal(same.applied, false, "持平不算收紧");
    // 缺参数既不能当成「收紧到 0」把会话打死，也不能默认放行
    const missing = await b.request("usage/set-budget", {});
    assert.equal(missing.applied, false);
    assert.equal(missing.budget, 200);
    const down = await b.request("usage/set-budget", { budget: 20 });
    assert.equal(down.applied, true);
    assert.equal(down.budget, 20);
    const widen = await b.request("usage/set-budget", { budget: 30 });
    assert.equal(widen.applied, false);
    assert.equal(widen.budget, 20, "已收紧的档位不能被后来的宽松请求抬回去");
  } finally {
    await b.stop();
  }
});

test("超档的一轮不计入，之后不再开新轮", async () => {
  const { b, dir } = await bootFresh("over");
  try {
    const d = await b.request("usage/set-budget", { budget: 5 });
    assert.equal(d.applied, true);
    await b.request("turn/start", { limit: 5 });
    const t = await pollUntilSettled(b);
    assert.equal(t.usageVerdict, "over-budget");
    assert.equal(t.used, 0, "超预算的那一笔不许先记了再红字提醒");
    assert.equal(t.over, true);
    // 拦过一次就说明越了人工档位：下一步是停下来问人，而不是自动换个小轮次继续花
    await assert.rejects(
      () => b.request("turn/start", { limit: 5 }),
      /-32014|over-budget/,
      "超档后协议面必须拒绝开新轮"
    );
    // 拒绝开新轮不该把写租约留在手里，否则下一次启动只能靠接管
    assert.equal(existsSync(jj(dir, "session.log.lease")), false, "拒绝开新轮也要归还写租约");
  } finally {
    await b.stop();
  }
});

test("换个进程只靠会话日志重算：用量、超档与预算档位都不丢", async () => {
  const { b, dir } = await bootFresh("restart");
  await b.request("usage/set-budget", { budget: 5 });
  await b.request("turn/start", { limit: 5 });
  const t = await pollUntilSettled(b);
  assert.equal(t.usageVerdict, "over-budget");
  await b.stop();
  // 全新宿主进程、同一会话目录：账与档位必须从盘上长回来，否则重启就是放宽的后门
  // 复用上一个进程的会话目录，起一个全新宿主进程
  const b3 = new HostBridge(HOST, process.env);
  await b3.start(dir);
  try {
    const s = await b3.request("usage/status", {});
    assert.equal(s.used, 0, "被拒的那笔不该在重启后被算成已花掉");
    assert.equal(s.over, true, "重启后必须仍记得被拦过");
    assert.equal(s.budget, 5, "重启不得把收紧过的档位洗回默认宽档");
    await assert.rejects(() => b3.request("turn/start", { limit: 5 }), /-32014|over-budget/);
  } finally {
    await b3.stop();
  }
});

test("turn 在途时读数与收紧预算都进得来，写侧仍串行", async () => {
  const { b } = await bootFresh("inflight");
  try {
    await b.request("turn/start", { limit: 2 });
    const s = await b.request("usage/status", {});
    assert.equal(s.budget, 200, "在途期间读数不该被 turn-in-flight 挡掉");
    const d = await b.request("usage/set-budget", { budget: 50 });
    assert.equal(d.applied, true, "在途期间也该能把档位收紧");
    await assert.rejects(() => b.request("session/append", { eventType: "user/message", data: "x" }), /turn-in-flight/,
      "会动日志的写侧仍然要串行");
    // limit=2 是「停在帧间等取消」，不会自己收束：先取消，再看没跑完的轮次欠不欠账
    const cx = await b.request("turn/cancel", {});
    assert.equal(cx.cancelRequested, true);
    const t = await pollUntilSettled(b);
    // limit=2 只发两帧就正常收束、没有 finish：这样的轮次不该被计量
    assert.equal(t.finishReason, "");
    assert.equal(t.usageVerdict, "absent", "没跑完的轮次本来就没花钱，记它等于把取消变成消耗");
    assert.equal(t.used, 0);
    assert.equal(t.budget, 50, "在途期间收紧的档位要留在这一轮的结算帧上");
  } finally {
    await b.stop();
  }
});

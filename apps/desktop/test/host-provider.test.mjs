import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join as jj, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { HostBridge } = require("../host-bridge.cjs");

const REPO = jj(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HOST = resolve(process.env.DSH_HOST || jj(REPO, "apps", "desktop", "dist", "host", "bin", "dsh-host.exe"));
const FIXTURE = resolve(jj(REPO, "scripts", "sse-contract-server.cjs"));
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

// 启动本机 SSE 夹具，读 stdout 第一行拿 plain port；测试结束写 stdin 触发退出。
async function startFixture() {
  const proc = spawn(process.execPath, [FIXTURE], { stdio: ["pipe", "pipe", "pipe"] });
  const port = await new Promise((res, rej) => {
    let buf = "";
    const to = setTimeout(() => rej(new Error("fixture 启动超时")), 8000);
    proc.stdout.on("data", (d) => {
      buf += d.toString();
      const i = buf.indexOf("\n");
      if (i >= 0) {
        clearTimeout(to);
        res(buf.slice(0, i).trim());
      }
    });
    proc.stderr.on("data", (d) => process.stderr.write(`[fixture] ${d}`));
    proc.on("error", (e) => { clearTimeout(to); rej(e); });
    proc.on("exit", (code, signal) => {
      clearTimeout(to);
      rej(new Error(`fixture 提前退出: code=${code} signal=${signal}`));
    });
  });
  return { proc, port: Number(port) };
}

function stopFixture(proc) {
  try { proc.stdin.write("x"); } catch (_) {}
  try { proc.stdin.end(); } catch (_) {}
  try { proc.kill(); } catch (_) {}
}

// 全新会话目录：host 以 "current" 会话启动，submit 直接写入。
function freshDir() {
  const root = jj(REPO, "dualtest");
  mkdirSync(root, { recursive: true });
  return mkdtempSync(jj(root, "sse-"));
}

test("真实 SSE provider 跑通本机夹具的 OpenAI 流", async () => {
  if (!existsSync(HOST)) {
    throw new Error(`缺少自包含 host：${HOST}，请先重建宿主`);
  }
  const fixture = await startFixture();
  try {
    const dir = freshDir();
    const env = {
      ...process.env,
      DSH_PROVIDER_BASE_URL: `http://127.0.0.1:${fixture.port}`,
      DSH_PROVIDER_MODEL: "fixture",
      DSH_PROVIDER_KEY: "fixture-only",
    };
    const b = new HostBridge(HOST, env);
    await b.start(dir);
    try {
      // 请求序列：initialize → session/submit → turn/start → 循环 turn/poll 直到结算
      await b.request("initialize");

      const submitted = await b.request("session/submit", { eventType: "user", data: "hello" });
      assert.ok(submitted.events >= 1, "submit 后至少一条事件");

      const st = await b.request("turn/start", { limit: 2 });
      assert.equal(st.started, true, "turn 必须启动");
      // 红灯断言：旧宿主无 provider 字段（undefined），新宿主应为 "real"
      assert.equal(st.provider, "real", `provider 字段须为 "real"，实得: ${JSON.stringify(st)}`);

      // 循环 poll 直到 settled，收集全部 frames
      const allFrames = [];
      let settled = false;
      let settledResult = null;
      for (let i = 0; i < 120; i++) {
        const p = await b.request("turn/poll", {});
        allFrames.push(...p.frames);
        if (p.settled) {
          settled = true;
          settledResult = p;
          break;
        }
        if (p.running) await nap(10);
      }
      assert.equal(settled, true, "turn 必须自然结算（真实流结束即停）");

      // 断言：polled frames 里存在 "text:first"
      assert.ok(
        allFrames.some((f) => f === "text:first"),
        `polled frames 须包含 "text:first"，实得: ${JSON.stringify(allFrames)}`,
      );

      // 断言：终态来自真实 SSE（finishReason=stop, usage=22, text=first）
      assert.equal(settledResult.text, "first", `终态 text 须为 "first"，实得: ${settledResult.text}`);
      assert.equal(settledResult.finishReason, "stop", `finishReason 须为 "stop"，实得: ${settledResult.finishReason}`);
      assert.equal(settledResult.usage, "22", `usage 须为 "22"，实得: ${settledResult.usage}`);

      // 断言：projection 看到 assistant/message 且正文含 "first"
      const proj = await b.request("session/projection", {});
      const assistantMsg = (proj.messages || []).find((m) => m.startsWith("assistant/message:"));
      assert.ok(assistantMsg, `投影须含 assistant/message，实得: ${JSON.stringify(proj.messages)}`);
      assert.ok(
        assistantMsg.includes("first"),
        `assistant 消息正文须含 "first"，实得: ${assistantMsg}`,
      );
    } finally {
      await b.stop();
    }
  } finally {
    stopFixture(fixture.proc);
  }
});

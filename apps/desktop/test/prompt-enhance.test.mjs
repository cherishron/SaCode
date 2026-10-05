import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join as jj, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { HostBridge } = require("../host-bridge.cjs");

const REPO = jj(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HOST = process.env.DSH_HOST || resolve(jj(REPO, "apps", "desktop", "dist", "host", "bin", "dsh-host.exe"));
const FIXTURE = resolve(jj(REPO, "scripts", "sse-contract-server.cjs"));
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

// 本机 SSE 夹具：stdout 第一行是明文端口。
async function startFixture() {
  const proc = spawn(process.execPath, [FIXTURE], { stdio: ["pipe", "pipe", "pipe"] });
  const port = await new Promise((res, rej) => {
    let buf = "";
    const to = setTimeout(() => rej(new Error("fixture 启动超时")), 8000);
    proc.stdout.on("data", (d) => {
      buf += d.toString();
      const i = buf.indexOf("\n");
      if (i >= 0) { clearTimeout(to); res(buf.slice(0, i).trim()); }
    });
    proc.stderr.on("data", (d) => process.stderr.write(`[fixture] ${d}`));
    proc.on("error", (e) => { clearTimeout(to); rej(e); });
    proc.on("exit", (code, signal) => { clearTimeout(to); rej(new Error(`fixture 提前退出: code=${code} signal=${signal}`)); });
  });
  return { proc, port: Number(port) };
}

function stopFixture(proc) {
  try { proc.stdin.write("x"); } catch (_) {}
  try { proc.stdin.end(); } catch (_) {}
  try { proc.kill(); } catch (_) {}
}

function freshDir(tag) {
  const root = jj(REPO, "dualtest");
  mkdirSync(root, { recursive: true });
  return { dir: mkdtempSync(jj(root, `${tag}-`)), settings: mkdtempSync(jj(root, `${tag}-cfg-`)) };
}

// 全新的设置目录是这套用例的前提：注册表与单路模型设置都必须为空，
// 环境变量兜底才真的被走到，否则开发者机器上已配的提供商会让断言各跑各的。
function hostEnv(paths, extra) {
  return {
    SACODE_USER_SETTINGS_DIR: paths.settings,
    DSH_PROVIDER_BASE_URL: "",
    DSH_PROVIDER_MODEL: "",
    DSH_PROVIDER_KEY: "",
    STEPFUN_API_KEY: "",
    ...extra,
  };
}

async function drainPoll(b, method = "prompt/poll", limit = 200) {
  for (let i = 0; i < limit; i++) {
    const p = await b.request(method, {});
    if (p.settled) return p;
    await nap(10);
  }
  throw new Error(`${method} 未在期限内结算`);
}

test("增强请求只带当前草稿与当前模型，结果不写进会话消息", async () => {
  const fixture = await startFixture();
  const paths = freshDir("enh");
  const b = new HostBridge(HOST, hostEnv(paths, {
    DSH_PROVIDER_BASE_URL: `http://127.0.0.1:${fixture.port}/enhance`,
    DSH_PROVIDER_MODEL: "fixture-model",
    DSH_PROVIDER_KEY: "fixture-secret",
  }));
  await b.start(paths.dir);
  try {
    const init = await b.request("initialize");
    const caps = init.capabilities || [];
    // 协议面必须先认账：能力清单里没有的方法，桌面就没有通路。
    for (const m of ["prompt/enhance", "prompt/poll", "prompt/cancel"]) {
      assert.ok(caps.includes(m), `capabilities 须含 ${m}，实得: ${JSON.stringify(caps)}`);
    }

    const draft = '想要"更顺"的队列，能中途插话\\就好';
    const st = await b.request("prompt/enhance", { draft });
    assert.equal(st.started, true, `enhance 须启动，实得: ${JSON.stringify(st)}`);
    // 点击时就定下了本次用的模型，之后换模型只影响下一次请求。
    assert.equal(st.model, "fixture-model", `启动帧须回显本次模型，实得: ${JSON.stringify(st)}`);

    const settled = await drainPoll(b);
    assert.equal(settled.running, false, "已结算");
    assert.equal(settled.ok, true, `增强须成功，实得: ${JSON.stringify(settled)}`);
    assert.equal(settled.error, "");
    assert.equal(settled.cancelled, false);
    // 回声里带的是 provider 真实收到的请求形状：两条消息、零个工具、草稿无损、模型就是那颗。
    assert.ok(
      settled.text.includes("model=fixture-model messages=2 tools=0 draft=" + draft),
      `请求形状须为「一条指令 + 这一条草稿」，实得: ${settled.text}`,
    );
    assert.equal(settled.usage, "22", `用量须回传，实得: ${JSON.stringify(settled)}`);
    // 凭据不得穿过响应面
    assert.ok(!JSON.stringify(settled).includes("fixture-secret"), "响应帧里不得出现凭据明文");

    // 增强不是消息：它不进会话日志，UI 投影里因此不该多出一条 assistant
    const proj = await b.request("session/projection", {});
    const msgs = proj.messages || [];
    assert.ok(
      !msgs.some((m) => m.startsWith("assistant/message:")),
      `增强结果不得落成会话消息，实得: ${JSON.stringify(msgs)}`,
    );
    assert.ok(
      !msgs.some((m) => m.includes(draft)),
      `草稿本身也不得被写进会话，实得: ${JSON.stringify(msgs)}`,
    );
  } finally {
    await b.stop();
    stopFixture(fixture.proc);
  }
});

test("增强用量进同一份 token 账", async () => {
  const fixture = await startFixture();
  const paths = freshDir("enhbill");
  const b = new HostBridge(HOST, hostEnv(paths, {
    DSH_PROVIDER_BASE_URL: `http://127.0.0.1:${fixture.port}/enhance`,
    DSH_PROVIDER_MODEL: "fixture-model",
    DSH_PROVIDER_KEY: "fixture-secret",
  }));
  await b.start(paths.dir);
  try {
    const before = await b.request("usage/status", {});
    assert.equal(before.used, 0, `增强前账上须为零，实得: ${JSON.stringify(before)}`);

    await b.request("prompt/enhance", { draft: "把这条说清楚" });
    const settled = await drainPoll(b);
    assert.equal(settled.ok, true, `增强须成功，实得: ${JSON.stringify(settled)}`);
    // 结算那一笔必须真进了账，并且只进一次：重复轮询不能把同一笔用量数两遍。
    assert.equal(settled.usageVerdict, "recorded", `用量须落账，实得: ${JSON.stringify(settled)}`);
    assert.equal(settled.used, 22, `累计须为 22，实得: ${JSON.stringify(settled)}`);

    const again = await b.request("prompt/poll", {});
    assert.equal(again.used, 22, `重复轮询不得二次计量，实得: ${JSON.stringify(again)}`);
    const after = await b.request("usage/status", {});
    assert.equal(after.used, 22, `usage/status 须读到同一笔账，实得: ${JSON.stringify(after)}`);
  } finally {
    await b.stop();
    stopFixture(fixture.proc);
  }
});

test("不轮询也结算增强，换会话不串账，重新启动仍保留用量", async () => {
  const fixture = await startFixture();
  const paths = freshDir("enh-no-poll");
  const env = hostEnv(paths, { DSH_PROVIDER_BASE_URL: `http://127.0.0.1:${fixture.port}/enhance`, DSH_PROVIDER_MODEL: "fixture-model" });
  let b = new HostBridge(HOST, env);
  await b.start(paths.dir);
  try {
    await b.request("prompt/enhance", { draft: "第一笔" });
    await nap(300);
    const other = await b.request("session/create", { title: "另一会话" });
    await b.request("session/select", { sessionId: other.id });
    assert.equal((await b.request("usage/status")).used, 0, "原会话费用不能进入新会话");
    await b.request("session/select", { sessionId: "current" });
    assert.equal((await b.request("usage/status")).used, 22, "没有 prompt/poll 也不能丢账");
    await b.request("prompt/enhance", { draft: "关闭前第二笔" });
    await nap(300);
    await b.stop();
    b = new HostBridge(HOST, env); await b.start(paths.dir);
    assert.equal((await b.request("usage/status")).used, 44, "关闭窗口也要结算增强");
  } finally { await b.stop(); stopFixture(fixture.proc); }
});

test("空白草稿被拒，不发出任何模型请求", async () => {
  const paths = freshDir("enhblank");
  const b = new HostBridge(HOST, hostEnv(paths, {
    DSH_PROVIDER_BASE_URL: "http://127.0.0.1:1/enhance",
    DSH_PROVIDER_MODEL: "fixture-model",
    DSH_PROVIDER_KEY: "fixture-secret",
  }));
  await b.start(paths.dir);
  try {
    for (const draft of ["", "   ", "\n\t"]) {
      await assert.rejects(
        () => b.request("prompt/enhance", { draft }),
        /-32602 enhance-empty-draft/,
        `空白草稿须被拒，实得输入: ${JSON.stringify(draft)}`,
      );
    }
    // 被拒的那一次不得留下在途车道，否则后面每一条都只会读到 -32001
    const p = await b.request("prompt/poll", {});
    assert.equal(p.active, false, `被拒后不得留有增强槽，实得: ${JSON.stringify(p)}`);
  } finally {
    await b.stop();
  }
});

test("模型未配置时明确失败，不静默换模型", async () => {
  const paths = freshDir("enhnocfg");
  const b = new HostBridge(HOST, hostEnv(paths, {}));
  await b.start(paths.dir);
  try {
    await assert.rejects(
      () => b.request("prompt/enhance", { draft: "随便写点什么" }),
      /-32016 model-not-configured/,
      "缺配置必须报出来，不能拿兜底模型凑一次",
    );
  } finally {
    await b.stop();
  }
});

test("重复请求被挡、取消只作废增强自己", async () => {
  // /cancel 这条路先回一帧再拖 1.5 秒，给「在途」留出可观察的窗口
  const fixture = await startFixture();
  const paths = freshDir("enhcancel");
  const b = new HostBridge(HOST, hostEnv(paths, {
    DSH_PROVIDER_BASE_URL: `http://127.0.0.1:${fixture.port}/cancel`,
    DSH_PROVIDER_MODEL: "fixture-model",
    DSH_PROVIDER_KEY: "fixture-secret",
  }));
  await b.start(paths.dir);
  try {
    await b.request("session/submit", { eventType: "user", data: "占一轮" });
    const turn = await b.request("turn/start", { limit: 2 });
    assert.equal(turn.started, true);
    assert.equal(turn.provider, "real");

    const st = await b.request("prompt/enhance", { draft: "这条要被取消" });
    assert.equal(st.started, true);
    await assert.rejects(
      () => b.request("prompt/enhance", { draft: "第二条" }),
      /-32001 enhance-in-flight/,
      "同一条车道上不得有两笔在途",
    );

    // turn 还在跑：增强这条车道必须能被取消，且轮询与取消都得答得上来
    const cancel = await b.request("prompt/cancel", {});
    assert.equal(cancel.wasRunning, true, `取消须落在在途增强上，实得: ${JSON.stringify(cancel)}`);
    assert.equal(cancel.cancelRequested, true);

    const settled = await drainPoll(b);
    assert.equal(settled.cancelled, true, `取消须如实报 cancelled，实得: ${JSON.stringify(settled)}`);
    assert.equal(settled.ok, false);
    assert.equal(settled.text, "", "半截增强不得交回文本，否则界面会拿它覆盖用户草稿");

    // 取消增强不得连带停掉那一轮 turn；反过来 turn 在途也不得让增强无处可取消
    const turnState = await b.request("turn/poll", {});
    assert.equal(turnState.turn, true, `turn 须仍归属于它自己那一轮，实得: ${JSON.stringify(turnState)}`);

    const re = await b.request("prompt/enhance", { draft: "取消后可以再来一次" });
    assert.equal(re.started, true, "上一次已作废后必须能重新发起");
    await b.request("prompt/cancel", {});
  } finally {
    await b.request("turn/cancel", {});
    await b.stop();
    stopFixture(fixture.proc);
  }
});

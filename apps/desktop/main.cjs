// Electron 主进程：只负责窗口、宿主生命周期与有限的 IPC 面。
// 不做 agent 业务，不承载会话真源，不把任意命令执行暴露给渲染层。
const { app, BrowserWindow, ipcMain } = require("electron");
const { createRequire } = require("node:module");
const { join } = require("node:path");
const { existsSync, writeFileSync, mkdirSync } = require("node:fs");
const { HostBridge } = require("./host-bridge.cjs");
const { hostExePath } = require("./paths.cjs");

// 自包含宿主：exe 与全部依赖 DLL 同目录，因此不需要设置 PATH。
// 打包态下必须从 resourcesPath 取（extraResources 落点），__dirname 那时在 asar 里。
const HOST = hostExePath({
  packaged: app.isPackaged,
  appRoot: __dirname,
  resourcesPath: process.resourcesPath,
});
// 冒烟必须从空会话开始：默认的 sessionData 目录会跨次累积，
// 「这条写入真的落盘了」这类断言就会被上一次运行的旧日志蒙混过去。
// 用 --session-dir=<路径> 指定一次性目录；不传时仍用应用自己的目录（给人工运行用）。
const SESSION_ARG = process.argv.find((a) => a.startsWith("--session-dir="));
const SESSION_DIR = SESSION_ARG ? SESSION_ARG.slice("--session-dir=".length) : app.getPath("sessionData");
const SESSION_LOG = join(SESSION_DIR, "session.log");

const bridge = new HostBridge(HOST, process.env);
let win = null;

function seedIfNeeded() {
  // --session-dir 指到一个还不存在的目录是冒烟测试的正常用法（要的是全新目录），
  // 不能因为目录不存在就把写入炸掉。
  if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });
  if (!existsSync(SESSION_LOG)) {
    writeFileSync(
      SESSION_LOG,
      "0\tturn/start\tt\n1\tsystem/message\tseeded by desktop\n2\tuser/message\thello from desktop\n"
    );
  }
}

async function smoke() {
  if (!existsSync(HOST)) {
    console.log(`SMOKE FAIL 缺少自包含宿主: ${HOST}（先跑 scripts/pack-host.mjs）`);
    app.exit(2);
    return;
  }
  seedIfNeeded();
  await bridge.start(SESSION_DIR);
  const out = [];
  let bad = 0;
  for (const m of ["initialize", "session/projection", "session/subscribe"]) {
    try {
      out.push(`${m}=${JSON.stringify(await bridge.request(m))}`);
    } catch (e) {
      bad += 1;
      out.push(`${m} 失败: ${e.message}`);
    }
  }
  try {
    await bridge.request("no/such");
    bad += 1;
    out.push("未知方法竟然成功了（应当报错）");
  } catch (e) {
    out.push(`未知方法按预期报错: ${e.message}`);
  }
  // 未 flush 的写入不得被当作已提交：submit 后订阅读不到，flush 后才读到
  try {
    const s = await bridge.request("session/submit", { eventType: "assistant/message", data: "smoke pending" });
    const before = await bridge.request("session/subscribe", { cursor: s.durable });
    const f = await bridge.request("session/flush");
    const after = await bridge.request("session/subscribe", { cursor: s.durable });
    if (before.events.length !== 0 || after.events.length !== 1 || f.durable !== s.events) {
      bad += 1;
      out.push(`durability 屏障不符预期: before=${before.events.length} after=${after.events.length} durable=${f.durable}/${s.events}`);
    } else {
      out.push(`durability 屏障: submit(durable=${s.durable}) → flush(durable=${f.durable})`);
    }
  } catch (e) {
    bad += 1;
    out.push(`durability 屏障失败: ${e.message}`);
  }
  const st = await bridge.stop();
  if (st.forced) {
    bad += 1;
    out.push("宿主被强杀，没有走 EOF 结算路径");
  }
  out.push(`stop forced=${st.forced} code=${st.code} signal=${st.signal}`);
  out.forEach((l) => console.log("SMOKE", l));
  console.log(bad === 0 ? "SMOKE PASS" : "SMOKE FAIL");
  app.exit(bad === 0 ? 0 : 1);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(join(__dirname, "renderer", "index.html"));
  // UI 冒烟不需要把窗口摆到用户桌面上
  win.once("ready-to-show", () => {
    if (!UI_SMOKE) win.show();
  });
  win.on("closed", () => (win = null));
}

const nap = (ms) => new Promise((r) => setTimeout(r, ms));

// 桌面黄金路径的运行时验收：真窗口里的 Vue 渲染层 → preload → IPC → 仓颉宿主 → 会话日志 → 再投影。
// 只看 DOM 里有 JSON 不算数——必须证明点击真的被核心落盘，且投影、流式、审批、取消各自有终态。
async function uiSmoke() {
  let bad = 0;
  // 逐行标明成败：措辞固定打印会让人把通过读成失败（本文件第一版就这么错过一次）
  const note = (ok, line) => {
    if (!ok) bad += 1;
    console.log(`UI ${ok ? "OK  " : "FAIL"} ${line}`);
  };
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const text = async (sel) => (await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent : ""; })()`)) || "";
  const count = async (sel) => Number(await js(`document.querySelectorAll(${JSON.stringify(sel)}).length`));
  const click = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
  const waitFor = async (probe, tries = 120) => {
    for (let i = 0; i < tries; i++) {
      if (await probe()) return true;
      await nap(50);
    }
    return false;
  };

  if (!existsSync(HOST)) {
    console.log(`UI_SMOKE FAIL 缺少自包含宿主: ${HOST}`);
    app.exit(2);
    return;
  }
  seedIfNeeded();
  createWindow();

  // 1) 渲染层必须由 Vue 挂出来，且消息只来自核心投影
  const mounted = await waitFor(() => count("#messages .msg").then((n) => n >= 2));
  note(mounted, `Vue 挂载后消息条数=${await count("#messages .msg")}（核心投影给出）`);
  const domMsgs = await count("#messages .msg");
  const projText = await text("#count-events");
  note(/^\d+$/.test(projText.split(" ")[1] || ""), `计数条 events=${projText}`);

  // 2) 沙箱与隔离必须真生效
  const leaked = await js("typeof window.require");
  note(leaked === "undefined", `渲染层 require 类型=${leaked}（应为 undefined）`);
  const apiShape = await js(
    "['projection','userSend','toolsList','toolCall','approvalAsk','approvalAnswer','turnStart','turnPoll','turnCancel'].map(k => typeof (window.dsh||{})[k]).join(',')"
  );
  note(apiShape === "function,function,function,function,function,function,function,function,function", `preload 暴露面=${apiShape}`);

  // 3) 多行输入经 IPC 落到核心，且只算一条事件
  const beforeEvents = Number((await text("#count-events")).split(" ")[1]);
  const typed = "第一行\n第二行 带\"引号\"";
  await js(`(() => { const t = document.getElementById('composer'); t.value = ${JSON.stringify(typed)}; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  note(await click("#send"), "点击发送已派发");
  const sent = await waitFor(async () => {
    const n = Number((await text("#count-events")).split(" ")[1]);
    return n === beforeEvents + 1;
  });
  note(sent, `多行消息后 events=${beforeEvents} → ${await text("#count-events")}`);
  const lastMsg = await js(`(() => { const m = document.querySelectorAll('#messages .msg'); return m[m.length-1] ? m[m.length-1].textContent : ''; })()`);
  note(lastMsg.includes("第一行") && lastMsg.includes("第二行") && lastMsg.includes('"引号"'), `末条消息回显=${JSON.stringify(lastMsg.slice(0, 40))}`);
  const durable = await text("#count-durable");
  const pending = await text("#count-pending");
  note(durable.split(" ")[1] === String(beforeEvents + 1) && pending.endsWith("0"), `落盘即 durable=${durable} pending=${pending}`);
  const logRaw = require("node:fs").readFileSync(SESSION_LOG, "utf8");
  note(/user\/message\t第一行\\n第二行/.test(logRaw), "多行正文按转义写成一行事件（裸换行没把日志劈开）");

  // 4) 流式：完整一轮必须把核心产出的帧渲回界面并落到终态
  note(await click("#run-turn"), "已发起完整一轮");
  const settledTurn = await waitFor(async () => (await text("#turn-state")).startsWith("turn settled"));
  note(settledTurn, `turn 终态=${await text("#turn-state")}`);
  const streamed = await text("#stream");
  note(streamed.includes("你好，world"), `流式文本回显=${JSON.stringify(streamed.slice(0, 40))}`);

  // 5) 取消：可取消那一轮停在帧间，点停止要改终态，不能只把按钮禁用
  note(await click("#run-turn-2"), "已发起可取消一轮");
  await waitFor(async () => (await text("#turn-state")) === "turn running");
  note(await click("#stop-turn"), "已派发停止");
  const cancelled = await waitFor(async () => (await text("#turn-state")).startsWith("turn cancelled"));
  note(cancelled, `取消终态=${await text("#turn-state")}`);

  // 6) 审批：拒绝与允许一次都必须由核心裁决，且界面如实显示两种结果
  note(await click("#tool-write"), "已点开需审批工具");
  note(await waitFor(() => text("#approval").then((t) => t.includes("工单 #"))), "审批浮层出现且带工单号（一次性放行，无永久授权按钮）");
  note(await click("#deny"), "已点拒绝");
  const denied = await waitFor(async () => (await text("#outcome")).includes("被拒"));
  note(denied, `拒绝结果=${await text("#outcome")}`);
  // 放行这条腿同样要等：askTool 现在要跑一次 approval/ask 的协议往返才拿到工单，
  // 框不是同步出现的（点完就抢点 #allow-once 会在干净会话目录下偶发抢空）。
  note(await click("#tool-write"), "已再次点开需审批工具");
  note(await waitFor(async () => (await count("#allow-once")) > 0), "第二张工单的审批卡已出现");
  const apText = await text("#approval");
  note(apText.includes("工单 #"), `审批卡带工单号=${apText.slice(0, 48)}`);
  note(await click("#allow-once"), "已允许一次");
  const allowed = await waitFor(async () => (await text("#outcome")).includes("结果：ok"));
  note(allowed, `放行结果=${await text("#outcome")}`);
  // 工具事件走的是 append 档位：实例内可见但不等于已提交，界面须把 pending 显出来
  const pendingNow = Number((await text("#count-pending")).split(" ")[1] || "0");
  note(pendingNow > 0, `工具事件先只在实例内可见（pending=${pendingNow}），未 flush 不算已提交`);
  note((await text("#tool-counters")).includes("未登记 0"), `注册表计数=${await text("#tool-counters")}`);

  await bridge.stop();
  // 退出结算后才落盘：这两条同时证明 durability 屏障与「拒绝也被记账」
  const log2 = require("node:fs").readFileSync(SESSION_LOG, "utf8");
  note(/tool\/call\twrite /.test(log2) && /tool\/result\tok:/.test(log2), "放行的工具调用与结果已由核心写进会话日志");
  note(/tool\/result\tdenied:write:approval-denied/.test(log2), "被拒的调用也按拒绝记账，不是静默成功");
  // 审批留下的可追问痕迹：谁批的、批成什么，只能从日志里的 asked/decided 回答
  note(/approval\/asked\t\d+:write/.test(log2) && /approval\/decided\t\d+:denied/.test(log2), "审批的 asked/decided 已进同一份会话日志");
  console.log(bad === 0 ? "UI_SMOKE PASS" : `UI_SMOKE FAIL（${bad} 项不符）`);
  app.exit(bad === 0 ? 0 : 1);
}

// IPC 面：每个通道只做一件事、参数逐字段校验类型与范围，方法名由主进程写死。
// 渲染层拿不到「发任意方法」的能力，也伪造不了 system/message 这类事件类型。
async function withHost(fn) {
  seedIfNeeded();
  if (!bridge.proc) await bridge.start(SESSION_DIR);
  return fn();
}

const isStr = (v) => typeof v === "string";

ipcMain.handle("dsh:projection", async () => withHost(() => bridge.request("session/projection")));

ipcMain.handle("dsh:userSend", async (_e, args) => {
  if (!args || !isStr(args.text) || args.text.length === 0 || args.text.length > 8000) {
    throw new Error("bad arguments");
  }
  return withHost(() => bridge.request("session/append", { eventType: "user/message", data: args.text }));
});

ipcMain.handle("dsh:toolsList", async () => withHost(() => bridge.request("extension/list")));

ipcMain.handle("dsh:toolCall", async (_e, args) => {
  // 审批凭据只能是工单号：渲染层传不动「我已经批过了」这句话——它得先去 ask/answer。
  if (!args || !isStr(args.name) || !isStr(args.args)) {
    throw new Error("bad arguments");
  }
  const approvalId = args.approvalId === undefined ? 0 : args.approvalId;
  if (!Number.isInteger(approvalId) || approvalId < 0) {
    throw new Error("bad arguments");
  }
  const params = approvalId > 0
    ? { name: args.name, args: args.args, approvalId }
    : { name: args.name, args: args.args };
  return withHost(() => bridge.request("extension/call", params));
});

ipcMain.handle("dsh:approvalAsk", async (_e, args) => {
  if (!args || !isStr(args.name) || args.name.length === 0 || args.name.length > 200) {
    throw new Error("bad arguments");
  }
  return withHost(() => bridge.request("approval/ask", { name: args.name }));
});

ipcMain.handle("dsh:approvalAnswer", async (_e, args) => {
  if (!args || !Number.isInteger(args.approvalId) || args.approvalId < 1 || !isStr(args.decision)) {
    throw new Error("bad arguments");
  }
  return withHost(() => bridge.request("approval/answer", { approvalId: args.approvalId, decision: args.decision }));
});

ipcMain.handle("dsh:turnStart", async (_e, args) => {
  const limit = args ? args.limit : 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 8) {
    throw new Error("bad arguments");
  }
  return withHost(() => bridge.request("turn/start", { limit }));
});

ipcMain.handle("dsh:turnPoll", async () => withHost(() => bridge.request("turn/poll")));

ipcMain.handle("dsh:turnCancel", async () => withHost(() => bridge.request("turn/cancel")));

const UI_SMOKE = process.argv.includes("--ui-smoke");

app.whenReady().then(() => {
  if (process.argv.includes("--smoke")) return smoke();
  if (UI_SMOKE) return uiSmoke();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((e) => {
  // 冒烟路径里任何未捕获的拒绝都必须当场退出非零：只留一个 UnhandledPromiseRejection
  // 警告的话进程会挂在窗口上，看上去像「跑得很慢」而不是「失败了」。
  console.log(`SMOKE FAIL ${e && e.message ? e.message : e}`);
  app.exit(1);
});

app.on("window-all-closed", async () => {
  // 先让宿主走完 EOF 结算（落盘未 flush 的写入并归还写租约），再退出
  await bridge.stop();
  app.quit();
});

// 兜底：无论以何种方式退出，都不要把宿主留成孤儿进程
app.on("before-quit", () => bridge.killNow());
process.on("exit", () => bridge.killNow());

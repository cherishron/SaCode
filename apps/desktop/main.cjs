// Electron 主进程：只负责窗口、宿主生命周期与有限的 IPC 面。
// 不做 agent 业务，不承载会话真源，不把任意命令执行暴露给渲染层。
const { app, BrowserWindow, ipcMain } = require("electron");
const { createRequire } = require("node:module");
const { join } = require("node:path");
const { existsSync, writeFileSync } = require("node:fs");
const { HostBridge } = require("./host-bridge.cjs");
const { hostExePath } = require("./paths.cjs");

// 自包含宿主：exe 与全部依赖 DLL 同目录，因此不需要设置 PATH。
// 打包态下必须从 resourcesPath 取（extraResources 落点），__dirname 那时在 asar 里。
const HOST = hostExePath({
  packaged: app.isPackaged,
  appRoot: __dirname,
  resourcesPath: process.resourcesPath,
});
const SESSION_DIR = app.getPath("sessionData");
const SESSION_LOG = join(SESSION_DIR, "session.log");

const bridge = new HostBridge(HOST, process.env);
let win = null;

function seedIfNeeded() {
  if (!existsSync(SESSION_LOG)) {
    require("node:fs").writeFileSync(
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

// 桌面黄金路径的运行时验收：渲染层 → preload → IPC → 仓颉宿主 → 会话日志 → 再投影。
// 只看 DOM 里有 JSON 不算数——必须证明那次点击真的被核心落盘，且投影计数随之增长。
async function uiSmoke() {
  let bad = 0;
  // 逐行标明成败：措辞固定打印会让人把通过读成失败（本文件第一版就这么错过一次）
  const note = (ok, line) => {
    if (!ok) bad += 1;
    console.log(`UI ${ok ? "OK  " : "FAIL"} ${line}`);
  };
  if (!existsSync(HOST)) {
    console.log(`UI_SMOKE FAIL 缺少自包含宿主: ${HOST}`);
    app.exit(2);
    return;
  }
  seedIfNeeded();
  createWindow();
  let before = null;
  for (let i = 0; i < 60 && !before; i++) {
    const text = await win.webContents.executeJavaScript("document.getElementById('out').textContent", true);
    if (text && text.includes("projection")) {
      try {
        before = JSON.parse(text);
      } catch (e) {
        note(false, `初始投影不是 JSON: ${text.slice(0, 60)}`);
        break;
      }
    } else if (text && text.startsWith("失败")) {
      note(false, `渲染层报错: ${text}`);
      break;
    } else {
      await nap(200);
    }
  }
  note(!!before && before.events >= 3 && before.projection >= 2, `初始投影=${JSON.stringify(before)}`);
  // 沙箱与隔离必须是真生效的，不是配置里写着好看
  const leaked = await win.webContents.executeJavaScript("typeof window.require", true);
  note(leaked === "undefined", `渲染层 require 类型=${leaked}（应为 undefined）`);
  const hasBridge = await win.webContents.executeJavaScript("typeof window.dsh && typeof window.dsh.projection", true);
  note(hasBridge === "function", `preload 暴露的 dsh.projection 类型=${hasBridge}`);

  await win.webContents.executeJavaScript("document.getElementById('go').click()", true);
  let after = null;
  for (let i = 0; i < 60 && !after; i++) {
    await nap(200);
    const text = await win.webContents.executeJavaScript("document.getElementById('out').textContent", true);
    if (text && text.includes("projection")) {
      const p = JSON.parse(text);
      if (before && p.events > before.events) after = p;
    }
  }
  note(!!after, `点击后投影=${JSON.stringify(after)}`);
  if (after) {
    note(after.events === before.events + 1, `事件增量=${after.events - before.events}（应为 1）`);
    note(after.durable === after.events, `durable=${after.durable}/${after.events}（append 即落盘）`);
    const log = require("node:fs").readFileSync(SESSION_LOG, "utf8");
    note(/user\/message\tclicked at /.test(log), "点击那条 user/message 已由核心写进会话日志");
    note(after.projection === before.projection + 1, `模型可见投影增量=${after.projection - before.projection}`);
  }
  await bridge.stop();
  console.log(bad === 0 ? "UI_SMOKE PASS" : `UI_SMOKE FAIL（${bad} 项不符）`);
  app.exit(bad === 0 ? 0 : 1);
}

ipcMain.handle("dsh:projection", async () => {
  seedIfNeeded();
  if (!bridge.proc) await bridge.start(SESSION_DIR);
  return bridge.request("session/projection");
});

ipcMain.handle("dsh:append", async (_e, args) => {
  // 只接受两个字符串字段，避免渲染层拼出任意方法名或参数结构
  if (!args || typeof args.eventType !== "string" || typeof args.data !== "string") {
    throw new Error("bad arguments");
  }
  if (!bridge.proc) await bridge.start(SESSION_DIR);
  return bridge.request("session/append", { eventType: args.eventType, data: args.data });
});

const UI_SMOKE = process.argv.includes("--ui-smoke");

app.whenReady().then(() => {
  if (process.argv.includes("--smoke")) return smoke();
  if (UI_SMOKE) return uiSmoke();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", async () => {
  // 先让宿主走完 EOF 结算（落盘未 flush 的写入并归还写租约），再退出
  await bridge.stop();
  app.quit();
});

// 兜底：无论以何种方式退出，都不要把宿主留成孤儿进程
app.on("before-quit", () => bridge.killNow());
process.on("exit", () => bridge.killNow());

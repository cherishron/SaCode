// Electron 主进程：只负责窗口、宿主生命周期与有限的 IPC 面。
// 不做 agent 业务，不承载会话真源，不把任意命令执行暴露给渲染层。
const { app, BrowserWindow, ipcMain, nativeTheme } = require("electron");
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
const WILL_SMOKE = process.argv.includes("--smoke") || process.argv.includes("--ui-smoke") || process.argv.includes("--layout-smoke");
// 冒烟态没传 --session-dir 时也必须落到一次性目录：默认的 sessionData 跨次累积，
// 「全新会话」类断言会被上一次运行的旧日志蒙混过去（实测用量从 12 一路涨到 48）。
// 只带 pid 还不够：Windows 会回收 pid，同 pid 的旧目录会被下一次运行接着写，
// 于是上一轮的 usage/budget 与 tool 事件就污染了这一轮（实测「用量 12/5」+ 多出 tool 组）。
// 所以目录名带 pid+时间戳，且冒烟态自己建自己清；传了 --session-dir 的（打包态手工复验、
// CI 要留日志）仍以传入者为准，我们绝不删别人指定的目录。
const FRESH_SMOKE_DIR = WILL_SMOKE && !SESSION_ARG;
const SESSION_DIR = SESSION_ARG
  ? SESSION_ARG.slice("--session-dir=".length)
  : (FRESH_SMOKE_DIR ? join(app.getPath("temp"), `dsh-smoke-${process.pid}-${Date.now()}`) : app.getPath("sessionData"));
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
      "0\tturn/start\tt\n1\tsystem/message\t由 SaCode 初始化本地会话\n2\tdeveloper/message\t请用中文协助完成项目任务。\n3\tassistant/message\t欢迎使用 SaCode。\n4\tuser/message\t你好，SaCode。\n"
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
    minWidth: 860,
    minHeight: 600,
    title: "SaCode · 编程工作台",
    icon: join(__dirname, "renderer", "assets", "sacode-icon.png"),
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

  // 0) 组件库必须真的被折叠进来：光在 package.json 里写着不算接了组件库。
  //    这条只验「产物加载到了且是可用的组件定义」，渲染语义由后面的气泡断言各自负责。
  //    判 setup 是函数而不是 typeof === "function"：库用 defineComponent + withScopeId 包装，
  //    导出的是带 setup 的选项对象（实测 typeof 为 object），按构造函数判会假红。
  //    必须轮询：窗口刚 createWindow 时文档还没装载，即时读会在旧上下文里取到 undefined。
  const trShape = () => js(
    "(() => { const T = window.TinyRobot || {};" +
    " return ['Bubble', 'BubbleList', 'BubbleProvider']" +
    " .map((k) => (T[k] && typeof T[k].setup === 'function' ? k : '缺' + k)).join(','); })()"
  );
  const trReady = await waitFor(async () => (await trShape()) === "Bubble,BubbleList,BubbleProvider");
  note(trReady, `TinyRobot 折叠产物已加载=${await trShape()}`);

  // 1) 渲染层必须由 Vue 挂出来，且消息只来自核心投影。
  //    消息面换成 BubbleList 后按「组」计：种子是 system/developer/assistant/user 四个角色，各成一组。
  const mounted = await waitFor(() => count("#messages .tr-bubble").then((n) => n >= 4));
  note(mounted, `Vue 挂载后气泡组数=${await count("#messages .tr-bubble")}（核心投影给出）`);
  const projText = await text("#count-events");
  note(/^\d+$/.test(projText.split(" ")[1] || ""), `计数条 events=${projText}`);

  // 2) 沙箱与隔离必须真生效
  const leaked = await js("typeof window.require");
  note(leaked === "undefined", `渲染层 require 类型=${leaked}（应为 undefined）`);
  const apiShape = await js(
    "['projection','userSend','toolsList','toolCall','approvalAsk','approvalAnswer','turnStart','turnPoll','turnCancel','usageStatus','usageSetBudget'].map(k => typeof (window.dsh||{})[k]).join(',')"
  );
  note(apiShape === "function,function,function,function,function,function,function,function,function,function,function", `preload 暴露面=${apiShape}`);
  // 暴露面必须是「恰好这些」：多出一个泛化 request 通道就等于把宿主协议面交给网页
  const apiExtra = await js("Object.keys(window.dsh||{}).filter(k => ['projection','userSend','toolsList','toolCall','approvalAsk','approvalAnswer','turnStart','turnPoll','turnCancel','usageStatus','usageSetBudget'].indexOf(k) < 0).join(',')");
  note(apiExtra === "", `preload 未登记的额外键=${apiExtra || "（无）"}`);

  // 工具详情只读取核心清单，模态关闭不执行工具或消费审批。
  await waitFor(() => count('#detail-write').then(n => n === 1));
  const detailEvents = await text('#count-events');
  await js("document.querySelector('#detail-write').focus(); document.querySelector('#detail-write').click()");
  note(await waitFor(() => count('dialog[open]').then(n => n === 1)), "真实工具详情弹窗已打开");
  note((await text('dialog')).includes('write') && (await text('dialog')).includes('每次执行需一次性审批'), "工具详情保留协议标识与核心授权要求");
  note(await js("document.querySelector('dialog').contains(document.activeElement)"), "打开弹窗后焦点位于模态内部");
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
  await nap(50);
  note(await js("document.querySelector('dialog').contains(document.activeElement)"), "Tab 不将焦点移出工具详情弹窗");
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  note(await waitFor(() => count('dialog[open]').then(n => n === 0)), "Escape 关闭工具详情");
  note(await js("document.activeElement.id === 'detail-write'"), "弹窗关闭后焦点归还详情按钮");
  note((await text('#count-events')) === detailEvents, "查看详情未新增会话事件或审批");
  await click('#side-tab-guide');
  note(await js("!document.querySelector('#side-page-guide').hidden && document.querySelector('#side-page-inspect').hidden"), "指南标签切换到独立右侧页面");
  note((await text('#guide-panel')).includes('SaCode 使用指南') && (await text('#guide-panel')).includes('真实模型任务尚未开放'), "中文指南明确当前可用操作与模型限制");
  await js("document.querySelector('#side-tab-guide').focus()");
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Home' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Home' });
  note(await waitFor(() => js("document.activeElement.id === 'side-tab-inspect' && !document.querySelector('#side-page-inspect').hidden")), "Home 切换首个标签并同步焦点");
  await click('#side-tab-preview');
  note((await text('#preview-empty')).includes('暂无读取记录'), "没有读取事实时显示文档预览空状态");
  await click('#side-tab-guide');
  await click('a[href="#budget-panel"]');
  note(await waitFor(() => js("document.activeElement.id === 'budget-panel' && !document.querySelector('#side-page-inspect').hidden")), "预算导航恢复工具页并聚焦目标分区");
  note((await text('#count-events')) === detailEvents, "右侧页面切换未改变会话事实");

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
  const lastMsg = await js(`(() => { const m = document.querySelectorAll('#messages .tr-bubble'); return m[m.length - 1] ? m[m.length - 1].textContent : ''; })()`);
  note(lastMsg.includes("第一行") && lastMsg.includes("第二行") && lastMsg.includes('"引号"'), `末条消息回显=${JSON.stringify(lastMsg.slice(0, 40))}`);
  const durable = await text("#count-durable");
  const pending = await text("#count-pending");
  note(durable.split(" ")[1] === String(beforeEvents + 1) && pending.endsWith("0"), `落盘即 durable=${durable} pending=${pending}`);
  const logRaw = require("node:fs").readFileSync(SESSION_LOG, "utf8");
  note(/user\/message\t第一行\\n第二行/.test(logRaw), "多行正文按转义写成一行事件（裸换行没把日志劈开）");

  // 3a) 对话面的行为钉子：气泡外框真的出自组件库、角色与定位可断言、连续同角色合并。
  //     分组与折叠都只是这份投影之上的视图派生——这里不新增任何真源，断言读到的每个数
  //     都能回到 session.log 的那几条消息行。
  const listNodes = await count("#messages .tr-bubble-list");
  note(listNodes === 1, `BubbleList 容器数=${listNodes}（应为 1）`);
  const roleSpread = await js(
    "(() => { const m = document.querySelectorAll('#messages .tr-bubble'); const r = {};" +
    " m.forEach((e) => { const k = e.getAttribute('data-role') || '?'; r[k] = (r[k] || 0) + 1; });" +
    " return r['system'] + '/' + r['developer'] + '/' + r['assistant'] + '/' + r['user'] + '|组' + m.length; })()"
  );
  note(roleSpread === "1/1/1/1|组4", `种子角色分布=${roleSpread}`);
  // developer/message 是不变量 7 里第五类进模型历史的事件：核心认它之后，界面不许把它
  // 并入 system 显示，正文与原始前缀都要可按条追问。
  const devBubble = await js(
    "(() => { const e = document.querySelector('#messages .tr-bubble[data-role=\"developer\"]');" +
    " if (!e) return 'no-developer-group';" +
    " const t = e.querySelector('.msg-text[data-source-role]');" +
    " return ((t ? (t.textContent || '').trim() : '') === '请用中文协助完成项目任务。' ? 'visible' : 'text:' + (t ? t.textContent : ''))" +
    " + '|' + (t ? t.getAttribute('data-source-role') : 'no-source-role'); })()"
  );
  note(devBubble === "visible|developer/message", `developer 气泡=${devBubble}`);
  const placementPair = await js(
    "(() => { const q = (r) => { const e = document.querySelector('#messages .tr-bubble[data-role=\"' + r + '\"]');" +
    " return e ? e.getAttribute('data-placement') : 'missing'; };" +
    " return q('user') + '|' + q('assistant') + '|' + q('system') + '|' + q('developer'); })()"
  );
  note(placementPair === "end|start|start|start", `角色定位=${placementPair}（user 在右，其余在左）`);
  const labelShown = await text("#messages .msg-role");
  note(/^(系统|用户|助手|工具|开发者) · \d+ 条消息$/.test(labelShown), `组标签=${labelShown}`);
  // 连续同角色必须并成一组：再发一条 user，条数进组但组数不变。
  const groupsBeforeMerge = await count("#messages .tr-bubble");
  await js(`(() => { const t = document.getElementById('composer'); t.value = ${JSON.stringify("第二条 user 消息")}; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  note(await click("#send"), "已再发一条 user 消息");
  // 「组数不变」必须带非零前提，否则 0 === 0 会把「一个组都没渲染」喂成绿。
  const mergedIntoGroup = await waitFor(
    async () => groupsBeforeMerge >= 3 && (await count("#messages .tr-bubble")) === groupsBeforeMerge
  );
  note(mergedIntoGroup, `连续 user 合并：组数 ${groupsBeforeMerge} → ${await count("#messages .tr-bubble")}（应不变且 ≥ 3）`);
  const userGroupNodes = await count('#messages .tr-bubble[data-role="user"] .msg-text');
  note(userGroupNodes >= 2, `user 组内正文条数=${userGroupNodes}（合并后应 ≥ 2）`);

  // 3c) 长消息折叠：超阈值默认折起来，展开与收起都要有真实状态变化。
  //     正文尾部放一个只在原文里出现的哨兵串，判「有没有被截掉」就不用比长度。
  const tailMark = "TAIL-SENTINEL-9F2C";
  const readFold = () => js(
    "(() => { const n = document.querySelectorAll('#messages .msg-text[data-fold-state]');" +
    " const e = n[n.length - 1]; if (!e) return 'missing';" +
    " return e.getAttribute('data-fold-state') + '|' + ((e.textContent || '').includes('" + tailMark + "') ? 'has-tail' : 'no-tail'); })()"
  );
  const clickFold = (wantLabel) => js(
    "(() => { const n = document.querySelectorAll('#messages .msg-text[data-fold-state]');" +
    " const e = n[n.length - 1]; if (!e) return 'missing-node';" +
    " const b = document.querySelector('#messages [data-fold-toggle=\"' + e.getAttribute('data-msg-id') + '\"]');" +
    " if (!b) return 'no-toggle';" +
    " if (" + JSON.stringify(wantLabel) + " && b.textContent !== " + JSON.stringify(wantLabel) + ") return 'wrong-label:' + b.textContent;" +
    " b.click(); return 'ok'; })()"
  );
  await js(`(() => { const t = document.getElementById('composer'); t.value = ${JSON.stringify("长".repeat(260) + tailMark)}; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  note(await click("#send"), "已发一条超阈值的长消息");
  const foldedShown = await waitFor(async () => (await readFold()) === "folded|no-tail");
  note(foldedShown, `长消息折叠态=${await readFold()}（默认折起且尾部不可见）`);
  const plainNodes = await count('#messages .msg-text[data-fold-state="plain"]');
  note(plainNodes >= 3, `短正文保持 plain=${plainNodes}（未超阈值不该出现折叠按钮）`);
  const expandClicked = await clickFold("展开");
  note(expandClicked === "ok", `点展开=${expandClicked}`);
  const expandedShown = await waitFor(async () => (await readFold()) === "expanded|has-tail");
  note(expandedShown, `展开态=${await readFold()}（全文回到 DOM）`);
  const collapseClicked = await clickFold("收起");
  note(collapseClicked === "ok", `点收起=${collapseClicked}`);
  const refolded = await waitFor(async () => (await readFold()) === "folded|no-tail");
  note(refolded, `收起后回到折叠态=${await readFold()}`);

  // 3b) 组件库不是「装了就算」：类名要真的由 TinyVue 出，色值要真的从我们的令牌桥过去。
  //     桥接的反证是删掉 styles.css 末尾那一段 --tv-* 覆写 —— 那时两侧会各自解析成不同颜色。
  const tvCls = await js("(() => { const e = document.querySelector('#run-turn'); return e ? e.className : 'missing'; })()");
  note(/tiny-button/.test(tvCls), `跑一轮按钮由 TinyVue 渲染=${String(tvCls).slice(0, 48)}`);
  const bridgePair = await js(
    "(() => { const mk = (v) => { const d = document.createElement('div'); d.style.color = v; document.body.appendChild(d); const r = getComputedStyle(d).color; d.remove(); return r; }; return mk('var(--accent)') + '|' + mk('var(--tv-color-act-primary-bg)'); })()"
  );
  const [accentTok, tvTok] = String(bridgePair).split("|");
  note(accentTok === tvTok && accentTok.startsWith("rgb"), `TinyVue 主色令牌已接到本仓令牌=${accentTok} vs ${tvTok}`);
  // 判据只打「组件库渲染出来的元素」：它们的色值必须来自本仓令牌层。
  // 不扫全部元素——我们自己的 .msg-user 用的是 color-mix()，Chrome 会序列化成
  // color(srgb …)，跟任何单枚令牌的 rgb() 文本都不相等，那样只会造出假越界。
  const leakProbe = await js(
    `(() => {
      const names = ['--surface','--surface-2','--surface-3','--text','--text-muted','--border','--accent','--accent-text','--ok','--warn','--danger'];
      const mk = (v) => { const d = document.createElement('div'); d.style.color = v; document.body.appendChild(d); const r = getComputedStyle(d).color; d.remove(); return r; };
      const allowed = new Set(names.map((n) => mk('var(' + n + ')')));
      allowed.add('rgba(0, 0, 0, 0)');
      const bad = [];
      const tv = document.querySelectorAll('#app [class*="tiny-"], #app [class*="tr-bubble"]');
      tv.forEach((e) => {
        const cs = getComputedStyle(e);
        ['color','backgroundColor','borderTopColor'].forEach((p) => {
          const v = cs[p];
          if (v && !allowed.has(v)) bad.push(String(e.className).slice(0, 22) + '/' + p + '=' + v);
        });
      });
      return tv.length + '|' + bad.length + '|' + bad.slice(0, 4).join(',') + '|' + mk('var(--accent)');
    })()`
  );
  const [tvCount, leakCount, leakFirst, accentResolved] = String(leakProbe).split("|");
  note(
    Number(tvCount) > 0 && leakCount === "0",
    `组件库元素的色值全部来自本仓令牌（探到 tiny 元素 ${tvCount} 个，越界 ${leakCount} 处，首个=${leakFirst || "无"}，accent=${accentResolved}）`
  );

  // 4) 流式：完整一轮必须把核心产出的帧渲回界面并落到终态
  note(await click("#run-turn"), "已发起完整一轮");
  const settledTurn = await waitFor(async () => (await text("#turn-state")) === "状态 已完成");
  note(settledTurn, `turn 终态=${await text("#turn-state")}`);
  // 用量读数必须由核心结算帧驱动。冒烟态现在总是从一次性目录起（见 SESSION_DIR），
  // 所以这里可以钉死绝对值：全新会话的第一笔就是 12，档位停在默认 200。
  // 之前写成「12 的倍数」是被跨次累积的真实 sessionData 逼的妥协，不再需要。
  const usageShown = await waitFor(async () => (await text("#turn-usage")).includes("用量 12/200 · 已计量"));
  const usageAfterFull = await text("#turn-usage");
  note(usageShown, `用量读数=${usageAfterFull}`);
  // 干净收束后正文必须回到日志这份真源：界面上那句助手话要出自核心投影，
  // 而不是出自 turn/poll 的瞬时帧——后者重启就没有了。
  const assistantTail = await js(
    "(() => { const m = document.querySelectorAll('#messages .tr-bubble[data-role=\"assistant\"]');" +
    " if (!m.length) return 'none';" +
    " const t = (m[m.length - 1].textContent || '').trim(); return t.slice(0, 40); })()"
  );
  note(String(assistantTail).includes("你好，world"), `助手正文由投影给出=${JSON.stringify(String(assistantTail))}`);
  // 同一句话不许有两份真源：投影已给出，流式回显框必须撤掉，否则界面上出现两次
  const streamLeft = await count("#stream");
  note(streamLeft === 0, `干净收束后流式回显框数=${streamLeft}（应为 0，正文只剩投影那一份）`);
  const assistantGroupsAfterFull = await count('#messages .tr-bubble[data-role="assistant"]');
  note(assistantGroupsAfterFull === 2, `助手气泡组数=${assistantGroupsAfterFull}（种子那组 + 本轮投影新落的那组）`);

  // 5) 取消：可取消那一轮停在帧间，点停止要改终态，不能只把按钮禁用
  note(await click("#run-turn-2"), "已发起可取消一轮");
  await waitFor(async () => (await text("#turn-state")) === "状态 执行中");
  note(await click("#stop-turn"), "已派发停止");
  const cancelled = await waitFor(async () => (await text("#turn-state")) === "状态 已取消");
  note(cancelled, `取消终态=${await text("#turn-state")}`);
  // 取消的一轮不落 assistant/message：半截正文只能继续由流式回显框呈现，
  // 且不许多出一个助手气泡冒充「助手说过完整的话」。
  const partialEcho = await text("#stream");
  note(partialEcho.includes("你好，world"), `取消轮回显保留半截正文=${JSON.stringify(partialEcho.slice(0, 40))}`);
  const assistantGroupsAfterCancel = await count('#messages .tr-bubble[data-role="assistant"]');
  note(
    assistantGroupsAfterCancel === assistantGroupsAfterFull,
    `取消轮后助手气泡组数=${assistantGroupsAfterCancel}（应与 ${assistantGroupsAfterFull} 一致，未新增）`
  );
  // 被取消的一轮不进计量：数值必须与上一轮结算时逐字一致，只允许判决词变成 absent
  const usageAfterCancel = await text("#turn-usage");
  const cancelUnchanged = usageAfterCancel.includes(" · 未收到用量") &&
    usageAfterCancel.split(" · ")[0] === usageAfterFull.split(" · ")[0];
  note(cancelUnchanged, `取消轮不计量=${usageAfterFull} -> ${usageAfterCancel}`);
  // 预算控制面：调大必须由核心拒且停在原档；收紧后徽章档位跟着核心回的数字走。
  const setBudgetField = (v) => js(
    `(() => { const i = document.getElementById('budget-input'); i.value = ${JSON.stringify(v)};` +
    " i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()"
  );
  await setBudgetField("500");
  note(await click("#apply-budget"), "已派发调大预算");
  const widened = await waitFor(async () => (await text("#budget-note")).includes("仍停在 200"));
  note(widened, `调大预算=${await text("#budget-note")}`);
  await setBudgetField("100");
  note(await click("#apply-budget"), "已派发收紧预算");
  const tightened = await waitFor(async () => (await text("#turn-usage")).includes("/100"));
  note(tightened, `收紧后读数=${await text("#turn-usage")}`);
  // 负数在渲染层就被挡（不给「把档位改成 NaN 从而谁都拦不住」留通路）
  await setBudgetField("-1");
  note(await click("#apply-budget"), "已派发负数预算");
  const negBlocked = await waitFor(async () => (await text("#budget-note")).includes("非负整数"));
  note(negBlocked, `负数预算=${await text("#budget-note")}`);

  // 6) 审批：拒绝与允许一次都必须由核心裁决，且界面如实显示两种结果
  note(await click("#tool-write"), "已点开需审批工具");
  note(await waitFor(() => text("#approval").then((t) => t.includes("工单 #"))), "审批浮层出现且带工单号（一次性放行，无永久授权按钮）");
  const pendingApproval = await text('#approval');
  await click('#side-tab-guide');
  note(await js("!!document.querySelector('#guide-approval') && document.querySelector('#side-tab-inspect').getAttribute('aria-label').includes('待审批')"), "指南页保留待审批提示与返回入口");
  await click('#guide-approval');
  note(await waitFor(() => js("document.activeElement.id === 'tools-panel' && !document.querySelector('#side-page-inspect').hidden")) && (await text('#approval')) === pendingApproval, "指南往返保留原审批工单并聚焦工具分区");
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

  // 只读工具与写侧共用同一张注册表和同一条管线，但不需要工单：点了就直接执行，
  // 且不得顺手弹出审批卡（审批面只属于真的会改盘的动作）
  note((await text("#tool-read")).includes("免审批"), `只读工具卡片标出免审批=${(await text("#tool-read")).slice(0, 40)}`);
  note(await click("#tool-read"), "已点开只读工具");
  // 断言必须分得清「成功」与「被拒」：not-found 的报错里会带上参数串，
  // 只 include 正文的话，一条失败的消息也能把这条断言喂绿。
  const readBack = await waitFor(async () => {
    const t = await text("#outcome");
    return t.startsWith("结果：") && t.includes("hello-from-renderer");
  });
  note(readBack, `只读工具直接执行并读回盘上正文=${(await text("#outcome")).slice(0, 52)}`);
  note(!(await text("#approval")).includes("工单 #"), "点只读工具不应产生审批卡");
  await click('#side-tab-preview');
  note(await waitFor(async () => (await text('#preview-text')) === 'hello-from-renderer'), "文档预览逐字显示实际读取正文");
  note((await text('#preview-path')) === 'dsh-tool.txt' && (await text('#preview-meta')).includes('19 字节'), "预览文件名与字节数来自会话读取记录");
  note(await js("document.querySelector('#preview-empty') === null && !document.querySelector('#side-page-preview').hidden"), "成功读取后预览替换空状态");
  await click('#side-tab-inspect');

  // tool/ 行的正文必须真的在气泡里，且原始角色前缀可按条追问：默认内容渲染器链把
  // role==="tool" 交给 ToolRole，而 ToolRole 只往 provider store 登记 tool_call_results、
  // 渲染一个注释节点——照默认链走，tool 正文会直接隐身。
  const toolProbe = await js(
    "(() => { const m = document.querySelectorAll('#messages .tr-bubble[data-role=\"tool\"]');" +
    " if (!m.length) return 'no-tool-group';" +
    " const e = m[m.length - 1];" +
    " const src = e.querySelector('.msg-text[data-source-role]');" +
    " return ((e.textContent || '').trim().length > 0 ? 'visible' : 'empty')" +
    " + '|' + (src ? src.getAttribute('data-source-role') : 'no-source-role'); })()"
  );
  note(/^visible\|tool\//.test(toolProbe), `tool 气泡=${toolProbe}`);

  // 超档必须当场拦得住：把档位收到低于一次消耗，再跑一轮就该失效。
  // 这段在 bridge.stop() 之前——stop 之后宿主已死，IPC 会超时。
  await setBudgetField("5");
  note(await click("#apply-budget"), "已派发收紧到 5");
  // 收紧要等一次 IPC 往返：这里必须 waitFor，即时读文案会拿到上一步的旧值
  const tightened5 = await waitFor(async () => (await text("#budget-note")).includes("已收紧到 5"));
  note(tightened5, `收紧到 5=${await text("#budget-note")}`);
  // 收紧后 refreshUsage 读 usage/status，核心回的 verdict=over-budget
  const overTurn = await waitFor(async () => (await text("#turn-usage")).includes("已超档"));
  note(overTurn, `超档读数=${await text("#turn-usage")}`);
  const overSettled = await waitFor(async () => (await text("#turn-usage")).includes("· 超出预算"));
  note(overSettled, `超档判决=${await text("#turn-usage")}`);
  // 核心侧 -32014 是真闸门；界面这层同时要把按钮锁住，别让人连点靠错误提示循环
  const lockState = await js(
    "(() => { const e = document.getElementById('run-turn');" +
    " if (!e) return 'missing';" +
    " return e.disabled === true ? 'attr' : (/disabled/.test(e.className) ? 'cls' : 'live'); })()"
  );
  note(lockState === "attr" || lockState === "cls", `超档后 run-turn 锁定态=${lockState}`);
  note((await text("#run-turn")).includes("已超档"), `超档后按钮文案=${await text("#run-turn")}`);

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
ipcMain.handle("dsh:usageStatus", async () => withHost(() => bridge.request("usage/status")));
// 预算只许收紧：非整数、负数在主进程就拒收，调大由核心回 applied:false。
// 界面拿不到「抬高当前档位」的任何通路，也拿不到发任意方法的那条通道。
ipcMain.handle("dsh:usageSetBudget", async (_e, args) => {
  const b = args && args.budget;
  if (typeof b !== "number" || !Number.isInteger(b) || b < 0) throw new Error("bad-budget");
  return withHost(() => bridge.request("usage/set-budget", { budget: b }));
});

const UI_SMOKE = process.argv.includes("--ui-smoke") || process.argv.includes("--layout-smoke");

app.whenReady().then(async () => {
  if (process.argv.includes("--smoke")) return smoke();
  if (process.argv.includes("--layout-smoke")) {
    seedIfNeeded();
    await bridge.start(SESSION_DIR);
    createWindow();
    const captureArg = process.argv.find((a) => a.startsWith("--capture-dir="));
    const outDir = captureArg ? captureArg.slice("--capture-dir=".length) : join(__dirname, "dist", "layout");
    const ok = await require("./layout-smoke.cjs")({ win, nativeTheme, outDir });
    await bridge.stop();
    app.exit(ok ? 0 : 1);
    return;
  }
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

# DSH 桌面入口 Next SDK 页面工具接入实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Electron 渲染层接入 `@opentiny/next-sdk`（构建期折叠），把 4 个固定页面工具（`page.readState`/`page.clickElement`/`page.inputText`/`page.scroll`）注册进 `document.modelContext`，并经 IPC 让主进程把页面工具并入 `extension/list`、把对 `page.*` 的调用经审批工单路由到渲染层执行。

**Architecture:** 新建 `scripts/pack-next-sdk.mjs`（与 `pack-tinyrobot.mjs` 同机制：esbuild bundle IIFE + 反证式自检，产物 `renderer/vendor/next-sdk.iife.js`）。渲染层新增纯模块 `renderer/page-tools.js`（挂 `window.DshPageTools`，node:vm 单测覆盖，含真实 DOM 操作）。`app.js` 启动时调 `initializeBuiltinWebMCP()` 并把工具 def 注册进 `document.modelContext`，再经新通道 `dsh:pageToolsList` 向主进程登记清单。`main.cjs` 的 `dsh:toolsList` 合并页面工具、`dsh:toolCall` 对 `page.` 前缀经「宿审批工单 + 一次性消费」门禁后走 `webContents.executeJavaScript` 在渲染层执行。仓颉侧（`core/`、`apps/host/`、`apps/cli/`、`extjs/`）本批**一行不改**。

**Tech Stack:** Electron 33 + Vue 3 runtime + esbuild 0.28 + `@opentiny/next-sdk@0.4.11`（已装，`apps/desktop/package.json` 的 `dependencies` 已含，未提交）+ node:test。

**Spec:** `docs/superpowers/specs/2026-10-03-next-sdk-page-tools-design.md`

## Global Constraints

- CSP：`default-src 'self'; style-src 'self'; script-src 'self'` 不改、不加 `unsafe-eval`。渲染层运行时无模块加载器、无模板编译器；`@opentiny/next-sdk` 是 ESM-only，只能构建期折叠成经典脚本。
- 折叠产物里禁止残留动态 `import(`（运行时会撞 CSP，也说明外部依赖没被静止化）。`eval(`/`new Function(` 只允许出现在**已归因的死亡路径**上（`PageController.executeJavascript`、`handleExecuteJavascript`、ajv `makeValidate`），自检逐处归因；活跃路径无运行期求值的**实跑证据**是 `--ui-smoke` 在真 CSP 下注册并执行页面工具全绿。
- 折叠脚本的入口文件必须落在 `apps/desktop` 下面：esbuild 按 entry 所在目录向上找 `node_modules`，放系统临时目录解析不到包。
- `renderer/vendor/` 是 gitignore 的构建产物，判「可复现」要重跑 `npm run vendor` 看文件回来，不许只 grep 脚本。
- IPC 面是按动作命名、逐字段校验的有限集合，不提供「发任意方法」通道。本批只新增 1 个渲染→主通道 `dsh:pageToolsList`；主→渲染的调用腿走 `webContents.executeJavaScript`，**不经 contextBridge**（渲染层不该持有「被主进程调用」的通道）。`preload.cjs` 暴露面从 18 键变 19 键，`--ui-smoke` 的 apiShape/apiExtra 两处数组必须同步。
- 审批凭据只能是工单号：页面工具一律 `needsApproval: true`，调用前必须经宿主的 `approval/ask`→`approval/answer(allowed-once)`；主进程用 `approval/status` 验票 + 进程内一次性消费集合防重放。自报审批字符串没有通路。
- 会话日志仍是唯一真源：页面工具的执行结果**不写** `session.log`（本批不做工具事件持久化），但审批的 asked/decided 仍由宿主落进同一份日志。
- `--ui-smoke` 的 `UI FAIL` 必须为 0、rc=0；`node --test` 全绿且新增用例条数要点名（空测试集按假绿论）。
- 不装 `@opentiny/next-remoter`（不引入第二套聊天组件），不跑 Web Agent 服务，不接外部 MCP 客户端。
- 注释、文档、commit 一律中文；commit 形如 `feat(desktop): 描述` 或 `feat(scripts): 描述`，scope 用 `core/host/cli/desktop/extjs/scripts/docs`。
- 不提交构建产物：`renderer/vendor/`、`apps/desktop/dist/`、`target/`、`*.log`、`dualtest/` 均已 gitignore。
- 共享工作区有并发会话在改源码（`core/src/sse.cj` 等 dirty）：每步 `git add` 只列本任务文件，提交前 `git diff --cached --stat` 逐行复核，不吞并也不 revert 别人的 dirty。
- 真模型凭证、安装包签名、npm publish、人工按 Ctrl+C 仍属仓外阻塞项，本批不解锁、不假装解锁。

## File Structure

| 文件 | 责任 | 本批动作 |
| --- | --- | --- |
| `scripts/pack-next-sdk.mjs` | 折叠 `initializeBuiltinWebMCP` 成 `renderer/vendor/next-sdk.iife.js`；反证式自检（无 `import(`、无裸 `"vue"`、`globalThis.__nextSDK` 已设、运行期求值逐处归因死亡路径） | 新建（Task 1） |
| `apps/desktop/package.json` | `vendor` 串追加 pack-next-sdk.mjs | 改（Task 1） |
| `apps/desktop/renderer/page-tools.js` | 4 个页面工具的 def 与实现：`window.DshPageTools = { list(), execute(name, args) }`，execute 抛契约错、业务未命中回 `{success:false}` | 新建（Task 2） |
| `apps/desktop/test/page-tools.test.mjs` | node:vm 加载 page-tools.js + 受控 DOM 桩；4+ 条用例（清单形状、readState 真读、越界点击、契约违反） | 新建（Task 2） |
| `apps/desktop/renderer/index.html` | 增链 `vendor/next-sdk.iife.js` 与 `page-tools.js` | 改（Task 3） |
| `apps/desktop/renderer/app.js` | 启动时 init WebMCP + registerTool + `dsh:pageToolsList` 登记；`callTool` 对 `page.*` 构参；vendor 缺失即失败 | 改（Task 3） |
| `apps/desktop/preload.cjs` | 新增 `pageToolsList` 通道（18→19 键） | 改（Task 3） |
| `apps/desktop/main.cjs` | `dsh:pageToolsList` 登记（逐字段校验）；`dsh:toolsList` 合并；`dsh:toolCall` 的 `page.` 路由 + 审批验票与一次性消费；ui-smoke 新断言与 apiShape 同步 | 改（Task 3、4） |
| `AGENTS.md` | vendor 三步描述补 pack-next-sdk；渲染层段落补 page-tools 与 modelContext 说明 | 改（Task 4） |

> 计划与规格的一处已知偏差：规格第 4 节把两条 IPC 都画成 `dsh:` 通道，本计划按「主→渲染走 `executeJavaScript`、不经 contextBridge」落实（理由见 Task 3 步骤说明）；规格「bridge.test.mjs 新增 4 条」按主题拆到 `test/page-tools.test.mjs`（node:vm 单元），IPC 往返由 `--ui-smoke` 在真窗口覆盖。验收标准（node --test 全绿 + 新增 4 条 + ui-smoke 新断言）不变。

---

## Task 1: 折叠脚本 scripts/pack-next-sdk.mjs

**Files:**
- Create: `scripts/pack-next-sdk.mjs`
- Modify: `apps/desktop/package.json`（`vendor` 串）

**Interfaces:**
- Consumes: `@opentiny/next-sdk`（`apps/desktop/node_modules`，已在 `dependencies`）；esbuild（devDependency）
- Produces:
  - `renderer/vendor/next-sdk.iife.js`（构建产物，gitignore）
  - `window.__nextSDK = { initializeBuiltinWebMCP }`（渲染层唯一入口）
- 入口文件 `apps/desktop/.nextsdk-entry.mjs` 内容（构建期临时文件，脚本结束时删除）：

```js
import { initializeBuiltinWebMCP } from "@opentiny/next-sdk";
globalThis.__nextSDK = { initializeBuiltinWebMCP };
```

- [ ] **Step 1: 先让「产物缺失」红一次**

在 `apps/desktop` 下确认当前没有折叠产物、也没有产出它的脚本（红：接入缺一环，不该靠嘴说「能折」）：

```bash
cd apps/desktop && ls renderer/vendor/next-sdk.iife.js 2>&1; ls ../../scripts/pack-next-sdk.mjs 2>&1
```

Expected: 两条都是「No such file or directory」。

- [ ] **Step 2: 写折叠脚本（新建 scripts/pack-next-sdk.mjs）**

```js
// 把 @opentiny/next-sdk 的 WebMCP 初始化折叠成渲染层能用的一种形态：单个经典脚本。
// 机制与 pack-tinyrobot.mjs 同：next-sdk 是 ESM-only，而桌面跑在 file:// + CSP script-src 'self'
// 上，既不能加载 ES module 也没有运行时模板编译器，所以只在构建期折叠。
// 只引 initializeBuiltinWebMCP：本批是纯前端模式（规格范围排除 next-remoter / Web Agent /
// 外部 MCP 客户端），不引 WebMcpClient——引了就是把远程模式那 1MB+ 死代码一起发货。
import { existsSync, mkdtempSync, writeFileSync, rmSync, statSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DESKTOP = join(ROOT, "apps", "desktop");
const requireFromDesktop = createRequire(join(DESKTOP, "package.json"));

const PKG = "@opentiny/next-sdk";
const OUT_JS = join(DESKTOP, "renderer", "vendor", "next-sdk.iife.js");

function die(msg) {
  console.error(`pack-next-sdk 失败：${msg}`);
  process.exit(2);
}

let esbuild;
try {
  esbuild = requireFromDesktop("esbuild");
} catch (e) {
  die(`esbuild 未安装（在 apps/desktop 跑 npm install）：${e.message}`);
}
try {
  requireFromDesktop.resolve(join(PKG, "package.json"));
} catch {
  die(`依赖包 ${PKG} 未安装（在 apps/desktop 跑 npm install）`);
}

// 入口必须落在 apps/desktop 下面：esbuild 按 entry 所在目录向上找 node_modules，
// 放系统临时目录会解析不到组件包（TinyVue/TinyRobot 两条路都实测过）。
const work = mkdtempSync(join(DESKTOP, ".nextsdk-"));
try {
  const entry = join(work, "entry.mjs");
  writeFileSync(entry, 'import { initializeBuiltinWebMCP } from "@opentiny/next-sdk";\nglobalThis.__nextSDK = { initializeBuiltinWebMCP };\n');

  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    outfile: OUT_JS,
    logLevel: "warning",
    target: ["chrome120"],
  });

  // 反证式自检。CSP 的生死线分两类：
  // 1) import( 与裸 "vue" 是零容忍——一条都不许有；
  // 2) eval(/new Function( 只允许出现在已归因的死亡路径上（PageController 的
  //    executeJavascript、page-agent 的 handleExecuteJavascript、ajv 的 makeValidate）。
  //    CSP 只在**调用时**拦截运行期求值，不在解析时；这些路径本批的调用图永远走不到
  //    （不注册 page-agent 工具、不用导出的 Ajv）。死亡路径允许存在但必须逐处归因——
  //    出现第 5 处无法归因的求值就 die（防上游升级把 eval 挪到活跃路径上）。
  //    活跃路径无求值的实跑证据在 --ui-smoke：真 CSP 下 registerTool + execute 全绿。
  const code = readFileSync(OUT_JS, "utf8");
  if (/import\(/.test(code)) die("折叠产物残留 import()，外部动态 import 没能在构建期静止化");
  if (/["']vue["']/.test(code)) die('折叠产物残留 vue 裸说明符，会出现第二份 Vue');
  if (!code.includes("globalThis.__nextSDK")) die("折叠产物没挂上 globalThis.__nextSDK");
  // 已知死亡路径标记：每处运行期求值的上下文里必须出现其中之一
  const deadMarkers = ["executeJavascript", "handleExecuteJavascript", "makeValidate"];
  const evalSites = [...code.matchAll(/\beval\(/g)];
  const fnSites = [...code.matchAll(/new Function\(/g)];
  for (const m of [...evalSites, ...fnSites]) {
    const from = Math.max(0, m.index - 400);
    const context = code.slice(from, m.index + 40);
    if (!deadMarkers.some((marker) => context.includes(marker))) {
      die(`折叠产物出现无法归因的运行期求值（既不在 executeJavascript/handleExecuteJavascript/makeValidate 死亡路径上）：${JSON.stringify(context.slice(-120))}`);
    }
  }
  console.log(`next-sdk 折叠完成：js=${statSync(OUT_JS).size} 字节，eval/new Function 共 ${evalSites.length + fnSites.length} 处且全部归因死亡路径 → ${OUT_JS}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
```

- [ ] **Step 3: 跑折叠脚本，确认自检与产物**

```bash
node scripts/pack-next-sdk.mjs
```

Expected: rc=0，输出 `next-sdk 折叠完成：js=166xxxx 字节，eval/new Function 共 4 处且全部归因死亡路径 → ...\renderer\vendor\next-sdk.iife.js`。若报「无法归因」die，把新出现的上下文贴进失败信息里再判它是否真在活跃路径（默认按活跃处理，不许放行）。

- [ ] **Step 4: 把折叠接进 vendor 流水线**

`Edit apps/desktop/package.json`，把 `vendor` 串改为（其余脚本行不动）：

```json
"vendor": "node ../../scripts/pack-vendor.mjs && node ../../scripts/pack-tinyvue.mjs && node ../../scripts/pack-tinyrobot.mjs && node ../../scripts/pack-next-sdk.mjs",
```

- [ ] **Step 5: 复跑整条 vendor，确认产物可复现**

```bash
cd apps/desktop && npm run vendor
```

Expected: rc=0，四个折叠步骤都打印完成；`renderer/vendor/` 下出现 `next-sdk.iife.js`（mtime 是新的）。

- [ ] **Step 6: 变异反证——自检真的会die**

`Edit scripts/pack-next-sdk.mjs`，把 Step 2 里 `import(` 自检那条临时改成永真（`if (false && /import\(/.test(code)) die("折叠产物残留 import()，外部动态 import 没能在构建期静止化");`），随后往产物尾部追加一条 `import("x");`：

```bash
cd apps/desktop && printf '\nimport("x");\n' >> renderer/vendor/next-sdk.iife.js && node ../../scripts/pack-next-sdk.mjs; echo "rc=$?"
```

Expected: rc=2 且输出 `pack-next-sdk 失败：折叠产物残留 import(...)`（若 rc=0，说明自检被改死了，先修再往下）。把自检还原（`Edit` 改回 `if (/import\(/.test(code)) die(...)`），重跑 `node scripts/pack-next-sdk.mjs` 回到 rc=0，`git diff scripts/pack-next-sdk.mjs` 必须为空（证明还原逐字一致）。

- [ ] **Step 7: 提交**

```bash
git add scripts/pack-next-sdk.mjs apps/desktop/package.json
git diff --cached --stat   # 只许这两行；package.json 的 dependencies 块是本批之前装的 next-sdk，一并纳入
git commit -m "feat(scripts,desktop): 构建期折叠 next-sdk WebMCP 初始化并接入 vendor 流水线"
```

---

## Task 2: 页面工具模块 page-tools.js + node:vm 单测

**Files:**
- Create: `apps/desktop/renderer/page-tools.js`
- Create: `apps/desktop/test/page-tools.test.mjs`

**Interfaces:**
- Consumes: 无（不引 Vue、不引 Next SDK 折叠产物；DOM 操作全走标准 API）
- Produces: `window.DshPageTools`
  - `list(): Array<{name, description, inputSchema}>` —— 过 IPC 登记用的清单（**不含 execute**，函数不能过 JSON）
  - `definitions(): Array<{name, description, inputSchema, execute}>` —— `document.modelContext.registerTool` 直接吃这些 def
  - `execute(name: string, args: object): object` —— 主进程 `executeJavaScript` 与单测共用的执行缝
- 契约：未知工具名、参数缺失/类型错 → `throw new Error("unknown-tool:<name>" 或 "bad-arguments:<原因>")`；业务未命中（索引越界、元素类型不符）→ 回 `{ success: false, message }`，**不抛**。

- [ ] **Step 1: 先写失败测试（新建 apps/desktop/test/page-tools.test.mjs）**

```js
// 页面工具模块的验收。page-tools.js 是经典脚本（挂 window.DshPageTools），
// 所以用 node:vm 配一个受控 DOM 桩求值——不引 jsdom（零依赖纪律），
// 桩只按 4 个工具真实会碰的面造：title/body.innerText/querySelectorAll/Event/scrollBy。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "renderer", "page-tools.js");

function makeSandbox() {
  const dispatched = [];
  class Event {
    constructor(type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); }
  }
  const el = (tag, extra) => Object.assign({
    tagName: tag.toUpperCase(),
    dispatchEvent(e) { dispatched.push(e); return true; },
  }, extra || {});
  const buttons = [el("button"), el("button")];
  const inputs = [el("input", { value: "", disabled: false, readOnly: false })];
  buttons.forEach((b) => { b.click = () => { b.clicked = (b.clicked || 0) + 1; }; });
  const document = {
    title: "SaCode · 编程工作台",
    body: { innerText: "页面正文" },
    querySelectorAll(selector) {
      if (selector === "*") return buttons.concat(inputs);
      if (selector === "input, textarea") return inputs;
      return buttons;
    },
  };
  const window = { Event, scrollBy(x, y) { this.lastScroll = [x, y]; } };
  const sandbox = { document, window, Event, console };
  return { sandbox, buttons, inputs, dispatched, window };
}

const { sandbox, buttons, inputs, dispatched, window: stubWindow } = makeSandbox();
runInNewContext(readFileSync(FILE, "utf8"), sandbox);
const P = sandbox.window.DshPageTools;

test("list 交出恰好 4 个页面工具，每个带 name/description/inputSchema", () => {
  const tools = P.list();
  assert.deepEqual(tools.map((t) => t.name), ["page.readState", "page.clickElement", "page.inputText", "page.scroll"]);
  for (const t of tools) {
    assert.match(t.name, /^page\.[a-zA-Z]+$/, "页面工具名必须带 page. 前缀");
    assert.equal(typeof t.description, "string");
    assert.ok(t.description.length > 0, "description 不许为空（polyfill 会拒）");
    assert.equal(t.inputSchema.type, "object");
  }
  // execute 不许出现在清单里：清单要过 IPC，函数过不去也不该过
  assert.equal(tools.some((t) => "execute" in t), false);
});

test("readState 从真实 DOM 读回标题、元素数与可见正文", () => {
  assert.deepEqual(P.execute("page.readState", {}), {
    title: "SaCode · 编程工作台",
    elementCount: 3,
    visibleText: "页面正文",
  });
});

test("clickElement 按索引命中并触发 click，越界只回 success:false", () => {
  const miss = P.execute("page.clickElement", { index: 99 });
  assert.equal(miss.success, false);
  assert.match(miss.message, /越界/);
  assert.equal(buttons[0].clicked, undefined, "越界调用不许顺手点到第 0 个");
  assert.equal(P.execute("page.clickElement", { index: 1 }).success, true);
  assert.equal(buttons[1].clicked, 1, "index=1 必须点到第 1 个");
  assert.equal(buttons[0].clicked, undefined, "不许退化成永远点第 0 个");
});

test("inputText 写入 value 并派发可冒泡的 input 事件", () => {
  const r = P.execute("page.inputText", { index: 0, text: "页面工具输入" });
  assert.equal(r.success, true);
  assert.equal(inputs[0].value, "页面工具输入");
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, "input");
  assert.equal(dispatched[0].bubbles, true, "必须冒泡，否则应用层读不到");
});

test("scroll 按方向换算像素并调 window.scrollBy", () => {
  assert.equal(P.execute("page.scroll", { direction: "down", amount: 120 }).success, true);
  assert.deepEqual(stubWindow.lastScroll, [0, 120]);
  assert.equal(P.execute("page.scroll", { direction: "up", amount: 40 }).success, true);
  assert.deepEqual(stubWindow.lastScroll, [0, -40]);
});

test("未知工具与参数违反都以错误回执，不静默成功", () => {
  assert.throws(() => P.execute("no.such", {}), /unknown-tool:no\.such/);
  assert.throws(() => P.execute("page.clickElement", {}), /bad-arguments/);
  assert.throws(() => P.execute("page.clickElement", { index: -1 }), /bad-arguments/);
  assert.throws(() => P.execute("page.clickElement", { index: "0" }), /bad-arguments/);
  assert.throws(() => P.execute("page.inputText", { index: 0 }), /bad-arguments/);
  assert.throws(() => P.execute("page.inputText", { index: 0, text: 5 }), /bad-arguments/);
  assert.throws(() => P.execute("page.scroll", { direction: "sideways", amount: 10 }), /bad-arguments/);
  assert.throws(() => P.execute("page.scroll", { direction: "down", amount: 0 }), /bad-arguments/);
});

test("definitions 的每个 def 带 execute 函数且与 list 同名同序", () => {
  const defs = P.definitions();
  assert.deepEqual(defs.map((d) => d.name), P.list().map((t) => t.name));
  for (const d of defs) assert.equal(typeof d.execute, "function");
});
```

- [ ] **Step 2: 跑测试确认红（模块不存在）**

```bash
cd apps/desktop && node --test test/page-tools.test.mjs
```

Expected: FAIL，报错是 `ENOENT: no such file or directory ... renderer\page-tools.js`（读源码那句炸的）——红在「被测模块缺失」，不是打字错误。

- [ ] **Step 3: 写页面工具模块（新建 apps/desktop/renderer/page-tools.js）**

```js
/* 页面工具集：4 个固定工具的 def 与实现，挂 window.DshPageTools。
   状态只在页面内存（计数器、代次标识），不接文件、账号或凭证。
   契约分两类，别混：未知工具/参数违反是调用方违约，抛 Error 让上层回绝；
   索引越界/元素不可用是业务未命中，回 { success:false } 让模型能自己纠错。
   click 用的可交互元素集合与 input 用的可输入集合是两张不同的表——
   点第 3 个「可交互元素」和对第 3 个「可输入元素」写入不是一回事，索引空间必须分开。 */
"use strict";
(function (g) {
  const INTERACTIVE = "button, a[href], input, select, textarea, [role='button']";
  const TEXTUAL = "input, textarea";

  const readState = {
    name: "page.readState",
    description: "读取页面当前状态：标题、元素总数与可见正文",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: () => ({
      title: document.title,
      elementCount: document.querySelectorAll("*").length,
      visibleText: (document.body && document.body.innerText) || "",
    }),
  };

  const clickElement = {
    name: "page.clickElement",
    description: "按索引点击页面上的可交互元素（button/a/input/select/textarea/role=button）",
    inputSchema: {
      type: "object",
      properties: { index: { type: "number", minimum: 0 } },
      required: ["index"],
      additionalProperties: false,
    },
    execute: (args) => {
      const index = args && args.index;
      if (!Number.isInteger(index) || index < 0) throw new Error("bad-arguments:page.clickElement 需要非负整数 index");
      const elements = [...document.querySelectorAll(INTERACTIVE)];
      if (index >= elements.length) return { success: false, message: `索引 ${index} 越界：可交互元素共 ${elements.length} 个` };
      elements[index].click();
      return { success: true, message: `已点击第 ${index} 个可交互元素` };
    },
  };

  const inputText = {
    name: "page.inputText",
    description: "按索引向输入元素写入文本（input/textarea）",
    inputSchema: {
      type: "object",
      properties: { index: { type: "number", minimum: 0 }, text: { type: "string" } },
      required: ["index", "text"],
      additionalProperties: false,
    },
    execute: (args) => {
      const index = args && args.index;
      const text = args && args.text;
      if (!Number.isInteger(index) || index < 0) throw new Error("bad-arguments:page.inputText 需要非负整数 index");
      if (typeof text !== "string") throw new Error("bad-arguments:page.inputText 需要字符串 text");
      const elements = [...document.querySelectorAll(TEXTUAL)];
      if (index >= elements.length) return { success: false, message: `索引 ${index} 越界：可输入元素共 ${elements.length} 个` };
      const target = elements[index];
      if (target.disabled || target.readOnly) return { success: false, message: "目标元素不可输入" };
      target.value = text;
      target.dispatchEvent(new g.Event("input", { bubbles: true }));
      return { success: true, message: `已向第 ${index} 个输入元素写入 ${text.length} 个字符` };
    },
  };

  const scroll = {
    name: "page.scroll",
    description: "滚动页面（direction: up/down，amount: 正数像素）",
    inputSchema: {
      type: "object",
      properties: { direction: { type: "string", enum: ["up", "down"] }, amount: { type: "number", minimum: 1 } },
      required: ["direction", "amount"],
      additionalProperties: false,
    },
    execute: (args) => {
      const direction = args && args.direction;
      const amount = args && args.amount;
      if (direction !== "up" && direction !== "down") throw new Error("bad-arguments:page.scroll 的 direction 只能是 up 或 down");
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) throw new Error("bad-arguments:page.scroll 需要正数 amount");
      g.scrollBy(0, direction === "down" ? amount : -amount);
      return { success: true, message: `已向${direction === "down" ? "下" : "上"}滚动 ${amount} 像素` };
    },
  };

  const defs = [readState, clickElement, inputText, scroll];

  g.DshPageTools = {
    // list 只汇报契约面：name/description/inputSchema。execute 是函数，
    // 既不能过 IPC 的 JSON，也不该让调用方绕过 modelContext 直接拿到。
    list: () => defs.map((d) => ({ name: d.name, description: d.description, inputSchema: d.inputSchema })),
    definitions: () => defs,
    execute: (name, args) => {
      const def = defs.find((d) => d.name === name);
      if (!def) throw new Error("unknown-tool:" + name);
      return def.execute(args || {});
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
```

- [ ] **Step 4: 跑测试确认绿**

```bash
cd apps/desktop && node --test test/page-tools.test.mjs
```

Expected: PASS，7 条用例全过（`node --test` 结束时汇总 `pass 7`）。

- [ ] **Step 5: 变异反证——「按索引命中」真的被钉住**

```bash
cd apps/desktop && cp renderer/page-tools.js /tmp/page-tools.bak.mjs
```

`Edit renderer/page-tools.js`：把 `elements[index].click()` 改成 `elements[0].click()`（语义退化成永远点第一个）。

```bash
node --test --test-name-pattern="clickElement" test/page-tools.test.mjs; echo "rc=$?"
```

Expected: rc≠0，且失败信息落在「index=1 必须点到第 1 个」或「不许退化成永远点第 0 个」（指定用例名变红才算反证成功）。还原：

```bash
cp /tmp/page-tools.bak.mjs renderer/page-tools.js && diff /tmp/page-tools.bak.mjs renderer/page-tools.js && echo "还原逐字一致" && node --test test/page-tools.test.mjs
```

Expected: `diff` 无输出、打印「还原逐字一致」、测试回到全绿。

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/renderer/page-tools.js apps/desktop/test/page-tools.test.mjs
git diff --cached --stat   # 只许这两行
git commit -m "feat(desktop): 新增 4 个页面工具模块与 node:vm 受控 DOM 单测"
```

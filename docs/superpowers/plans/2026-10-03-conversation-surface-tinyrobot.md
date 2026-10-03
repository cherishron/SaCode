# 对话面升级（TinyRobot 消息组件接入）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把桌面渲染层的对话消息面从「按行拆文本」升级为 TinyRobot BubbleList 气泡（连续同角色分组、自定义文本渲染器接管 tool 行、长消息折叠、色值令牌桥接），并把 `--ui-smoke` 断言条数只增不减地补齐。

**Architecture:** 新增构建期折叠脚本 `scripts/pack-tinyrobot.mjs`（与 `pack-tinyvue.mjs` 同机制：esbuild bundle + `vue` 别名到 vendored runtime + CSP 反证自检 + 静态 CSS 拷贝）。渲染层新增纯派生层 `renderer/msgfold.js`（角色映射与折叠判定，node 单测覆盖）。`app.js` 的消息区换成 `BubbleProvider + BubbleList`，用自定义文本内容渲染器接管所有 text 内容。折叠态用模块级 reactive Set。色值经 `--tr-*` 桥回本仓令牌层，由扩展后的 leakProbe 把关。

**Tech Stack:** Electron 33 + Vue 3 runtime + esbuild 0.28 + `@opentiny/tiny-robot@0.5.1`（已装）+ `@opentiny/tiny-robot-svgs`（已装）+ node:test。仓颉侧（`core/`、`apps/host/`、`apps/cli/`、`extjs/`）本批**一行不改**，只在收尾复跑取证。

**Spec:** `docs/superpowers/specs/2026-10-03-conversation-surface-tinyrobot-design.md`

## Global Constraints

- CSP：`default-src 'self'; style-src 'self'; script-src 'self'`。渲染层运行时无模块加载器、无模板编译器；第三方组件库（ESM-only）只能构建期折叠成经典脚本。
- `vue` 别名纪律：折叠产物里 `vue` 必须别名到 `module.exports = globalThis.Vue` 的 shim，用 `pack-vendor.mjs` 落进 `vendor/` 的那一份 Vue runtime。装第二份 Vue 会让组件响应式与应用不是同一套（表现为「点了不更新」）。
- 折叠脚本的入口与 shim 必须落在 `apps/desktop` 下面：esbuild 按 entry 所在目录向上找 `node_modules`，放系统临时目录解析不到组件包。
- 会话日志是唯一真源：分组与折叠**只是投影之上的视图派生**，不写日志、不发协议帧、不新增 IPC 通道（`preload.cjs` 暴露面恰好 11 键不变）。
- 界面上出现的每个数字/状态都能在 `session.log` 或协议应答里找到出处。
- `--ui-smoke` 的 `UI OK` 条数只增不减（基线 46），`UI FAIL` 必须为 0，rc=0；dev 态与打包态各跑一遍。
- 组件库元素的色值必须来自本仓令牌层（`--tv-*` 已有桥接纪律，`--tr-*` 同规矩）。
- 注释、文档、commit 一律中文；commit 形如 `feat(desktop): 描述`，scope 用 `core/host/cli/desktop/extjs/scripts/docs`。
- 不提交构建产物：`renderer/vendor/`、`apps/desktop/dist/`、`target/`、`*.log` 均已 gitignore。
- 共享工作区有并发会话在改源码：每步 `git add` 只列本任务的文件，提交前 `git diff --cached --stat` 逐行复核，不吞并也不 revert 别人的 dirty。
- 真模型凭证、安装包签名、npm publish、人工按 Ctrl+C 仍属仓外阻塞项，本批不解锁、不假装解锁。

---

## File Structure

| 文件 | 责任 | 本批动作 |
| --- | --- | --- |
| `scripts/pack-tinyrobot.mjs` | 折叠 bubble 一族成 `renderer/vendor/tinyrobot.iife.js`，拷贝 `dist/style.css` → `tinyrobot.css`，CSP 反证自检 | 新建（Task 2） |
| `scripts/pack-tinyvue.mjs` | 已有：折叠 TinyVue Button。**补**：同时产出 `tinyvue.iife.css`（修输出契约缺口） | 改（Task 6） |
| `apps/desktop/renderer/msgfold.js` | 纯派生层：角色映射表 + `toBubbleMessages` + `foldPlan`，挂 `window.DshMsgFold` | 新建（Task 1） |
| `apps/desktop/test/msgfold.test.mjs` | msgfold 的 node 单测（读源码求值，断言边界） | 新建（Task 1） |
| `apps/desktop/renderer/index.html` | 增链 `tinyrobot.css` / `tinyrobot.iife.js` / `msgfold.js` | 改（Task 2） |
| `apps/desktop/renderer/app.js` | 消息区换 BubbleList；自定义文本渲染器；折叠态；角色标签走 prefix 槽 | 改（Task 3、4） |
| `apps/desktop/renderer/styles.css` | 删随 DOM 死的 `.msg-*` 规则；补 `.msg-text`/`.btn-fold`；加 `--tr-*` 桥接块 | 改（Task 3、5） |
| `apps/desktop/main.cjs` | `seedIfNeeded` 补一条 `assistant/message`；`uiSmoke` 迁移 `.msg` 选择器 + 新增断言 | 改（Task 2、3、4、5） |
| `apps/desktop/package.json`（+ lock） | `vendor` 三步；按需新增 `markdown-it`/`dompurify` devDep | 改（Task 2） |
| `AGENTS.md` | vendor 步骤与渲染层描述同步 | 改（Task 7） |
| `docs/plans/dsh-capability-matrix.md` | `conversation` 行「已复刻」◐→✔ | 改（Task 7） |
| `docs/evidence/p0-status-2026-10-02.md` | 追记本批实测计数与限制 | 改（Task 7） |

---

## Task 1: msgfold.js 纯派生层 + node 单测

**Files:**
- Create: `apps/desktop/renderer/msgfold.js`
- Create: `apps/desktop/test/msgfold.test.mjs`

**Interfaces:**
- Consumes: 无（纯函数，不引 Vue、不碰 DOM）
- Produces: `window.DshMsgFold`
  - `FOLD_THRESHOLD: number`（常量 240，全仓唯一折叠阈值出处）
  - `ROLE_MAP: Array<[prefix, role, placement, shape]>`（按声明顺序匹配投影行前缀）
  - `toBubbleMessages(lines: string[]): Array<{id, role, content, sourceRole}>`
    - `id = "m" + 下标`（投影追加-only，故位次即稳定 id）
    - `role` = ROLE_MAP 命中项第 2 列；不命中回落 `"system"`
    - `sourceRole` = 投影行第一个 `:` 之前的原始串（界面上的角色标签复述它，不让 `data-role` 说谎）
    - `content` = 第一个 `:` 之后去掉一个前导空格的正文（与退役的 `splitMsg` 同口径）
    - **不返回 placement**：定位/形状走 `roleConfigs()`，只有一处真源
  - `roleConfigs(): Record<role, {placement, shape}>`（由 ROLE_MAP 生成）
  - `foldPlan(text: string, threshold: number): {folded: boolean, shown: string}`
    - `text.length > threshold` → `{folded: true, shown: text.slice(0, threshold) + "…"}`
    - 否则 → `{folded: false, shown: text}`

- [ ] **Step 1: 写失败测试**

Create `apps/desktop/test/msgfold.test.mjs`：

```js
// 对话面纯派生层的验收。msgfold.js 是经典脚本（挂 window.DshMsgFold），
// 所以这里用一个空 window 求值，再把返回的引用交给断言——纯函数没有别的依赖。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "renderer", "msgfold.js");
const window = {};
new Function("window", readFileSync(FILE, "utf8"))(window);
const F = window.DshMsgFold;

test("toBubbleMessages 按映射表把投影行翻成气泡消息", () => {
  const ms = F.toBubbleMessages(["user/message: 你好", "assistant/message: 世界", "tool/result ok: x", "system/message: s"]);
  assert.equal(ms[0].role, "user");
  assert.equal(ms[0].content, "你好");
  assert.equal(ms[0].sourceRole, "user/message");
  assert.equal(ms[1].role, "assistant");
  assert.equal(ms[2].role, "tool");
  assert.equal(ms[2].sourceRole, "tool/result ok");
  assert.equal(ms[3].role, "system");
});

test("每条消息带按投影位次的稳定 id", () => {
  const ms = F.toBubbleMessages(["user/message: a", "user/message: b"]);
  assert.equal(ms[0].id, "m0");
  assert.equal(ms[1].id, "m1");
});

test("未命中映射表回落 system，且不会造出第二个角色", () => {
  const ms = F.toBubbleMessages(["unknown/thing: x"]);
  assert.equal(ms[0].role, "system");
  assert.equal(ms[0].sourceRole, "unknown/thing");
});

test("正文里的冒号原样保留（只按第一个冒号切一次）", () => {
  const ms = F.toBubbleMessages(["tool/result ok: path: with: colons"]);
  assert.equal(ms[0].content, "path: with: colons");
});

test("roleConfigs 与映射表同源，user 在右其余在左", () => {
  const rc = F.roleConfigs();
  assert.equal(rc.user.placement, "end");
  assert.equal(rc.assistant.placement, "start");
  assert.equal(rc.tool.placement, "start");
  assert.equal(rc.system.placement, "start");
});

test("foldPlan：恰好等于阈值不折叠", () => {
  const t = "a".repeat(F.FOLD_THRESHOLD);
  const p = F.foldPlan(t, F.FOLD_THRESHOLD);
  assert.equal(p.folded, false);
  assert.equal(p.shown, t);
});

test("foldPlan：超阈值截到阈值长度并附省略号", () => {
  const t = "a".repeat(F.FOLD_THRESHOLD + 10);
  const p = F.foldPlan(t, F.FOLD_THRESHOLD);
  assert.equal(p.folded, true);
  assert.equal(p.shown.length, F.FOLD_THRESHOLD + 1);
  assert.ok(p.shown.endsWith("…"));
});

test("foldPlan：空串与短串都不折叠，shown 原文返回", () => {
  assert.equal(F.foldPlan("", F.FOLD_THRESHOLD).folded, false);
  assert.equal(F.foldPlan("短正文", F.FOLD_THRESHOLD).shown, "短正文");
});
```

- [ ] **Step 2: 跑测试看红**

Run: `cd "D:/Project/sa/saai/sa-code/apps/desktop" && node --test test/msgfold.test.mjs`
Expected: FAIL —— `Error: ENOENT: no such file or directory, open '...\renderer\msgfold.js'`（文件还不存在，红得干净）。

- [ ] **Step 3: 写实现**

Create `apps/desktop/renderer/msgfold.js`：

```js
// 对话面的纯派生层：投影行数组 → 气泡消息数组，以及长消息折叠判定。
// 只放纯函数（挂 window.DshMsgFold），不引 Vue、不碰 DOM，这样 node 单测能直接求值。
// 角色映射的唯一来源就是这张表；投影行的原始前缀保留在 sourceRole 里，
// 界面标签复述它，data-role 用映射值——两者都能从会话日志找到出处，不造假。
"use strict";
window.DshMsgFold = (function () {
  // 全仓唯一的折叠阈值出处。要调只改这一处；组件里不许再出现第二个数字。
  var FOLD_THRESHOLD = 240;

  // 按声明顺序匹配投影行前缀：[前缀, 气泡角色, 定位, 形状]
  var ROLE_MAP = [
    ["user/", "user", "end", "corner"],
    ["assistant/", "assistant", "start", "corner"],
    ["tool/", "tool", "start", "corner"],
    ["system/", "system", "start", "none"]
  ];

  function splitMsg(line) {
    var i = line.indexOf(":");
    if (i < 0) return { role: "", text: line };
    return { role: line.slice(0, i), text: line.slice(i + 1).replace(/^ /, "") };
  }

  function toBubbleMessages(lines) {
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var parts = splitMsg(lines[i]);
      var role = "system";
      for (var k = 0; k < ROLE_MAP.length; k++) {
        if (parts.role.indexOf(ROLE_MAP[k][0]) === 0) {
          role = ROLE_MAP[k][1];
          break;
        }
      }
      out.push({ id: "m" + i, role: role, content: parts.text, sourceRole: parts.role });
    }
    return out;
  }

  // 定位与形状从同一张表生成，避免出现「映射表说 start、roleConfigs 说 end」这种双真源。
  function roleConfigs() {
    var rc = {};
    for (var k = 0; k < ROLE_MAP.length; k++) {
      rc[ROLE_MAP[k][1]] = { placement: ROLE_MAP[k][2], shape: ROLE_MAP[k][3] };
    }
    return rc;
  }

  function foldPlan(text, threshold) {
    if (text.length > threshold) {
      return { folded: true, shown: text.slice(0, threshold) + "…" };
    }
    return { folded: false, shown: text };
  }

  return {
    FOLD_THRESHOLD: FOLD_THRESHOLD,
    ROLE_MAP: ROLE_MAP,
    toBubbleMessages: toBubbleMessages,
    roleConfigs: roleConfigs,
    foldPlan: foldPlan
  };
})();
```

- [ ] **Step 4: 跑测试看绿**

Run: `cd "D:/Project/sa/saai/sa-code/apps/desktop" && node --test test/msgfold.test.mjs`
Expected: `# pass 8`、`# fail 0`。

- [ ] **Step 5: 跑全套确认无回归**

Run: `cd "D:/Project/sa/saai/sa-code/apps/desktop" && npm test`
Expected: PASS，`# pass` 比改动前多 8（基线 50 → 58；**读数只认剥掉颜色码后最后一个 Summary 块**，不许用 grep 数 `PASSED` 标记）。

- [ ] **Step 6: 提交**

```bash
cd "D:/Project/sa/saai/sa-code" && git add apps/desktop/renderer/msgfold.js apps/desktop/test/msgfold.test.mjs && git diff --cached --stat && git commit -m "feat(desktop): 加对话面纯派生层 msgfold 与其 node 单测"
```

---

## Task 2: pack-tinyrobot.mjs 折叠脚本 + 加载链接线

**Files:**
- Create: `scripts/pack-tinyrobot.mjs`
- Modify: `apps/desktop/renderer/index.html`
- Modify: `apps/desktop/package.json`、`apps/desktop/package-lock.json`（vendor 三步；按需 devDeps）
- Modify: `apps/desktop/main.cjs`（`uiSmoke` 加一条组件库加载探针）

**Interfaces:**
- Consumes: `@opentiny/tiny-robot/dist/bubble/index.js`（导出 `Bubble`/`BubbleList`/`BubbleProvider`）、`apps/desktop/renderer/vendor/vue.runtime.global.prod.js`（Task 前置产物，由 pack-vendor 生成）
- Produces: `apps/desktop/renderer/vendor/tinyrobot.iife.js`（内含 `globalThis.TinyRobot = { Bubble, BubbleList, BubbleProvider }`）、`apps/desktop/renderer/vendor/tinyrobot.css`；`window.TinyRobot` 在 `app.js` 之前就绪

- [ ] **Step 1: 写折叠脚本（此时还没有任何断言能跑到它，下一步先补断言再回来跑）**

Create `scripts/pack-tinyrobot.mjs`：

```js
// 把 TinyRobot 的 bubble 一族折叠成渲染层能用的一种形态：单个经典脚本 + 一份静态 CSS。
// 为什么必须有这一步（机制与 pack-tinyvue.mjs 同）：@opentiny/tiny-robot 是 ESM-only，
// 而桌面跑在 file:// + CSP script-src 'self' 上，既不能加载 ES module 也没有运行时模板
// 编译器，所以只在**构建期**折叠。关键一条：alias `vue` 指到只写
// `module.exports = globalThis.Vue` 的 shim，产物用的还是 pack-vendor.mjs 落进 vendor/
// 的那一份 Vue runtime——装进两份 Vue 会让组件的响应式系统跟应用的不是同一套实例。
//
// markdown-it / dompurify 是 Bubble 的 Markdown 渲染路径在 dist/index6.js 里做的外部动态
// import。本批不启用那条路径（它不在默认内容渲染器链里），但仍要把两个包装成 devDependency
// 让它们**在构建期静止化**：否则产物里会留一条运行时 import()，既是 CSP 上的刺，也是
// 「折叠成功」与「渲染成功」之间的运行时分叉。
import { existsSync, mkdtempSync, writeFileSync, rmSync, statSync, readFileSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DESKTOP = join(ROOT, "apps", "desktop");
// 依赖装在 apps/desktop 下，脚本在仓库根的 scripts/ 里，所以要按 desktop 的视角解析。
const requireFromDesktop = createRequire(join(DESKTOP, "package.json"));

const PKG = "@opentiny/tiny-robot";
const OUT_JS = join(DESKTOP, "renderer", "vendor", "tinyrobot.iife.js");
const OUT_CSS = join(DESKTOP, "renderer", "vendor", "tinyrobot.css");

function die(msg) {
  console.error(`pack-tinyrobot 失败：${msg}`);
  process.exit(2);
}

let esbuild;
try {
  esbuild = requireFromDesktop("esbuild");
} catch (e) {
  die(`esbuild 未安装（在 apps/desktop 跑 npm install）：${e.message}`);
}
for (const pkg of [PKG, "@opentiny/tiny-robot-svgs"]) {
  try {
    requireFromDesktop.resolve(join(pkg, "package.json"));
  } catch {
    die(`依赖包 ${pkg} 未安装（在 apps/desktop 跑 npm install）`);
  }
}
const vueRuntime = join(DESKTOP, "renderer", "vendor", "vue.runtime.global.prod.js");
if (!existsSync(vueRuntime)) die("缺 renderer/vendor/vue.runtime.global.prod.js，先跑 node scripts/pack-vendor.mjs");

// 入口与 shim 必须落在 apps/desktop 下面：esbuild 按 entry 所在目录向上找 node_modules，
// 放到系统临时目录会解析不到组件包（TinyVue 那条路实测过）。
const work = mkdtempSync(join(DESKTOP, ".tinyrobot-"));
try {
  const shim = join(work, "vue-global.cjs");
  writeFileSync(shim, "module.exports = globalThis.Vue;\n");
  const entry = join(work, "entry.js");
  writeFileSync(
    entry,
    'import { Bubble, BubbleList, BubbleProvider } from "@opentiny/tiny-robot/dist/bubble/index.js";\n' +
      "globalThis.TinyRobot = { Bubble: Bubble, BubbleList: BubbleList, BubbleProvider: BubbleProvider };\n"
  );

  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    alias: { vue: shim },
    outfile: OUT_JS,
    logLevel: "warning",
    target: ["chrome120"],
  });

  // 反证式自检：CSP 的生死线是产物里不能有运行时求值、不能有运行时模块加载，
  // 也不能残留裸 "vue" 说明符（那等于第二份 Vue）。
  const code = readFileSync(OUT_JS, "utf8");
  if (/new Function\(|\beval\(/.test(code)) die("折叠产物含运行时求值，会撞 CSP script-src 'self'");
  if (/import\(/.test(code)) die("折叠产物残留 import()，外部动态 import 没能在构建期静止化");
  if (/require\("vue"\)|from"vue"|from "vue"/.test(code)) die("折叠产物残留 vue 裸说明符，alias 没生效");
  if (!code.includes("globalThis.Vue")) die("折叠产物没接上 globalThis.Vue，会出现第二份 Vue");
  if (!code.includes("globalThis.TinyRobot")) die("折叠产物没挂上 globalThis.TinyRobot");

  // CSS 原样拷贝：dist/style.css 自带 :root 上的 513 个 --tr-* 定义，不依赖外部主题包，
  // 零转换零风险。按气泡子集裁剪延后（裁剪会切断选择器依赖，得不偿失）。
  const pkgRoot = dirname(requireFromDesktop.resolve(join(PKG, "package.json")));
  const srcCss = join(pkgRoot, "dist", "style.css");
  if (!existsSync(srcCss)) die(`找不到 ${srcCss}，组件包形态与 0.5.1 预期不符`);
  copyFileSync(srcCss, OUT_CSS);

  console.log(
    `tinyrobot 折叠完成：js=${statSync(OUT_JS).size} 字节、css=${statSync(OUT_CSS).size} 字节 → ${OUT_JS}`
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
```

- [ ] **Step 2: 先给 ui-smoke 加一条加载探针断言（红）**

Modify `apps/desktop/main.cjs`：在 `uiSmoke()` 里 `// 1) 渲染层必须由 Vue 挂出来` 那段**之前**插入：

```js
  // 0) 组件库必须真的被折叠进来：光在 package.json 里写着不算接了组件库。
  //    这条只验「产物加载到了」，渲染语义由后面的气泡断言各自负责。
  const trLoaded = await js("typeof (window.TinyRobot || {}).BubbleList");
  note(trLoaded === "function", `TinyRobot 折叠产物已加载=${trLoaded}`);
```

Run: `cd "D:/Project/sa/saai/sa-code/apps/desktop" && npm run ui-smoke`
Expected: `UI FAIL TinyRobot 折叠产物已加载=undefined`，其余 46 条仍 `UI OK`，`UI_SMOKE FAIL（1 项不符）`，rc=1。
（红的原因必须是脚本还没进加载链，而不是窗口起不来。）

- [ ] **Step 3: 接加载链**

Modify `apps/desktop/renderer/index.html`（整文件替换；顺序纪律：CSS 先库后己，脚本先 Vue、再组件库、再纯函数、再应用）：

```html
<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'; script-src 'self'">
<title>DSH</title>
<link rel="stylesheet" href="vendor/tinyvue.iife.css">
<link rel="stylesheet" href="vendor/tinyrobot.css">
<link rel="stylesheet" href="styles.css">
</head>
<body>
<div id="app"></div>
<script src="vendor/vue.runtime.global.prod.js"></script>
<script src="vendor/tinyvue.iife.js"></script>
<script src="vendor/tinyrobot.iife.js"></script>
<script src="msgfold.js"></script>
<script src="app.js"></script>
</body>
</html>
```

Modify `apps/desktop/package.json` 的 `scripts.vendor`：

```json
    "vendor": "node ../../scripts/pack-vendor.mjs && node ../../scripts/pack-tinyvue.mjs && node ../../scripts/pack-tinyrobot.mjs",
```

- [ ] **Step 4: 跑 vendor，按 markdown-it/dompurify 分叉处置**

Run: `cd "D:/Project/sa/saai/sa-code/apps/desktop" && npm run vendor`
Expected 其一：
- 成功：末行打印 `tinyrobot 折叠完成：js=… 字节、css=… 字节`；或
- esbuild 报 `Could not resolve "markdown-it"`（或 `dompurify`）：这是 §Global Constraints 预判的那条腿，按既定决策装 devDeps 后重跑，**不要**改成 external、也**不要**塞 stub：

```bash
cd "D:/Project/sa/saai/sa-code/apps/desktop" && npm install -D markdown-it dompurify && npm run vendor
```

- [ ] **Step 5: 独立核一遍产物契约（不靠脚本自己的 die）**

Run:

```bash
cd "D:/Project/sa/saai/sa-code/apps/desktop" && node -e "const fs=require('fs');const c=fs.readFileSync('renderer/vendor/tinyrobot.iife.js','utf8');const need=['globalThis.Vue','globalThis.TinyRobot','BubbleList'];const ban=['new Function(','eval(','import(','from \"vue\"'];need.filter(s=>!c.includes(s)).concat(ban.filter(s=>c.includes(s))).forEach(s=>{console.error('契约不符:',s);process.exit(2)});console.log('契约 OK js='+c.length+' css='+fs.statSync('renderer/vendor/tinyrobot.css').size)"
```

Expected: `契约 OK js=<正数> css=<正数>`，rc=0。**rc=0 加空输出不算过**，必须看到 `契约 OK` 那行。

- [ ] **Step 6: 跑 ui-smoke 看那条断言转绿**

Run: `cd "D:/Project/sa/saai/sa-code/apps/desktop" && npm run ui-smoke`
Expected: `UI OK TinyRobot 折叠产物已加载=function`；47 条 `UI OK`、`UI FAIL` 0 条、`UI_SMOKE PASS`、rc=0。
（此时消息区还是旧的 `.msg` 逐行渲染——本任务只把折叠产物接进加载链，没让它上场。）

- [ ] **Step 7: 提交**

```bash
cd "D:/Project/sa/saai/sa-code" && git add scripts/pack-tinyrobot.mjs apps/desktop/renderer/index.html apps/desktop/package.json apps/desktop/package-lock.json apps/desktop/main.cjs && git diff --cached --stat && git commit -m "feat(scripts,desktop): 加 TinyRobot bubble 折叠脚本并接进渲染层加载链"
```

（若 Step 4 装了 markdown-it/dompurify，commit 正文补一行说明：它们只是为把 `Dt()` 的外部动态 import 在构建期静止化，本批不启用 Markdown 渲染路径。）

---

## Task 3: 消息面接 BubbleList（分组 / 自定义文本渲染器 / 角色标签）

**Files:**
- Modify: `apps/desktop/renderer/app.js`
- Modify: `apps/desktop/renderer/styles.css`
- Modify: `apps/desktop/main.cjs`（种子补 `assistant/message`；`.msg` 选择器迁移；新增 8 条断言）

**Interfaces:**
- Consumes: Task 1 的 `window.DshMsgFold.{toBubbleMessages, roleConfigs}`；Task 2 的 `window.TinyRobot.{BubbleProvider, BubbleList}`
- Produces: 消息区 DOM 契约（Task 4/5 与冒烟都依赖）
  - 容器：`#messages`（沿用）→ 库渲染出 `.tr-bubble-list`
  - 每组：`.tr-bubble[data-role=<映射角色>][data-placement=<roleConfigs>]`
  - 每条正文：`<p class="msg-text" data-msg-id="mN" data-source-role="tool/result ok">`（自定义文本渲染器的产物，Task 4 在它上面加折叠属性）
  - 角色标签：`.msg-role` 文本形如 `2 × user`（前缀槽渲染，数字是组内条数、词是映射角色）

- [ ] **Step 1: 写失败断言（冒烟侧先红）**

Modify `apps/desktop/main.cjs`：

(a) `seedIfNeeded` 的种子日志补一条 `assistant/message`。当前 `TurnLoop` 只把回复以 `stream/chunk` 投进 `turn/poll` 帧、**不落 `assistant/message`**，所以助手气泡这条渲染路径要在冒烟里可断言，只能由夹具给一条真实的日志行（改的是夹具，不是 core/host；真模型持久化助手回复属后续批次）：

```js
  if (!existsSync(SESSION_LOG)) {
    writeFileSync(
      SESSION_LOG,
      "0\tturn/start\tt\n1\tsystem/message\tseeded by desktop\n2\tassistant/message\tseeded reply from core\n3\tuser/message\thello from desktop\n"
    );
  }
```

(b) `uiSmoke` 里 `// 1)` 段的消息计数从 `.msg` 迁到 `.tr-bubble`（组数，种子三行消息即三组）：

```js
  // 1) 渲染层必须由 Vue 挂出来，且消息只来自核心投影。
  //    消息面换成 BubbleList 后按「组」计：种子是 system/assistant/user 三个角色，各成一组。
  const mounted = await waitFor(() => count("#messages .tr-bubble").then((n) => n >= 3));
  note(mounted, `Vue 挂载后气泡组数=${await count("#messages .tr-bubble")}（核心投影给出）`);
  const domMsgs = await count("#messages .tr-bubble");
```

(c) `// 3)` 段末尾的「末条消息回显」同样迁移选择器：

```js
  const lastMsg = await js(`(() => { const m = document.querySelectorAll('#messages .tr-bubble'); return m[m.length - 1] ? m[m.length - 1].textContent : ''; })()`);
  note(lastMsg.includes("第一行") && lastMsg.includes("第二行") && lastMsg.includes('"引号"'), `末条消息回显=${JSON.stringify(lastMsg.slice(0, 40))}`);
```

(d) 在 `// 3)` 段之后、`// 3b)` 段之前插入对话面新断言块：

```js
  // 3a) 对话面的四条行为钉子：气泡外框真的出自组件库、角色与定位可断言、
  //     连续同角色合并、被默认链接管不了的角色仍然可见。
  const listNodes = await count("#messages .tr-bubble-list");
  note(listNodes === 1, `BubbleList 容器数=${listNodes}（应为 1）`);
  const bubbleCount = await count("#messages .tr-bubble");
  note(bubbleCount >= 3, `气泡组数=${bubbleCount}（种子 system/assistant/user 三组）`);
  const roleSpread = await js(
    "(() => { const m = document.querySelectorAll('#messages .tr-bubble'); const r = {};" +
    " m.forEach((e) => { const k = e.getAttribute('data-role') || '?'; r[k] = (r[k] || 0) + 1; });" +
    " return JSON.stringify(r); })()"
  );
  note(/"system":1/.test(roleSpread) && /"assistant":1/.test(roleSpread) && /"user":1/.test(roleSpread), `种子角色分布=${roleSpread}`);
  const placementPair = await js(
    "(() => { const q = (r) => { const e = document.querySelector('#messages .tr-bubble[data-role=\"' + r + '\"]');" +
    " return e ? e.getAttribute('data-placement') : 'missing'; };" +
    " return q('user') + '|' + q('assistant') + '|' + q('system'); })()"
  );
  note(placementPair === "end|start|start", `角色定位=${placementPair}（user 在右，其余在左）`);
  const labelShown = await text("#messages .msg-role");
  note(/\d+ × (system|user|assistant|tool)/.test(labelShown), `组标签=${labelShown}`);
  // 连续同角色必须并成一组：再发一条 user，事件 +1 但组数不变。
  const groupsBeforeMerge = await count("#messages .tr-bubble");
  await js(`(() => { const t = document.getElementById('composer'); t.value = ${JSON.stringify("第二条 user 消息")}; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  note(await click("#send"), "已再发一条 user 消息");
  const mergedIntoGroup = await waitFor(async () => (await count("#messages .tr-bubble")) === groupsBeforeMerge);
  note(mergedIntoGroup, `连续 user 合并：组数 ${groupsBeforeMerge} → ${await count("#messages .tr-bubble")}（应不变）`);
  const userGroupNodes = await count('#messages .tr-bubble[data-role="user"] .msg-text');
  note(userGroupNodes >= 2, `user 组内正文条数=${userGroupNodes}（合并后应 ≥ 2）`);
```

(e) 在 `// 6)` 段的只读工具那条断言之后（`note(!(await text("#approval")).includes("工单 #"), ...)` 下面）插入 tool 角色可见性断言：

```js
  // tool/ 行的正文必须真的在气泡里，且原始角色前缀可追问：默认内容渲染器链把 role==="tool"
  // 交给 ToolRole，而 ToolRole 只登记 tool_call_results、渲染注释节点——内容会直接隐身。
  const toolProbe = await js(
    "(() => { const m = document.querySelectorAll('#messages .tr-bubble[data-role=\"tool\"]');" +
    " if (!m.length) return 'no-tool-group';" +
    " const e = m[m.length - 1];" +
    " const src = e.querySelector('.msg-text[data-source-role]');" +
    " return ((e.textContent || '').trim().length > 0 ? 'visible' : 'empty')" +
    " + '|' + (src ? src.getAttribute('data-source-role') : 'no-source-role'); })()"
  );
  note(toolProbe === "visible|tool/call" || /^visible\|tool\//.test(toolProbe), `tool 气泡=${toolProbe}`);
```

- [ ] **Step 2: 跑 ui-smoke 确认红的是「还没接组件库」**

Run: `cd "D:/Project/sa/saai/sa-code/apps/desktop" && npm run ui-smoke`
Expected: `#messages .tr-bubble` 相关断言成批 `UI FAIL`，`UI_SMOKE FAIL（N 项不符）` rc=1；`TinyRobot 折叠产物已加载=function` 这条**仍然是 OK**（证明红因是渲染层还没换，而不是产物没加载）。

- [ ] **Step 3: app.js 接 BubbleList**

Modify `apps/desktop/renderer/app.js`：

(a) 在 TinyVue 守卫之后补 TinyRobot 与 msgfold 守卫（缺产物就把话写在界面上，不悄悄退回自画）：

```js
const TR = window.TinyRobot;
if (!TR || !TR.BubbleList || !TR.BubbleProvider) {
  document.getElementById("app").textContent =
    "缺 vendor/tinyrobot.iife.js：先跑 node scripts/pack-vendor.mjs、node scripts/pack-tinyvue.mjs 与 node scripts/pack-tinyrobot.mjs";
  throw new Error("TinyRobot vendor missing");
}
const FOLD = window.DshMsgFold;
if (!FOLD || typeof FOLD.toBubbleMessages !== "function") {
  document.getElementById("app").textContent = "缺 renderer/msgfold.js";
  throw new Error("msgfold missing");
}
```

(b) 删掉 `splitMsg` 与 `roleClass`（职责已上收到 `msgfold.js`）。

(c) 在 `createApp({` 之前加自定义文本渲染器与匹配项：

```js
// 自定义文本内容渲染器：接管所有 text 内容，含 tool/ 行。
// 非接不可的原因：默认内容渲染器链（dist/index6.js 的 Ke）把 role==="tool" 交给 ToolRole，
// 而 ToolRole 只往 provider store 登记 tool_call_results、渲染一个注释节点——tool 正文会隐身。
// priority 0 与默认链的 NORMAL 并列，但 BubbleProvider 合并时自定义在前、排序稳定，故恒先命中；
// 也顺带压过 ROLE=20 的 ToolRole。
const TextBubble = {
  props: { message: { type: Object, default: () => ({}) }, contentIndex: { type: Number, default: 0 } },
  setup(props) {
    return () => {
      const m = props.message || {};
      const text = typeof m.content === "string" ? m.content : "";
      return h("p", { class: "msg-text", "data-msg-id": m.id || "", "data-source-role": m.sourceRole || "" }, text);
    };
  },
};
const TEXT_MATCH = {
  find: (_message, content) => !!(content && content.type === "text"),
  renderer: window.Vue.markRaw(TextBubble),
  priority: 0,
};
```

(d) `setup()` 里加派生 computed（投影消息 → 气泡消息；**不新增真源**，只是同一份 `proj.messages` 的视图）：

```js
    const bubbleMessages = window.Vue.computed(() => FOLD.toBubbleMessages(proj.value.messages || []));
```

并在 `return { ... }` 的字段表里加上 `bubbleMessages`。

(e) `render()` 里替换消息区。原块：

```js
    const msgs = self.proj.messages.map((line, i) => {
      const m = splitMsg(line);
      return el("div", roleClass(m.role), [el("span", "msg-role", m.role), m.text], { key: i });
    });
```

改为：

```js
    // 分组策略用库内置的 consecutive（连续同角色合并），不自造分组器。
    // 角色标签走 prefix 槽，内容是「组内条数 × 映射角色」——两个数都能从投影数出来，
    // 不是第二真源。autoScroll 关掉：本批不引入滚动语义改动。
    const msgs = [
      h(TR.BubbleProvider, { contentRendererMatches: [TEXT_MATCH] }, () => [
        h(
          TR.BubbleList,
          {
            messages: self.bubbleMessages,
            groupStrategy: "consecutive",
            fallbackRole: "system",
            roleConfigs: FOLD.roleConfigs(),
            autoScroll: false,
          },
          {
            prefix: (slot) => [h("span", { class: "msg-role" }, (slot.messageIndexes || []).length + " × " + (slot.role || "system"))],
          }
        ),
      ]),
    ];
```

- [ ] **Step 4: styles.css 收口**

Modify `apps/desktop/renderer/styles.css`：
- 删 `.msg`、`.msg-user`、`.msg-assistant`、`.msg-system`、`.msg-tool` 五条规则（新 DOM 里不再有这些类，留着就是没人接住的裸奔选择器）；
- **保留** `.msg-role`（角色标签仍在用）；
- `.stream` 容器规则保留；
- 补上新类名的规则（否则 `.msg-text`/`.btn-fold` 又成了写了没接住的裸类）：

```css
/* 自定义文本渲染器的正文节点：msg-text 必须自己接住样式，
   库的 .tr-bubble__text 只服务它自带的 Text 渲染器，管不到这里。
   white-space 保 pre-wrap 是为了投影行里的换行仍然按行显示（多行正文是一条事件）。 */
.msg-text { margin: 0; white-space: pre-wrap; word-break: break-word; }
.btn-fold { margin-left: var(--space-2); }
```

- [ ] **Step 5: 跑 ui-smoke 看绿**

Run: `cd "D:/Project/sa/saai/sa-code/apps/desktop" && npm run ui-smoke`
Expected: Step 1 的 9 条新断言全部 `UI OK`，原有断言无一转红；`UI FAIL` 0 条；`UI OK` 条数应为 47 + 9 = 56；rc=0。

- [ ] **Step 6: 反证「合并」这条断言真的钉住了分组策略（变异一次再还原）**

把 `app.js` 的 `groupStrategy: "consecutive"` 临时改成 `"divider"`，只跑一次：
Run: `cd "D:/Project/sa/saai/sa-code/apps/desktop" && npm run ui-smoke`
Expected: `连续 user 合并` 或 `user 组内正文条数` 至少一条转红。改回 `"consecutive"` 复跑必须回 56 条 `UI OK`、rc=0，并 `git diff -- app.js` 输出为空再往下走。

- [ ] **Step 7: 跑 npm test 确认无回归**

Run: `cd "D:/Project/sa/saai/sa-code/apps/desktop" && npm test`
Expected: PASS，`# pass` 与 Task 1 收尾时一致（本任务不加 node 用例）。

- [ ] **Step 8: 提交**

```bash
cd "D:/Project/sa/saai/sa-code" && git add apps/desktop/renderer/app.js apps/desktop/renderer/styles.css apps/desktop/main.cjs && git diff --cached --stat && git commit -m "feat(desktop): 消息面换 TinyRobot BubbleList，自定义文本渲染器保住 tool 行可见"
```

---

## Task 4: 长消息折叠（默认折叠 + 展开/收起可断言）

**Files:**
- Modify: `apps/desktop/renderer/app.js`
- Modify: `apps/desktop/renderer/styles.css`
- Modify: `apps/desktop/main.cjs`（`uiSmoke` 加折叠腿）

**Interfaces:**
- Consumes: Task 1 的 `FOLD.foldPlan(text, threshold)` 与 `FOLD.FOLD_THRESHOLD`；Task 3 的 `.msg-text[data-msg-id]` DOM 契约
- Produces: DOM 契约
  - 每条正文带 `data-fold-state`：`"plain"`（未超阈值）｜`"folded"`（超阈值且未展开）｜`"expanded"`（超阈值且已展开）
  - 折叠正文带 `[data-fold-toggle="<msgId>"]` 按钮，文案 `展开`／`收起`

- [ ] **Step 1: 写失败断言**

Modify `apps/desktop/main.cjs`：在 Task 3 的 `// 3a)` 块之后（`userGroupNodes` 那条下面）插入：

```js
  // 3c) 长消息折叠：超阈值默认折起来，展开与收起都得有真实状态变化。
  //     正文尾部放一个只在原文里出现的哨兵串，判断「有没有被截掉」就不用比长度。
  const tailMark = "TAIL-SENTINEL-9F2C";
  const longBody = "长".repeat(260) + tailMark;
  await js(`(() => { const t = document.getElementById('composer'); t.value = ${JSON.stringify(longBody)}; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  note(await click("#send"), "已发一条超阈值的长消息");
  const foldedShown = await waitFor(async () => (await count('#messages .msg-text[data-fold-state="folded"]')) > 0);
  note(foldedShown, `长消息默认折叠态节点数=${await count('#messages .msg-text[data-fold-state="folded"]')}`);
  const foldedState = await js(
    "(() => { const n = document.querySelectorAll('#messages .msg-text[data-fold-state]');" +
    " const e = n[n.length - 1]; if (!e) return 'missing';" +
    " return e.getAttribute('data-fold-state') + '|' + ((e.textContent || '').includes('" + tailMark + "') ? 'has-tail' : 'no-tail'); })()"
  );
  note(foldedState === "folded|no-tail", `折叠态读数=${foldedState}`);
  const shortPlain = await js(
    "(() => { const n = document.querySelectorAll('#messages .msg-text[data-fold-state=\"plain\"]');" +
    " return n.length; })()"
  );
  note(Number(shortPlain) >= 3, `短消息保持 plain=${shortPlain}（未超阈值不该出现折叠按钮）`);
  const expandClicked = await js(
    "(() => { const n = document.querySelectorAll('#messages .msg-text[data-fold-state]');" +
    " const e = n[n.length - 1]; if (!e) return 'missing';" +
    " const b = document.querySelector('#messages [data-fold-toggle=\"' + e.getAttribute('data-msg-id') + '\"]');" +
    " if (!b) return 'no-toggle'; b.click(); return b.textContent; })()"
  );
  note(expandClicked === "展开", `展开按钮文案=${expandClicked}`);
  const expandedState = await waitFor(async () => {
    const s = await js(
      "(() => { const n = document.querySelectorAll('#messages .msg-text[data-fold-state]');" +
      " const e = n[n.length - 1]; return e ? e.getAttribute('data-fold-state') + '|' + ((e.textContent || '').includes('" + tailMark + "') ? 'has-tail' : 'no-tail') : 'missing'; })()"
    );
    return s === "expanded|has-tail";
  });
  note(expandedState, `展开态读数=${await js("(() => { const n = document.querySelectorAll('#messages .msg-text[data-fold-state]'); const e = n[n.length-1]; return e ? e.getAttribute('data-fold-state') : 'missing'; })()")}`);
  const collapseBack = await js(
    "(() => { const n = document.querySelectorAll('#messages .msg-text[data-fold-state]');" +
    " const e = n[n.length - 1]; if (!e) return 'missing';" +
    " const b = document.querySelector('#messages [data-fold-toggle=\"' + e.getAttribute('data-msg-id') + '\"]');" +
    " if (!b) return 'no-toggle';" +
    " if (b.textContent !== '收起') return 'wrong-label:' + b.textContent;" +
    " b.click(); return 'ok'; })()"
  );
  note(collapseBack === "ok", `收起按钮=${collapseBack}`);
  const refolded = await waitFor(async () => (await count('#messages .msg-text[data-fold-state="folded"]')) > 0);
  note(refolded, `再点收起后回到折叠态=${await count('#messages .msg-text[data-fold-state="folded"]')}`);
```

Run: `cd "D:/Project/sa/saai/sa-code/apps/desktop" && npm run ui-smoke`
Expected: `长消息默认折叠态节点数=0` 起成批 `UI FAIL`，rc=1（红因：`data-fold-state` 属性还不存在）。

- [ ] **Step 2: 实现折叠**

Modify `apps/desktop/renderer/app.js`：

(a) 在 `TEXT_MATCH` 定义之前加折叠态（视图态，不进日志、不进协议）：

```js
// 折叠态只是视图态：一个消息折没折，既不是会话事实也不该被写进日志。
// 用 reactive 包 Set 是为了 has() 建立依赖、add()/delete() 能触发这条正文重渲染；
// 阈值只有一个出处——FOLD.FOLD_THRESHOLD，组件里不许再出现数字。
const foldOpen = window.Vue.reactive({ ids: new Set() });
```

(b) 把 Task 3 的 `TextBubble` 换成带折叠的版本：

```js
const TextBubble = {
  props: { message: { type: Object, default: () => ({}) }, contentIndex: { type: Number, default: 0 } },
  setup(props) {
    const open = (id) => !!id && foldOpen.ids.has(id);
    return () => {
      const m = props.message || {};
      const text = typeof m.content === "string" ? m.content : "";
      const id = m.id || "";
      const plan = FOLD.foldPlan(text, FOLD.FOLD_THRESHOLD);
      const expanded = open(id);
      const state = plan.folded ? (expanded ? "expanded" : "folded") : "plain";
      const children = [h("p", { class: "msg-text", "data-msg-id": id, "data-source-role": m.sourceRole || "", "data-fold-state": state }, expanded ? text : plan.shown)];
      if (plan.folded) {
        children.push(
          h(
            "button",
            {
              class: "btn btn-fold",
              "data-fold-toggle": id,
              onClick: () => {
                if (foldOpen.ids.has(id)) foldOpen.ids.delete(id);
                else foldOpen.ids.add(id);
              },
            },
            expanded ? "收起" : "展开"
          )
        );
      }
      return h("div", { class: "msg-node" }, children);
    };
  },
};
```

(c) styles.css 补一条新类（否则 `.msg-node` 又是裸奔类）：

```css
/* 折叠态正文的外层节点：正文与「展开/收起」按钮同排，按钮不换行挤走读数。 */
.msg-node { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1); }
```

- [ ] **Step 3: 跑 ui-smoke 看绿**

Run: `cd "D:/Project/sa/saai/sa-code/apps/desktop" && npm run ui-smoke`
Expected: 折叠腿 8 条全部 `UI OK`；`UI FAIL` 0 条；`UI OK` 条数 = 56 + 8 = 64；rc=0。

- [ ] **Step 4: 变异反证（阈值与展开态各一刀，合在一轮编译外跑两次冒烟可接受）**

第 1 刀：把 `msgfold.js` 的 `foldPlan` 条件从 `text.length > threshold` 改成 `text.length >= threshold`（阈值边界那条 node 用例必须转红）：
Run: `cd "D:/Project/sa/saai/sa-code/apps/desktop" && node --test test/msgfold.test.mjs`
Expected: `foldPlan：恰好等于阈值不折叠` FAIL。

第 2 刀：把 `app.js` 里 `expanded ? text : plan.shown` 改成恒 `plan.shown`（展开按钮点了不生效）：
Run: `cd "D:/Project/sa/saai/sa-code/apps/desktop" && npm run ui-smoke`
Expected: `展开态读数` FAIL（哨兵串仍不在 DOM 里）。

两刀各自还原后复跑：`node --test test/msgfold.test.mjs` 8 条全过、`npm run ui-smoke` 64 条 `UI OK` / rc=0，并 `git diff -- apps/desktop/renderer/msgfold.js apps/desktop/renderer/app.js` 为空。

- [ ] **Step 5: 提交**

```bash
cd "D:/Project/sa/saai/sa-code" && git add apps/desktop/renderer/app.js apps/desktop/renderer/styles.css apps/desktop/main.cjs && git diff --cached --stat && git commit -m "feat(desktop): 长消息默认折叠并接展开/收起，折叠态由冒烟钉住"
```

---

## Task 5: `--tr-*` 色值桥接与泄漏探针扩面

**Files:**
- Modify: `apps/desktop/renderer/styles.css`
- Modify: `apps/desktop/main.cjs`（leakProbe 选择器扩面）

**Interfaces:**
- Consumes: Task 3/4 落地的 `.tr-bubble*` DOM
- Produces: 冒烟契约——leakProbe 覆盖 `[class*="tiny-"]` 与 `[class*="tr-bubble"]` 两类元素，越界数为 0

- [ ] **Step 1: 先扩探针，让它红**

Modify `apps/desktop/main.cjs`：把 `// 3b)` 段里 leakProbe 的这行

```js
      const tv = document.querySelectorAll('#app [class*="tiny-"]');
```

改为

```js
      const tv = document.querySelectorAll('#app [class*="tiny-"], #app [class*="tr-bubble"]');
```

并把该条 `note` 的文案改为「组件库（TinyVue + TinyRobot）元素的色值全部来自本仓令牌」，
打印里带上元素数量，方便判断扩面后探针真的覆盖到了新元素：

```js
  note(
    Number(tvCount) > 0 && leakCount === "0",
    `组件库元素的色值全部来自本仓令牌（探到组件库元素 ${tvCount} 个，越界 ${leakCount} 处，首个=${leakFirst || "无"}，accent=${accentResolved}）`
  );
```

Run: `cd "D:/Project/sa/saai/sa-code/apps/desktop" && npm run ui-smoke`
Expected: 该条 `UI FAIL`，`首个=` 里点名越界元素与解析到的字面色（预期是 `.tr-bubble__box` 的 `backgroundColor` = `rgb(38, 38, 38)` 或 `rgb(255, 255, 255)`，来自 `--tr-container-bg-default`）。红因确认是「库自带色板绕过本仓令牌」，不是选择器没命中（`tvCount` 必须比扩面前大）。

- [ ] **Step 2: 按探针点名桥接**

Modify `apps/desktop/renderer/styles.css`，在文件末尾 `--tv-*` 桥接块之后追加：

```css
/* TinyRobot 气泡的色值桥接：库把 --tr-bubble-box-bg 落在自己的 --tr-container-bg-default
   （字面 #262626 / #ffffff），不桥就等于绕开本仓令牌层——判据是冒烟里的 leakProbe，
   删掉下面这段它会把这两枚字面色点出来（与 --tv-* 桥同构的反证）。
   只桥颜色类令牌：布局类（--tr-bubble-gap / --tr-bubble-max-width / --tr-*-radius）
   不携带主题色，桥过去只会打乱库自己的形状语义。
   --tr-bubble-tool-*-color 不桥：那是库的 JSON 工具渲染器的配色，本批不挂那条渲染路径，
   DOM 里根本没有对应元素，桥了是给不存在的场景兜底。 */
:root {
  --tr-bubble-box-bg: var(--surface-2);
  --tr-bubble-text-color: var(--text);
}
```

Run: `cd "D:/Project/sa/saai/sa-code/apps/desktop" && npm run ui-smoke`
Expected: 该条转 `UI OK`。**若 `首个=` 仍点名别的越界项**：按它报出的元素与属性，只在上面这个块里补对应那一枚颜色令牌，改一枚复跑一次；不接受把元素加进白名单、也不接受往 `allowed` 集合里塞字面色。

- [ ] **Step 3: 变异反证桥接不是装饰**

临时删掉 `:root` 里 `--tr-bubble-box-bg: var(--surface-2);` 这一行：
Run: `cd "D:/Project/sa/saai/sa-code/apps/desktop" && npm run ui-smoke`
Expected: leakProbe 该条转红（`越界 ≥ 1`）。还原后复跑必须 `UI FAIL` 0 条、`UI OK` 条数与 Step 2 收尾一致，且 `git diff -- apps/desktop/renderer/styles.css` 只剩本任务应有的新增块。

- [ ] **Step 4: 提交**

```bash
cd "D:/Project/sa/saai/sa-code" && git add apps/desktop/renderer/styles.css apps/desktop/main.cjs && git diff --cached --stat && git commit -m "feat(desktop,scripts): TinyRobot 气泡色值桥回本仓令牌层，泄漏探针扩到 tr-bubble 元素"
```

---

## Task 6: 修 TinyVue 折叠脚本的 CSS 输出契约缺口（前提已被实测证伪，未执行下面的改造）

> **执行时更正（2026-10-03）**：本任务下面描述的「已提交脚本不产出 `tinyvue.iife.css`、
> 干净检出即掉样式」经实测是**错的**：把本机那份 css 移开后重跑 `npm run vendor`，文件以
> 116150 字节重新生成且与原件 `diff` 为空——它是 esbuild 随 `outfile` 自动落下的伴生 CSS。
> 因此**不改 `pack-tinyvue.mjs`**（改了就是给不存在的问题兜底）。本任务真正保留下来的交付物
> 只有下面 Step 4 那条可复现判据，实测结果 `vendor-refs OK 5`、rc=0。
> Step 1/2/3/5 作废，保留原文是为了记下这条怀疑与被证伪的过程。
> 教训：grep 不到文件名不等于没人产出它——伴生产物要看重跑结果，不能只看脚本源码。

**Files:**
- Modify: ~~`scripts/pack-tinyvue.mjs`~~（实测不需要，未改）
- Verify: `apps/desktop/renderer/index.html`（核它的引用都能被 vendor 步骤生成）

**背景（怀疑，非结论）**：`index.html` 引用 `vendor/tinyvue.iife.css`，而 `scripts/pack-tinyvue.mjs`
源码里只写了 `.js`；全仓 grep 不到 `iife.css`。据此怀疑干净检出后 Button 掉样式。
（实测已证伪，见上方更正。）

**Interfaces:**
- Consumes: `@opentiny/vue-theme/base/index.css`（已随 `@opentiny/vue-button` 装进 `node_modules`）
- Produces: `apps/desktop/renderer/vendor/tinyvue.iife.css`（与 `.js` 同为 vendor 步骤产物）

- [ ] **Step 1: 先证「产物不可复现」**

Run:

```bash
cd "D:/Project/sa/saai/sa-code/apps/desktop" && cp renderer/vendor/tinyvue.iife.css /tmp/tinyvue.iife.css.bak && mv renderer/vendor/tinyvue.iife.css /tmp/tinyvue.iife.css.orphan && npm run vendor && ls renderer/vendor
```

Expected: `renderer/vendor/` 里**没有** `tinyvue.iife.css`（只有 `vue.runtime.global.prod.js`、`tinyvue.iife.js`、`tinyrobot.iife.js`、`tinyrobot.css`）——缺口坐实。

- [ ] **Step 2: 给折叠脚本补 CSS 产物**

Modify `scripts/pack-tinyvue.mjs`：

(a) import 行加 `copyFileSync` 不需要，加 `dirname` 已有；把常量区改为：

```js
const OUT = join(DESKTOP, "renderer", "vendor", "tinyvue.iife.js");
// CSS 同样是折叠产物：index.html 一直 link 它。此前只有本机留着一份孤立文件，
// 干净检出跑 npm run vendor 是拿不到它的——现在由这一步负责生成。
const OUT_CSS = join(DESKTOP, "renderer", "vendor", "tinyvue.iife.css");
```

(b) 在临时目录里多写一个 CSS 入口，并追加一次 esbuild 构建（放在 js 构建与自检之后、finally 之前）：

```js
  // 组件样式入口：@opentiny/vue-theme 是 vue-button 的传递依赖，base/index.css 是它的全量基底。
  const cssEntry = join(work, "entry.css");
  writeFileSync(cssEntry, 'import "@opentiny/vue-theme/base/index.css";\n');
  await esbuild.build({
    entryPoints: [cssEntry],
    bundle: true,
    outfile: OUT_CSS,
    logLevel: "warning",
    target: ["chrome120"],
  });
  if (!existsSync(OUT_CSS)) die(`CSS 产物没落盘：${OUT_CSS}`);
```

并把收尾打印改成同时报两个产物体积：

```js
  console.log(
    `tinyvue 折叠完成：${COMPONENTS.length} 个组件（${COMPONENTS.map(([l]) => l).join(", ")}）/ js=${statSync(OUT).size} 字节、css=${statSync(OUT_CSS).size} 字节 → ${OUT}`
  );
```

- [ ] **Step 3: 复跑并与孤立产物对照**

Run:

```bash
cd "D:/Project/sa/saai/sa-code/apps/desktop" && npm run vendor && diff /tmp/tinyvue.iife.css.orphan renderer/vendor/tinyvue.iife.css && echo "CSS-IDENTICAL"
```

Expected 两档之一，都要如实记录，不许含糊：
- 打印 `CSS-IDENTICAL`：最强证据——新产物与此前本机那份逐字节一致，说明界面外观没换来源；
- diff 非空：说明此前那份出自别的入口/版本，此时以 `npm run ui-smoke` 全绿 + `npm test` 全绿 + `--smoke` `SMOKE PASS` 作判据，并在证据文档里写明「css 来源已改为脚本生成，与旧孤立产物有差异（附 diff 摘要）」。**不得**为了让 diff 为空而把旧文件塞回去。

- [ ] **Step 4: 契约自检（把「index.html 引用的 vendor 文件都由 vendor 步骤生成」钉住）**

Run:

```bash
cd "D:/Project/sa/saai/sa-code/apps/desktop" && node -e "const fs=require('fs');const html=fs.readFileSync('renderer/index.html','utf8');const refs=[...html.matchAll(/(?:src|href)=\"([^\"]+)\"/g)].map(m=>m[1]).filter(p=>p.startsWith('vendor/'));const miss=refs.filter(p=>!fs.existsSync('renderer/'+p));console.log(refs.join(' '));if(miss.length){console.error('缺产物:',miss.join(' '));process.exit(2)}console.log('vendor-refs OK',refs.length)"
```

Expected: `vendor-refs OK 5`（`vue.runtime.global.prod.js`、`tinyvue.iife.js`、`tinyvue.iife.css`、`tinyrobot.iife.js`、`tinyrobot.css`）。**关键是 rc=0 并把 5 项全列出来**——`ls` 出一堆文件不等于引用都接得住。

- [ ] **Step 5: 提交**

```bash
cd "D:/Project/sa/saai/sa-code" && git add scripts/pack-tinyvue.mjs && git diff --cached --stat && git commit -m "fix(scripts): TinyVue 折叠脚本补产 tinyvue.iife.css，修干净检出即掉样式"
```

---

## Task 7: 文档与矩阵同步 + dev/打包态全量复验

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/plans/dsh-capability-matrix.md`
- Modify: `docs/evidence/p0-status-2026-10-02.md`

- [ ] **Step 1: AGENTS.md 同步（vendor 三步 + 渲染层描述）**

Modify `AGENTS.md`：
- 「桌面」小节的 `npm run vendor` 那行改为依次跑 `pack-vendor.mjs`、`pack-tinyvue.mjs`（js + css）、`pack-tinyrobot.mjs`（js + css），并保留「`renderer/vendor/` 是构建产物、已 gitignore」；
- `apps/desktop/` 那条模块边界里补一句：消息面经 `BubbleProvider + BubbleList` 渲染，文本内容由本仓自定义内容渲染器出（`tool/` 行靠它保住可见），折叠阈值只在 `renderer/msgfold.js` 一处；
- 「必须知道的约束」里 TinyVue 那条扩成「TinyVue 与 TinyRobot 都是 ESM-only，只能构建期折叠，且 `vue` 必须别名到同一份 vendored runtime」。

- [ ] **Step 2: 能力矩阵 conversation 行 ◐→✔（按表头名取列，别按下标）**

Modify `docs/plans/dsh-capability-matrix.md` 第 73 行。**表头是 `| 模块 | zh | 站点 | 阶段 | 上游已核 | 已复刻 | 备注 |`**——「已复刻」是第 6 列、「上游已核」是第 5 列（全表保持 ☐，不假勾）。改后：

```markdown
| conversation | ✔ | ✔ | M5/M6 | ☐ | ✔ | 切片已收口：`renderer/app.js` 经 `BubbleProvider + BubbleList`（groupStrategy=consecutive）按角色分组，`tool/` 行由自定义内容渲染器保住可见，长正文按 `renderer/msgfold.js` 的单一阈值默认折叠并可展开/收起；`--ui-smoke` 钉住组数、角色分布、placement、合并、折叠三态与 `--tr-*` 色值桥接。**剩余**：助手正文仍只在 `turn/poll` 帧里，未落 `assistant/message`（真 provider 批次）；`上游已核` 仍需读 63 篇原文 |
```

同时把表体计数（✔/◐/☐ 三个数）按改这一行后的实际值更正——先按表头数列名取列统计，再写计数，不许手推。

- [ ] **Step 3: 仓颉侧复跑取证（本批没改 core，但仍要出数）**

```bash
cd "D:/Project/sa/saai/sa-code/core" && cjpm test > /tmp/core-t.log 2>&1; echo "rc=$?"
sed -e 's/\x1b\[[0-9;]*m//g' /tmp/core-t.log | tr '\r' '\n' | grep -A6 "Summary"
```

Expected: rc=0，且剥码后**最后一个** Summary 块 `TOTAL 119 / PASSED 119 / FAILED 0`（与批次前基线一致）。

```bash
cd "D:/Project/sa/saai/sa-code/extjs" && node --test > /tmp/extjs-t.log 2>&1; echo "rc=$?"
sed -e 's/\x1b\[[0-9;]*m//g' /tmp/extjs-t.log | tr '\r' '\n' | grep -E "^# (tests|pass|fail)"
```

Expected: rc=0，`# tests 14`、`# pass 14`、`# fail 0`。

- [ ] **Step 4: 桌面侧全量复跑（dev 态）**

```bash
cd "D:/Project/sa/saai/sa-code" && rm -rf dualtest && cd apps/desktop && npm test > /tmp/dt-t.log 2>&1; echo "npm-test rc=$?"
sed -e 's/\x1b\[[0-9;]*m//g' /tmp/dt-t.log | tr '\r' '\n' | grep -E "^# (tests|pass|fail)"
# 宿主必须重建再重打：桌面结论不能引用上一轮的宿主
cd "D:/Project/sa/saai/sa-code/apps/host" && cjpm build > /tmp/host-b.log 2>&1; echo "host-build rc=$?"; tail -2 /tmp/host-b.log
cd "D:/Project/sa/saai/sa-code" && node scripts/pack-host.mjs apps/host/target/release/bin/main.exe apps/desktop/dist/host \
  "C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx" \
  "D:/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative"
ls -la apps/desktop/dist/host/bin/dsh-host.exe
cd "D:/Project/sa/saai/sa-code/apps/desktop" && npm run smoke > /tmp/smoke.log 2>&1; echo "smoke rc=$?"; tail -3 /tmp/smoke.log
npm run ui-smoke > /tmp/ui.log 2>&1; echo "ui rc=$?"
sed -e 's/\x1b\[[0-9;]*m//g' /tmp/ui.log | grep -c "^UI OK"
sed -e 's/\x1b\[[0-9;]*m//g' /tmp/ui.log | grep -c "^UI FAIL"
```

Expected: `npm test` rc=0 且 `# fail 0`（总数 ≥ 基线 + 8）；`host-build rc=0` 且日志含 `cjpm build success`；`pack-host` 打印 `host 打包完成：89 个文件`（stdx 动态目录与 `CANGJIE_HOME/runtime/lib/windows_x86_64_cjnative` 各出一批 DLL，exe 与 DLL 同目录、不拼 PATH）；`bin/dsh-host.exe` 的 mtime 晚于本轮开始（**宿主没重打就不许引用上一轮的桌面结论**）；`SMOKE PASS`；`ui rc=0`、`UI OK` 计数 = Task 5 收尾计数、`UI FAIL` 计数 = 0。

- [ ] **Step 5: 打包态复验（win-unpacked 的 exe，rc=0 + 空输出不算过）**

```bash
cd "D:/Project/sa/saai/sa-code/apps/desktop" && npx electron-builder --config.electronDist=node_modules/electron/dist > /tmp/eb.log 2>&1; echo "builder rc=$?"
ls -la dist/electron/win-unpacked/"DSH Desktop.exe"
```

Expected: rc=0，且 `win-unpacked/DSH Desktop.exe` 的 mtime 晚于本轮开始（**用 mtime/体积判「是不是新产物」，别把旧产物的断言当新证据**）。然后从打包产物跑：

```bash
cd "D:/Project/sa/saai/sa-code/apps/desktop/dist/electron/win-unpacked" && ./"DSH Desktop.exe" --ui-smoke --session-dir="$(cygpath -w "$TEMP/dsh-pkg-ui-$$")" > /tmp/pkg-ui.log 2>&1; echo "pkg rc=$?"
sed -e 's/\x1b\[[0-9;]*m//g' /tmp/pkg-ui.log | grep -c "^UI OK"
sed -e 's/\x1b\[[0-9;]*m//g' /tmp/pkg-ui.log | grep -c "^UI FAIL"
```

Expected: `pkg rc=0`、`UI OK` ≥ dev 态计数、`UI FAIL` = 0。任一不符按 FAIL 记，不许以「打包态环境差异」收尾。

- [ ] **Step 6: 签名现状如实记录**

```bash
cd "D:/Project/sa/saai/sa-code/apps/desktop" && powershell -NoProfile -Command "Get-AuthenticodeSignature dist/electron/dsh-desktop-portable.exe, 'dist/electron/DSH Desktop Setup 0.1.0.exe' | Select-Object Status, SignerCertificate | Format-Table -AutoSize"
```

Expected: 仍 `NotSigned`（本机无证书）。这条写进证据文档时按「未签名（本机无证书，签名与发布待授权）」，不写成已通过。

- [ ] **Step 7: 证据文档追记**

Modify `docs/evidence/p0-status-2026-10-02.md`：在「最新 R0 收口」段之后追加一节「对话面接入 TinyRobot（2026-10-03）」，逐条写明：
- 本批改动面（`scripts/pack-tinyrobot.mjs`、`renderer/msgfold.js`、`renderer/app.js`、`styles.css`、`index.html`、`main.cjs`、`pack-tinyvue.mjs` 补 CSS 产物）；
- 实测计数：core `cjpm test` 119/119、extjs 14/14、桌面 `npm test` <Step4 实数>、`--smoke` PASS、dev `--ui-smoke` <UI OK 数>、打包态 `--ui-smoke` <UI OK 数>；
- 变异反证做了哪几刀（divider 替换 consecutive、阈值边界、展开态置空、`--tr-bubble-box-bg` 桥删除）及各自转红的用例名；
- 剩余限制：助手正文仍不落 `assistant/message`（冒烟里的 assistant 组出自种子夹具）、Markdown 渲染路径未启用、Next SDK 页面工具与签名/npm publish 仍属未做/待授权；
- 不写任何「像素级复刻上游」的声称。

- [ ] **Step 8: 提交**

```bash
cd "D:/Project/sa/saai/sa-code" && git add AGENTS.md docs/plans/dsh-capability-matrix.md docs/evidence/p0-status-2026-10-02.md && git diff --cached --stat && git commit -m "docs(desktop): 对话面接入 TinyRobot 收口矩阵与复验证据"
```

---

## 完成判据（逐条要有输出凭据）

1. `msgfold.test.mjs` 8 条用例先红（ENOENT）后绿；
2. 桌面 `npm test` rc=0、`# fail 0`，`# tests` 比批次前多 8；
3. `npm run ui-smoke` dev 态：`UI OK` 从 51 增至 ≥ 64，`UI FAIL` = 0，rc=0；
   （**计数更正**：本计划起草时引用的 46 是**打包态**计数，dev 态基线实测为 51；
   实际落地为 Task 2 后 52、Task 3 后 60、Task 4 后 67、Task 5 后仍 67（探针是扩面不是加条）。）
4. 打包态 `win-unpacked` exe：`UI OK` ≥ dev 计数、`UI FAIL` = 0、rc=0，产物 mtime 为新；
5. `npm run smoke` `SMOKE PASS`；core 119/119、extjs 14/14 复核不变；
6. 四刀变异反证各自转红并还原回绿，`git diff` 为空；
7. `index.html` 引用的每个 `vendor/` 文件都由 `npm run vendor` 生成（Step 4 契约自检 rc=0）；
8. 矩阵 `conversation` 行「已复刻」✔、「上游已核」仍 ☐；证据文档写明计数与剩余限制；
9. `preload.cjs` 与 `bridge.test.mjs` 未被本批改动（IPC 面 11 键不变）——`git diff --stat` 里不该出现它们。

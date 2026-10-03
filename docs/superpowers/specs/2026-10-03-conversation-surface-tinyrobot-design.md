# 对话面升级：TinyRobot 消息组件接入设计

- 日期：2026-10-03
- 目标矩阵行：`conversation`（当前 ◐，本批冲 ✔）
- 关联验收口径：`docs/plans/plan-deepseek-harness-replication.md` §6.1.3（按上游一等公民面复刻桌面 UI）
- 本批不动：`apps/host`、`core`、`apps/cli`、`extjs`、IPC 通道集合（恰好 11 键不变）

---

## 1. 背景与目标

### 1.1 现状（已核实的缺口）

`apps/desktop/renderer/app.js` 的消息面是「按行拆文本」：`session/projection` 回来的每条
`"role: 正文"` 渲染成一个 `.msg` div（`roleClass()` 三分类）。对照 §6.1.3 的
「Main · conversation」面，缺三样：

1. **消息节点**：没有气泡容器，用户轮与助手轮在视觉上不可分辨（只有底色差异）；
2. **分组**：连续同角色消息一条一框，长会话刷屏；
3. **长消息折叠**：长正文把整列顶翻，没有「默认折叠 + 展开」；
4. **对应用例**：上述行为一条断言都没有。

### 1.2 本批目标

把消息面接到 **TinyRobot 的 Bubble 组件族**（`@opentiny/tiny-robot` 0.5.1，已获授权安装在
`apps/desktop` devDependencies），并在 `--ui-smoke` 里补上可断言的行为钉子。交付后：

- 消息以「组」为单位渲染成气泡（连续同角色合并），角色、定位可断言；
- 超长正文默认折叠，折叠态与展开态各自可断言；
- 组件的色值走本仓令牌层（与 TinyVue 同一套桥接纪律）；
- `--ui-smoke` 的 `UI OK` 条数只增不减（现有 46 条断言语义保留、选择器按新 DOM 重指向，一条不删）。

### 1.3 明确不做（非目标）

- **不接 Next SDK 页面工具**：那是新外部工具调用通道，独立批次，且必须另行过审批不变量；
- **不接 TinyRobot 的 sender / conversations / welcome 等其余组件**：本批只折叠 `bubble` 一族。
  `sender-compat` 拖 tiptap/ProseMirror（>500KB），与现有 composer 无关，YAGNI；
- **不宣称像素级复刻上游 UI**：依据 §6.1.3，本仓没有上游设计稿/令牌表/截图，只验收行为等价；
- **不改协议与会话日志**：投影帧、事件类型、IPC 11 键全部原样。

---

## 2. 上游组件契约（2026-10-03 读 `dist/` 核实，作为实现事实基础）

以下全部来自本机 `apps/desktop/node_modules/@opentiny/tiny-robot@0.5.1` 的
`dist/index.d.ts` 与 `dist/index6.js` 原文，不是文档站摘要：

| 事实 | 出处 |
| --- | --- |
| `bubble/index.js` 导出 `Bubble / BubbleList / BubbleProvider / BubbleRenderers / BubbleRendererMatchPriority` 与一组 composable | `dist/bubble/index.js` |
| `BubbleList` 的 `groupStrategy` 支持 `'consecutive'`（连续同角色合并）、`'divider'`（按分割角色分组）或自定义函数 | `dist/index.d.ts` BubbleListProps |
| `BubbleMessage = { role?, content, reasoning_content?, tool_calls?, tool_call_id?, name?, id?, loading?, state? }`；`ChatMessageContent = string \| ChatMessageContentItem[]` | `dist/index.d.ts` |
| `Bubble` 根元素是 `<div class="tr-bubble" data-role data-placement>`，内含 `tr-bubble__body / __content / __box / __avatar / __after` | `dist/index6.js` Bubble setup |
| 默认内容渲染器链（`Ke`）：loading→Loading、reasoning→Reasoning、tool_calls→Tools、image→Image、**`role === "tool"`→ToolRole（只登记 tool_call_results，渲染注释节点，即内容不可见）** | `dist/index6.js` Ke 数组 |
| `BubbleProvider` 提供 `contentRendererMatches` 注入点：自定义匹配器与默认链合并后按 priority 升序匹配（数字越小越优先；`LOADING=-1, NORMAL=0, CONTENT=10, ROLE=20`） | `dist/index.d.ts` BubbleProviderProps / index6.js `de` |
| 组件的 CSS 是 **CSS Modules + scoped**：类名如 `tr-bubble__avatar` 映射到 `_tr-bubble__avatar_1r87c_2`，scopeId 如 `data-v-d68ceaad`；`__cssModules`/`__scopeId` 在产物里是静态对象 | `dist/index6.js` Wt/Jt 段、`dist/style.css` |
| `dist/style.css` 自带 513 个 `--tr-*` 自定义属性定义（`:root`），不依赖外部主题包 | `dist/style.css` |
| `Bubble` 的 Markdown 渲染路径 `import("markdown-it")` / `import("dompurify")` 是**外部包动态 import**，失败时 catch 后 console.warn 并回落 Text 渲染器 | `dist/index6.js` `Dt()` |
| `bubble` 的运行时依赖只有 `vue` 与 `@opentiny/tiny-robot-svgs`（后者零依赖、只 import vue），**不 import `@opentiny/vue`** | `dist/index6.js` 顶部 import、svgs 包 manifest |

关键推论（设计约束，不是愿望）：

- **折叠时 `vue` 必须别名到 `globalThis.Vue`**（同 `pack-tinyvue.mjs` 的机制），否则出现第二份 Vue，
  组件响应式与应用不同一套（表现为「气泡不更新」）；
- CSP `script-src 'self'` + `file://` 下，运行时的动态 `import()` 必然失败；Markdown 路径的
  失败回落正好落在 Text 渲染器上，但**产物里不允许残留 `import(`**——见 §4.1 的自检；
- `role: "tool"` 的消息会被默认链交给「什么都不渲染」的 ToolRole——我们的消息面必须用自己的
  文本内容渲染器接管（§4.3），否则 tool/result 行会在气泡里消失。

---

## 3. 数据通道不变量（本批的验收底线）

这些是复刻方案里的既有不变量，本批只在其上叠视图，不许有任何一条被稀释：

1. 消息唯一真源仍是 `session.log`；界面数据仍只来自 `session/projection` 与 `turn/poll`。
   分组、折叠**只是投影之上的视图派生**：不写日志、不发协议帧、不新增 IPC 通道；
2. 界面上出现的每个数字/状态都能在 `session.log` 或协议应答里找到出处（§6.1.3 增量口径）；
3. 审批仍只走 `approval/ask → approval/answer → extension/call{approvalId}`；本批不碰；
4. 计量读数仍只来自 `usage/status` 与 `turn/poll` 结算帧；本批不碰；
5. 每条新行为配一条 `--ui-smoke` 断言，`UI OK` 只增不减；
6. 运行时不引 npm 依赖：新产物仍是「经典脚本 + 静态 CSS」，经 CSP 自检。

---

## 4. 设计

### 4.1 折叠脚本 `scripts/pack-tinyrobot.mjs`（新增）

照 `scripts/pack-tinyvue.mjs` 的机制与自检风格写，落点
`apps/desktop/renderer/vendor/tinyrobot.iife.js`：

- **入口**：临时目录里生成 `import { Bubble, BubbleList, BubbleProvider } from "@opentiny/tiny-robot/dist/bubble/index.js";
  globalThis.TinyRobot = { Bubble, BubbleList, BubbleProvider };`，esbuild `bundle + iife`；
- **别名**：`vue` → `module.exports = globalThis.Vue` 的 shim（与 TinyVue 折叠同一手段）；
- **依赖解析按 `apps/desktop` 视角**（`createRequire(join(DESKTOP, "package.json"))`），
  入口必须落在 `apps/desktop` 下（esbuild 按 entry 向上找 node_modules，实测放系统临时目录解析不到）；
- **markdown-it / dompurify 的处置（决策已定，不再提问）**：`Dt()` 对它们是外部动态 import。
  若 esbuild 构建期解析失败，就把 `markdown-it`、`dompurify` 装成 `apps/desktop` 的
  devDependencies 重新折叠——**让动态 import 在构建期静止化，产物零运行时模块加载**。
  二者都只是被折叠进产物、本批不启用 Markdown 渲染路径（不在默认 `Ke` 链里），装上只为消除
  「构建期外部说明符 / 运行时分叉」，不为功能；体积代价一次性计入产物并打印；
- **CSP 反证自检**（产物不过就 `die`，与 pack-tinyvue 同级）：
  1. 无 `new Function(`、无 `eval(`；
  2. 无 `import(`（证明 markdown 懒加载已静止化）；
  3. 无 `from"vue"` / `require("vue")` 裸说明符残留（证明别名生效）；
  4. 含 `globalThis.Vue` 桥接代码（证明没有第二份 Vue）；
- **CSS**：`@opentiny/tiny-robot/dist/style.css` 原样拷贝为 `renderer/vendor/tinyrobot.css`
  （静态文件、149KB、自带全部 `--tr-*` 定义，零转换零风险；按气泡裁剪延后，记 follow-up）；

### 4.2 `renderer/index.html` 与 vendor 步骤

```html
<link rel="stylesheet" href="vendor/tinyvue.iife.css">
<link rel="stylesheet" href="vendor/tinyrobot.css">
<link rel="stylesheet" href="styles.css">
...
<script src="vendor/vue.runtime.global.prod.js"></script>
<script src="vendor/tinyvue.iife.js"></script>
<script src="vendor/tinyrobot.iife.js"></script>
<script src="renderer/msgfold.js"></script>
<script src="app.js"></script>
```

顺序纪律：CSS 先库后己（`styles.css` 的 `:root` 覆写要靠「后者胜」压过库令牌）；脚本先 Vue、
再组件库、再纯函数、再应用。`package.json` 的 `vendor` 脚本从两步变三步：

```
node ../../scripts/pack-vendor.mjs && node ../../scripts/pack-tinyvue.mjs && node ../../scripts/pack-tinyrobot.mjs
```

**曾怀疑的输出契约缺口——已被实测证伪（记录在此免得下次重新怀疑一遍）**：本仓一度认为
`index.html` 引用的 `vendor/tinyvue.iife.css` 没有任何已提交脚本产出（`pack-tinyvue.mjs` 全文
只写了 `.js`，且全仓 grep 不到 `iife.css` 字样）。实测结论相反：把本机那份移开、重跑
`npm run vendor`，该文件会以 116150 字节重新出现，且与原文件 `diff` 为空——它是 esbuild 在
`outfile` 同名位置自动落下的伴生 CSS（组件的样式经 `sideEffects` 链引入，`lib/index.js` 里
grep 不到 `import "*.css"` 字样，所以静态读码看不出来）。**因此本批不改 `pack-tinyvue.mjs`**。
保留下来的只有一条可复现判据：`index.html` 里每个 `vendor/` 引用都必须由 vendor 步骤生成
（实测 `vendor-refs OK 5`，rc=0）。教训：grep 不到文件名不等于没人产出它。

### 4.3 渲染层

#### 4.3.1 纯派生层 `renderer/msgfold.js`（新增，经典脚本）

只放纯函数，挂 `window.DshMsgFold`，不碰 Vue、不碰 DOM：

- `toBubbleMessages(lines)`：投影行数组 → `BubbleMessage[]`。角色映射表（**唯一映射点**）：

  | 投影行前缀 | Bubble role | placement |
  | --- | --- | --- |
  | `user/` | `user` | `end` |
  | `assistant/` | `assistant` | `start` |
  | `tool/` | `tool` | `start` |
  | 其它（`system/`、`turn/`…） | `system` | `start` |

  每条消息带 `id: "m" + 序号`（序号 = 投影位次，追加-only 所以稳定）；`content` 取正文；
  `state.sourceRole` 保留原始角色串（界面要显示原始角色标签时用它，不让 `data-role` 说谎——
  `tool/` 行的 `data-role` 就是 `tool`，内容可见性由 §4.3.3 的自定义渲染器保证）。

- `foldPlan(text, threshold)`：`{ folded, shown }`。`text.length > threshold` 时
  `folded=true`、`shown` 为前 `threshold` 个字符 + `…`；否则 `folded=false`、`shown=text`。
  阈值常量集中一处（初定 240，按界面实测调，只此一处）。
- `foldState` 不放在这里（见 §4.3.3），本文件保持无状态纯函数。

Node 单测 `apps/desktop/test/msgfold.test.mjs`：读源码、以最小 `window` 存根求值后断言边界
（恰好等于阈值不折叠、空串、无空格长串、多行、CRLF 不劈行、角色映射逐行覆盖）。走 node:test，
计入 `npm test` 总数。

#### 4.3.2 `renderer/app.js`（改）

- 消息区从「逐行 div」换成：

  ```js
  h(TinyRobot.BubbleProvider, { contentRendererMatches: [textMatch] }, () =>
    h(TinyRobot.BubbleList, {
      messages: bubbleMessages,          // proj.messages → toBubbleMessages 的 computed
      groupStrategy: "consecutive",      // 用库内置策略，不自己写分组
      fallbackRole: "system",
      roleConfigs: ROLE_CONFIGS,         // user→end、其余→start
      autoScroll: false,                 // 本批不引入自动滚动
    })
  )
  ```

  外包 `el("div", "stream", [...], { id: "messages" })` 保住现有选择器与样式钩子；
- 角色标签：每组用 `BubbleList` 的 `prefix` 槽渲染 `msg-role`（原始角色串 + 组内条数），
  **不新增第二真源**——它只是 `messageIndexes.length` 与 `state.sourceRole` 的复述；
- 流式盒（`#stream`）原样不动：流式期间投影未变，气泡区与流式盒并存，语义不变。

#### 4.3.3 自定义文本内容渲染器（`app.js` 内）

一个 Vue 组件对象，props `['message', 'contentIndex']`，经 `BubbleProvider.contentRendererMatches`
注入：`{ find: (m, c) => (c && c.type) === "text", renderer: TextBubble, priority: 0 }`
（priority 0 = NORMAL，与默认链并列时因「自定义在前」稳定抢先；同时天然压过 ROLE=20 的
ToolRole，让 `tool/` 行的文本重新可见）。

渲染内容：

```js
h("p", { class: "msg-text", "data-msg-id": m.id, "data-fold-state": folded ? "folded" : "expanded" }, shown)
// folded 时附带：
h("button", { class: "btn btn-fold", "data-fold-toggle": m.id, onClick: toggle }, "展开")
// expanded 且曾折叠时附带「收起」
```

- 折叠态存根：模块级 `const fold = reactive({ open: new Set() })`（Vue 3 对 reactive Set 的
  `has/add` 有依赖追踪）；按钮点击只改这个 Set，**不碰投影、不重发消息**；
- 收起也要有（`data-fold-toggle` 的按钮文案随状态翻），否则「只能展不能收」是个半成品；
- 阈值与截断全部走 `msgfold.js` 的 `foldPlan`，组件里不出现第二个阈值。

### 4.4 样式与令牌桥接

- 删 `styles.css` 里随 DOM 一起死的 `.msg-user/.msg-assistant/.msg-system/.msg-tool/.msg-role`
  规则（`css-class-coverage-check` 的纪律：不留没人接住的类）；
- **`--tr-*` 桥接**： TinyRobot 的气泡文字/背景/边框色必须像 `--tv-*` 一样接到本仓令牌层。
  在 `styles.css` 末尾加一段 `:root` 覆写（与 `--tv-*` 桥同址同风格），只桥气泡实际用到的
  颜色类令牌；布局类令牌（gap/width/radius）保留库原值并在注释里写明为什么不桥；
- 现有 `leakProbe` 的选择器从 `#app [class*="tiny-"]` 扩成 `#app [class*="tiny-"], #app [class*="tr-bubble"]`，
  即**新组件也受同一条色值纪律约束**；允许集仍是那 11 枚本仓令牌 + 透明。

### 4.5 文档

- `AGENTS.md`：vendor 步骤改三步 + 两种折叠产物（js/css）；渲染层描述补「消息面经
  TinyRobot BubbleList 渲染，vue 双别名」；
- `docs/plans/dsh-capability-matrix.md`：`conversation` 行「已复刻」列 ◐→✔（按 §6.1.2
  表体行号核对后再改；「上游已核」列保持 ☐ 不假勾——它只能由读上游原文补）；
- `docs/evidence/`：追加本批实测计数（dev 与打包态两套）。

---

## 5. 验收增量（`--ui-smoke` 新增断言，逐条可判）

现有断言的选择器迁移（**条数不减、语义不减**）：

| 现有断言 | 新选择器 | 说明 |
| --- | --- | --- |
| `#messages .msg` 条数 ≥ 2 | `#messages .tr-bubble` 组数 ≥ 2 | 种子态 3 条消息（turn/start、system、user）→ 3 组 |
| 末条消息回显含首/次行与引号 | 最后一个 `.tr-bubble` 的 textContent | 连续两条 user 合并成一组，关键字仍在 |

新增（每条都是「界面读数 ⇄ 日志/协议」可对照的）：

1. **气泡外框来自组件库**：`#messages .tr-bubble-list` 存在，且 `.tr-bubble` 组数等于
   `msgfold` 口径的期望组数（关系式，不写死绝对值）；
2. **角色与定位可断言**：完整一轮后 `[data-role="user"]`、`[data-role="system"]` 各 ≥ 1，
   `[data-role="tool"]` ≥ 1（工具腿跑过之后），user 组 `data-placement="end"`、其余 `start`。
   `assistant` 组：当前 `TurnLoop`（`core/src/cancel.cj`）只把回复以 `stream/chunk` 投到
   `turn/poll` 帧，**不落 `assistant/message` 进会话日志**——所以冒烟夹具 `seedIfNeeded` 里
   补一条 `assistant/message` 行，让助手气泡的渲染路径在冒烟里可断言（这条夹具改动只动
   `apps/desktop/main.cjs`，不碰 core/host；真模型持久化助手回复是独立后续批次）。
   断言：`[data-role="assistant"]` ≥ 1（来自夹具那条），且 `data-placement="start"`；
3. **合并语义**：连发两条 user 消息，`.tr-bubble` 组数不变（合并），组内 `data-msg-*` 条数为 2；
4. **长消息折叠**：经 composer 发一条超阈值正文 → 初始 `[data-fold-state="folded"]`、正文不含
   尾部标记字样、按钮文案「展开」；点 `[data-fold-toggle]` 后 `expanded`、全文在 DOM 里、
   按钮变「收起」；再点回 folded（收得回去）；
5. **色值纪律扩到新组件**：扩展后的 leakProbe 判据（tiny + tr-bubble 元素全部落在本仓令牌集）；
6. **原始角色可追问**：每条正文节点带 `data-source-role`，值就是投影行 `:` 之前的原始前缀
   （组标签只报「条数 × 映射角色」，因为一个组可能同时含 `tool/call` 与 `tool/result` 两种来源，
   给组挂单一原始串会造假）。冒烟断言：tool 组内至少一条正文的 `data-source-role` 以 `tool/` 开头，
   且该气泡正文非空（证明默认链的 ToolRole 隐身路径已被接管）。

`UI OK` 条数只增不减（现为 46，每条新增断言至少落 1 条 note，折叠腿的「展→收→回」各算 1 条）；
`UI FAIL` 必须为 0；rc=0。dev 态与打包态（win-unpacked exe）各跑一遍并记录计数。

---

## 6. 风险与回退

| 风险 | 处置 |
| --- | --- |
| esbuild 解析不到 `markdown-it`/`dompurify` | §4.1 决策：装 devDeps 重新折叠；仍失败则本批先只折叠到「能过 CSP 自检」为止并如实记 BLOCKED，**不静默删断言** |
| BubbleList 无 Provider 时行为与读码推断不符 | 计划第一步就是真窗口渲染探针：先让 3 条种子消息以最小配置渲染出来并打印组数/角色，再往上叠 |
| 反应式不连通（折叠点了没反应） | reactive Set 依赖追踪；冒烟里「点了必须翻态」正是钉这条的，红了就地修，不用轮询 sleep 糊 |
| 打包态体积 | 新增产物一次性计入；ui-smoke 打包态复验时记录 exe/vendor 体积变化 |
| `--tr-*` 令牌桥接调不通 | leakProbe 会红；按探针输出逐个桥，桥不动的（布局类）写进注释与白名单理由，不悄悄放行 |

## 7. 完成判据（本批 exit criteria）

1. `cd apps/desktop && npm test` 全绿且用例数只增（含新增 `msgfold.test.mjs`）；
2. `npm run ui-smoke`：`UI OK ≥ 46 + 6 条新增`、`UI FAIL = 0`、rc=0；dev 态与打包态各一份记录；
3. `npm run smoke` 仍 `SMOKE PASS`（IPC 面没动，但跑过才算数）；
4. `cd core && cjpm test` 119/119 不受影响（本批不碰 core，仍复跑取证）；
5. 矩阵 `conversation` 行、`AGENTS.md`、证据文档同步落地；
6. 干净检出可复现：`rm -rf renderer/vendor && npm run vendor` 后 `index.html` 引用的每个文件都在。

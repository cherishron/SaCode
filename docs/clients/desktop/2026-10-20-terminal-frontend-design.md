# F09 终端交互前端页面设计

日期：2026-10-20
范围：纯设计文档。不写渲染层源码，不碰构建脚本，不修改 preload/main。
依据：`docs/plans/2026-10-20-terminal-interactive-design.md`（F09 后端设计）、现有 `terminal-output.ts` / `terminal-output-state.ts` 代码盘点。

---

## 0. 设计目标

在桌面渲染层提供一个**真 PTY 交互终端**页面，让开发者可以：

- 在 xterm.js 渲染的终端面板里直接键入命令、看到实时输出
- resize 终端并通知 Host 调整 ConPTY/PTY winsize
- 点中断按钮向进程组发 Ctrl+C
- 查看进程退出码、cwd、running 状态
- 多实例：每个终端标签独立 terminalId
- 从会话日志回放历史终端输出（复用现有 `terminalOutput` 通道）

**非目标：** 不设计 Host/core 侧 PTY 实现（已在后端设计文档覆盖）；不设计 CLI 终端；不设计 ACP Agent 终端。

---

## 1. 现状盘点

### 1.1 terminal-output.ts（只读回放）

| 维度 | 现状 |
|------|------|
| 组件名 | `SaCodeTerminalOutput` |
| 数据源 | `sacode.terminalOutput(sessionId, cursor, 16)` — 只读分页 |
| 状态管理 | `terminal-output-state.ts`：分页校验、128 条缓存、8KiB 截断 |
| 渲染 | `<pre>` 列表 + `<details>` 折叠，无 VT 解析 |
| 嵌入 | 内嵌 `ExecutionTask` 组件（提案→审批→启动→读 stdout/stderr） |
| 输入 | **无** — stdin 丢弃 |
| resize | **无** |
| 中断 | **无** |
| 实时流 | **无** — 只有落盘快照分页 |
| 文案 | 已写明「交互 PTY 与实时流尚未接入」 |

### 1.2 preload.cjs 通道

```js
terminalOutput: (sessionId, cursor, limit) => ipcRenderer.invoke("sacode:terminalOutput", { sessionId, cursor, limit })
```

仅此一个 terminal 通道。后端设计文档要求新增 `terminal/create|input|resize|interrupt|describe|output|close|kill` 共 8 个方法。

### 1.3 工作台标签注册

`workbench-tabs.ts`:
```js
{id:'terminal', label:'终端', icon:'M4 5l6 7-6 7M13 19h7', available:true}
```

`app.js` 第 1080 行接线，传入 `executionApi`、`sessionId`、`active`、`read` 四个 prop。

### 1.4 CSP 约束

`index.html`:
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'">
```

- **禁止** `unsafe-eval`、`new Function`、运行时 ES module 加载
- 第三方库（TinyVue、TinyRobot）已在构建期用 esbuild 折叠成经典 IIFE 脚本放进 `renderer/vendor/`
- `renderer-bundle-guard.mjs` 验证产物无 `eval`、无 `new Function`、无残留 `import()`
- xterm.js 是 ESM 包，**必须**用同样的构建期折叠方案

### 1.5 vendor 折叠模式（参考 pack-tinyrobot.mjs）

```
npm install @xterm/xterm @xterm/addon-fit   # devDependency
node scripts/pack-xterm.mjs                  # 构建期折叠
  → renderer/vendor/xterm.iife.js            # 经典脚本
  → renderer/vendor/xterm.css                # 样式
```

关键约束：
- `vue` alias 到 `globalThis.Vue` shim（避免双 Vue 实例）
- 产物过 `assertStaticRendererBundle` 检查
- 运行时通过 `globalThis.Xterm` 暴露 API（类似 `globalThis.Vue`）

---

## 2. 与 terminal-output.ts 的关系：并存 + 子标签切换

### 2.1 方案：同一「终端」标签下两个子视图

```
工作台「终端」标签
├── 子标签：交互终端（默认，新组件 terminal-interactive.ts）
└── 子标签：历史回放（现有 terminal-output.ts，原样保留）
```

**理由：**

- 后端设计文档 §2 明确三车道：历史回放（`session/terminal-output`）、一次性执行（`execution/*`）、交互终端（`terminal/*`）。三者数据源不同、生命周期不同，不能混同。
- `terminal-output.ts` 的只读回放能力仍有价值：查看已落盘的执行输出、恢复页面不运行命令。保留不动。
- 交互终端是新增能力，不应破坏现有只读回放测试（`terminal-output.test.mjs` 等）。
- 子标签切换复用现有 `msgfold.js` 折叠阈值模式，不新增工作台顶级标签。

### 2.2 切换实现

在 `terminal-output.ts` 的渲染区域顶部加一行子标签切换条（类似 git-workbench 的分组标题栏）：

```
[交互终端] [历史回放]
```

- 默认展示「交互终端」子视图
- 「历史回放」子视图渲染现有 `terminal-output.ts` 的全部内容
- 子标签状态是组件内 `ref<'interactive'|'history'>`，不持久化

### 2.3 不选「替换」的理由

- 替换会破坏现有 `terminal-output.test.mjs` 和 preload 专项测试
- 只读回放是断连恢复时的唯一终端视图（后端设计文档 §3.2：「重启 Host 不接管旧 PID，UI 开新实例」）
- 一次性执行（`ExecutionTask`）仍嵌入在 `terminal-output.ts` 中，替换会丢失这个入口

---

## 3. 组件架构

### 3.1 文件清单

| 文件 | 职责 |
|------|------|
| `renderer/pages/terminal-interactive.ts` | 交互终端 Vue 组件（`defineComponent` + `h()` 渲染） |
| `renderer/pages/terminal-interactive-state.ts` | PTY 状态机：terminalId、phase、ring、cursor、exit 事实 |
| `scripts/pack-xterm.mjs` | 构建期折叠 xterm.js + addon-fit → `renderer/vendor/xterm.iife.js` |
| `renderer/vendor/xterm.iife.js` | **构建产物**（gitignore），运行时经典脚本 |
| `renderer/vendor/xterm.css` | **构建产物**（gitignore），xterm 样式 |

### 3.2 组件 props

```typescript
defineComponent({
  props: {
    active: Boolean,           // 标签是否激活
    sessionId: String,         // 当前会话 ID
    directory: String,         // 工作区目录（create 时冻结 cwd）
    // 新增 preload 通道（需后续在 preload.cjs 添加，本设计只定接口）
    terminalCreate:    Function as PropType<(opts: TerminalCreateOpts) => Promise<TerminalReply>>,
    terminalInput:     Function as PropType<(terminalId: string, data: string) => Promise<TerminalReply>>,
    terminalResize:    Function as PropType<(terminalId: string, cols: number, rows: number) => Promise<TerminalReply>>,
    terminalInterrupt: Function as PropType<(terminalId: string) => Promise<TerminalReply>>,
    terminalDescribe:  Function as PropType<(terminalId: string) => Promise<TerminalReply>>,
    terminalOutput:    Function as PropType<(terminalId: string, cursor: number) => Promise<TerminalReply>>,
    terminalClose:     Function as PropType<(terminalId: string) => Promise<TerminalReply>>,
    terminalKill:      Function as PropType<(terminalId: string) => Promise<TerminalReply>>,
  },
  emits: ['choose'],  // 无工作区时提示选择
})
```

`TerminalCreateOpts`:
```typescript
{
  sessionId: string
  cwd: string          // 工作区目录
  cols: number         // 初始列数
  rows: number         // 初始行数
  envFingerprint?: string  // 环境哈希（可选，由 Host 侧构造）
}
```

### 3.3 状态机 terminal-interactive-state.ts

```typescript
type TerminalPhase = 'idle' | 'creating' | 'running' | 'exiting' | 'exited' | 'unknown' | 'view-closed';

type TerminalState = {
  terminalId: string | null;     // Host 分配，跨重启不复用
  phase: TerminalPhase;
  cwd: string;                   // create 时冻结
  cols: number;
  rows: number;
  pid: number | null;            // describe 填充
  exitCode: number | null;       // 仅 exitObserved=true 时填
  exitObserved: boolean;
  interruptObserved: boolean;
  truncated: boolean;            // 环溢出标记
  // 直播环（前端侧镜像，有界）
  ringChunks: { seq: number; data: string; truncated: boolean }[];
  ringCursor: number;            // 下次 poll terminal/output 的起点
  more: boolean;
  busy: boolean;
  error: string;
};
```

关键函数：
- `create(cols, rows)` → 调 `terminalCreate`，存 terminalId/cwd/phase
- `writeInput(data)` → 调 `terminalInput`，二进制安全（Base64 + bytes）
- `resize(cols, rows)` → 调 `terminalResize`，仅 `phase==='running'`
- `interrupt()` → 调 `terminalInterrupt`
- `pollOutput()` → 调 `terminalOutput` 补洞（与 turn/poll 同构，防 notify 丢）
- `describe()` → 调 `terminalDescribe`，更新 phase/pid/exitCode
- `closeView()` → 调 `terminalClose`，phase → `view-closed`
- `kill()` → 调 `terminalKill`，phase → `exiting` 直到 describe 确认 `exited`
- `reset()` → 切换会话/目录时清空

### 3.4 渲染结构

```
<section class="terminal-interactive">
  ├── <header> 终端标题栏
  │     ├── <h2> 交互终端
  │     ├── <span> phase 标签（running / exited / unknown …）
  │     ├── <span> cwd 显示
  │     ├── <button> 中断（Ctrl+C）
  │     ├── <button> 停止并关（kill + close）
  │     └── <button> 仅关视图（close）
  │
  ├── <div ref="xtermContainer"> xterm.js 挂载点
  │     └── xterm 在此渲染 VT 序列
  │
  ├── <div> 截断提示（truncated=true 时显示）
  │
  ├── <div> 退出信息（exitObserved=true 时显示退出码）
  │
  ├── <div> 历史回放占位
  │     └── <p> 从会话日志回放终端输出（点击展开 terminal-output.ts 内容）
  │
  └── <div> 未配置提示（无工作区时）
        └── <button> 选择工作区
</section>
```

---

## 4. xterm.js 集成方案（CSP 合规）

### 4.1 为什么必须构建期折叠

xterm.js（`@xterm/xterm`）是 ESM-only 包。桌面渲染层跑在 `file://` + CSP `script-src 'self'` 下：
- 不能加载 ES module（CORS 拦截）
- 不能用 `new Function` / `eval`（CSP 禁止）
- 不能有运行时 `import()`

因此必须用 esbuild 在构建期折叠成经典 IIFE 脚本，与 `pack-tinyvue.mjs` / `pack-tinyrobot.mjs` 完全同构。

### 4.2 pack-xterm.mjs 设计

```
输入：
  @xterm/xterm (ESM)
  @xterm/addon-fit (ESM)

esbuild 配置：
  format: 'iife'
  globalName: 'Xterm'
  bundle: true
  alias: { 'vue' → vue-shim }   // xterm 不依赖 Vue，但保持一致
  external: []                   // 全部打入

输出：
  renderer/vendor/xterm.iife.js   // globalThis.Xterm = { Terminal, FitAddon }
  renderer/vendor/xterm.css       // xterm 样式原样拷贝

验证：
  assertStaticRendererBundle(code, metafile)
  // 无 eval、无 new Function、无残留 import()
```

### 4.3 index.html 引入

```html
<link rel="stylesheet" href="vendor/xterm.css">
<script src="vendor/xterm.iife.js"></script>
```

运行时通过 `globalThis.Xterm` 访问 `{ Terminal, FitAddon }`。

### 4.4 组件内 xterm 生命周期

```typescript
// setup 内
const xtermContainer = ref<HTMLElement | null>(null);
let xterm: XtermTerminal | null = null;
let fitAddon: FitAddon | null = null;

onMounted(() => {
  if (!xtermContainer.value) return;
  const X = (globalThis as any).Xterm;
  if (!X) { error.value = 'xterm.js 未加载'; return; }
  xterm = new X.Terminal({ /* options */ });
  fitAddon = new X.FitAddon();
  xterm.loadAddon(fitAddon);
  xterm.open(xtermContainer.value);
  fitAddon.fit();
  // xterm onData → terminalInput
  xterm.onData(data => writeInput(data));
  // ResizeObserver → terminalResize
  const ro = new ResizeObserver(() => {
    fitAddon!.fit();
    resize(xterm!.cols, xterm!.rows);
  });
  ro.observe(xtermContainer.value);
});

onBeforeUnmount(() => {
  xterm?.dispose();
  xterm = null;
});
```

### 4.5 输入处理

xterm.js 的 `onData` 回调直接收到用户键入的字符序列（含 Ctrl+C、方向键、Tab 等），无需单独的输入框：

- 用户键入 → `xterm.onData(data)` → `terminalInput(terminalId, base64(data))`
- **不经过 composer** — 终端输入直发 `terminal/input`，与聊天消息完全独立
- 单帧上限 4 KiB（后端设计文档 §3.3），超长粘贴由 xterm 自身分段

### 4.6 输出写入 xterm

```typescript
// pollOutput 拿到新 chunks 后
for (const chunk of newChunks) {
  xterm.write(chunk.data);  // VT 序列直接写入，xterm 负责解析
  if (chunk.truncated) truncated.value = true;
}
```

---

## 5. resize 监听

### 5.1 ResizeObserver 方案

```typescript
const ro = new ResizeObserver(entries => {
  if (!xterm || !fitAddon || phase.value !== 'running') return;
  fitAddon.fit();
  const cols = xterm.cols, rows = xterm.rows;
  // 防抖：连续 resize 只发最后一次
  debouncedResize(cols, rows);
});
ro.observe(xtermContainer.value);
```

### 5.2 防抖策略

- 用 `requestAnimationFrame` 合并同一帧内的多次 resize
- 仅 `phase === 'running'` 时发送 `terminal/resize`
- `phase === 'creating'` 时不发（等 create 回执带初始尺寸）
- `phase === 'exited'` / `view-closed` 时不发

### 5.3 初始尺寸

create 时用 `xterm.cols` / `xterm.rows`（fitAddon.fit() 后的实际值）作为初始 cols/rows 传入 `terminalCreate`。

---

## 6. 中断按钮

```typescript
function interrupt() {
  if (phase.value !== 'running' || !terminalId.value) return;
  interruptBusy.value = true;
  terminalInterrupt(terminalId.value)
    .then(() => { /* 回执 interrupt-requested；是否退出看后续 describe */ })
    .catch(e => error.value = String(e.message))
    .finally(() => interruptBusy.value = false);
}
```

UI：
- 按钮文案「中断（Ctrl+C）」
- `disabled` 当 `phase !== 'running'` 或 `interruptBusy`
- 点击后不立即改 phase；等 `describe` 或 `terminalOutput` 流里看到退出信号

---

## 7. close vs kill（DV08）

### 7.1 关标签三选对话框

当用户在 `phase === 'running'` 时关闭终端标签，弹出对话框：

```
┌─────────────────────────────────────┐
│  终端仍在运行                        │
│                                     │
│  [仅关视图]  [停止并关]  [取消]      │
│                                     │
│  仅关视图：终端在后台继续运行，       │
│  可从历史回放恢复查看。               │
│  停止并关：向进程组发停止信号，       │
│  确认退出后关闭。                    │
└─────────────────────────────────────┘
```

- **仅关视图** → `terminalClose(terminalId)`，phase → `view-closed`
- **停止并关** → `terminalKill(terminalId)` → 等 describe `exited` → `terminalClose`
- **取消** → 不操作

### 7.2 已退出时关标签

`phase === 'exited'` 或 `phase === 'unknown'` 时直接 `terminalClose`，不弹对话框。

---

## 8. 历史回放占位

在交互终端面板底部，放一个可折叠的区域：

```
▸ 历史回放（从会话日志）
  └── 展开后渲染 terminal-output.ts 的内容
```

- 复用现有 `terminal-output-state.ts` 的 `createTerminalOutput`
- 数据源仍是 `sacode.terminalOutput(sessionId, cursor, 16)`
- 不与交互终端的直播环混同
- 标注「已落盘输出 ≠ 实时终端」

---

## 9. 多实例

### 9.1 标签级多实例

每个工作台「终端」标签对应一个 `terminalId`。多实例通过工作台标签的多开实现（`workbench-tabs.ts` 已支持多标签）。

### 9.2 实例隔离

- 每个 `terminal-interactive.ts` 组件实例持有独立的 `terminal-interactive-state.ts` 状态
- `terminalId` 在 `create` 回执后绑定，不跨实例共享
- 切换标签时 `active` prop 变化，不触发 `close`（只是视图不可见）

### 9.3 布局恢复

重启 Host 后，布局恢复只打开空白终端视图（`phase = 'idle'`），不自动 `create`（后端设计文档 §3.2）。用户手动点击「启动终端」按钮触发 `create`。

---

## 10. Workspace Actions 注入

后端设计文档 §3.4：Header 动作使用当前任务终端。

前端侧：
- `terminal-interactive.ts` 暴露 `terminalId` 和 `cwd` 给父组件（通过 `emit` 或 `expose`）
- Header 动作按钮检查 `currentTerminalId` 是否存在且 `phase === 'running'`
- 若无终端或终端已死 → 提示「先打开终端」
- 若 cwd 漂移 → 拒绝，提示「终端工作区已变更」

**一期推荐：** Action 是向当前 PTY 注入已批准的命令字符串（人能看见），而不是另起 AppContainer 副本。注入方式：

```typescript
// action/run 在前端等价于：
xterm.write(actionCommand + '\n');  // 在终端里可见
writeInput(actionCommand + '\n');   // 发给 Host
```

---

## 11. 断连/重连

### 11.1 不重发输入

后端设计文档 §4：断连禁止重发 input。前端侧：

- 组件内不维护「未发送 input 队列」
- `terminalInput` 发送失败 → 显示错误，不排队重试
- xterm.js 的 `onData` 回调是同步的，用户键入时直接发；发失败就丢，不补

### 11.2 重连恢复

重连后：
1. `describe(terminalId)` → 获取当前 phase/cwd/pid/exitCode
2. `terminalOutput(terminalId, 0)` → 从 cursor=0 拉取全部直播环内容
3. xterm.reset() + xterm.write(ringData) → 重建屏幕
4. 继续正常 poll

**不接管旧 PID**（后端设计文档 §3.2）：如果 Host 重启后 `describe` 返回 `unknown`，UI 显示「终端状态未知，建议开新实例」。

---

## 12. preload.cjs 新增通道（设计，不修改）

本设计不修改 `preload.cjs`，但记录后续需要新增的通道：

```js
// preload.cjs 新增（后续实现）
terminalCreate:    (opts) => ipcRenderer.invoke("sacode:terminalCreate", opts),
terminalInput:     (terminalId, data) => ipcRenderer.invoke("sacode:terminalInput", { terminalId, data }),
terminalResize:    (terminalId, cols, rows) => ipcRenderer.invoke("sacode:terminalResize", { terminalId, cols, rows }),
terminalInterrupt: (terminalId) => ipcRenderer.invoke("sacode:terminalInterrupt", { terminalId }),
terminalDescribe:  (terminalId) => ipcRenderer.invoke("sacode:terminalDescribe", { terminalId }),
terminalOutput:    (terminalId, cursor) => ipcRenderer.invoke("sacode:terminalOutput", { terminalId, cursor }),
terminalClose:     (terminalId) => ipcRenderer.invoke("sacode:terminalClose", { terminalId }),
terminalKill:      (terminalId) => ipcRenderer.invoke("sacode:terminalKill", { terminalId }),
```

IPC 面是有限集合，唯一权威是 `preload.cjs` 里 `contextBridge.exposeInMainWorld` 的顶层 key。新增通道须同步改 `preload.cjs` 与 `test/bridge.test.mjs`。

---

## 13. CSS 方案

### 13.1 新增样式文件

`renderer/terminal-interactive.css`（与 `lsp-results.css` 同级）：

- 终端容器 flex 布局，填满 side-page 区域
- xterm 容器 `overflow: hidden`，由 FitAddon 控制尺寸
- phase 标签颜色：running=绿、exited=灰、unknown=橙、view-closed=蓝
- 中断/停止按钮样式复用现有 `.btn` / `.btn-primary`
- 截断提示复用现有 `.note` / `.editor-error`

### 13.2 index.html 引入

```html
<link rel="stylesheet" href="terminal-interactive.css">
```

---

## 14. 测试策略（设计，不实现）

### 14.1 单元测试

- `terminal-interactive-state.ts` 状态机：create → running → input → resize → interrupt → exited
- phase 转换合法性：idle 不能 input/resize/interrupt；running 可以
- 断连不重发：input 失败不排队
- 环截断标记传播

### 14.2 组件渲染测试

- xterm 挂载点存在
- 中断按钮在 running 时 enabled，非 running 时 disabled
- close vs kill 对话框在 running 时弹出
- 历史回放占位存在
- 未配置时显示选择工作区按钮

### 14.3 CSP 合规测试

- `pack-xterm.mjs` 产物过 `assertStaticRendererBundle`
- 无 `eval`、无 `new Function`、无残留 `import()`
- 无裸 `"vue"` 说明符

### 14.4 preload 面测试

- 新增 8 个通道在 `bridge.test.mjs` 中登记
- 通道名与参数形状校验

---

## 15. 实施依赖与顺序

本设计是纯前端设计，实施依赖后端先完成：

| 依赖 | 状态 | 阻塞 |
|------|------|------|
| Host `terminal/create` 等 8 个 RPC | 未实现 | 是（交互终端核心） |
| Windows ConPTY FFI | 未实现 | 是（create 实现） |
| xterm.js npm 包 | 未安装 | 否（可先装 devDependency） |
| `pack-xterm.mjs` 打包脚本 | 未编写 | 否（可先写，不碰运行时） |
| preload.cjs 新增 8 通道 | 未实现 | 是（组件 props 来源） |

建议实施顺序：
1. `pack-xterm.mjs` + xterm.js devDependency（可独立验证 CSP 合规）
2. `terminal-interactive-state.ts` 状态机（纯逻辑，可单测）
3. `terminal-interactive.ts` 组件骨架（xterm 挂载 + 子标签切换）
4. 等 Host RPC 就绪后接线 preload → props → 状态机
5. resize / interrupt / close vs kill / 多实例
6. Workspace Actions 注入
7. 历史回放占位接线

---

## 16. 与现有代码的边界

| 现有文件 | 改动 | 不改 |
|----------|------|------|
| `terminal-output.ts` | 加子标签切换条（顶部一行） | 现有只读回放逻辑、ExecutionTask 嵌入 |
| `terminal-output-state.ts` | 不改 | 全部 |
| `workbench-tabs.ts` | 不改（标签已存在） | — |
| `app.js` | 传入新增 props（8 个通道函数） | 现有接线结构 |
| `client-slots.ts` | 新增 `TerminalInteractive` 导出 | 现有导出 |
| `preload.cjs` | 新增 8 个 terminal 通道 | 现有 `terminalOutput` |
| `index.html` | 新增 xterm CSS/JS 引入 | 现有 CSP |
| `package.json` | 新增 `@xterm/xterm` `@xterm/addon-fit` devDependency | 现有依赖 |

---

## 17. 待确认项

| ID | 问题 | 建议默认 | 阻塞 |
|----|------|----------|------|
| F1 | xterm.js 版本 | `@xterm/xterm@5` + `@xterm/addon-fit@5` | 否 |
| F2 | xterm 主题 | 跟随应用暗色/亮色（复用 `appearance.ts` 状态） | 否 |
| F3 | 字体/字号 | 用户设置（复用 `general-settings.ts`），缺省 monospace 14px | 否 |
| F4 | 子标签默认视图 | 交互终端（无 PTY 时降级显示历史回放） | 否 |
| F5 | 历史回放折叠默认 | 折叠（点击展开） | 否 |
| F6 | xterm scrollback | 10000 行（xterm Terminal options） | 否 |
| F7 | 粘贴大文本防护 | 超 4 KiB 时提示确认（后端单帧上限） | 否 |

---

## 18. 验收映射

| 需求 | 设计对应 |
|------|----------|
| F09 输入 | §4.5 xterm onData → terminalInput |
| F09 resize | §5 ResizeObserver → terminalResize |
| F09 中断 | §6 中断按钮 → terminalInterrupt |
| F09 退出码 | §3.3 exitObserved + describe |
| F09 多实例 | §9 标签级多实例 |
| F09 cwd/环境 | §3.2 create 时冻结 cwd |
| F09 关标签≠结束 | §7 close vs kill 三选 |
| F09 断连不重发 | §11.1 不维护 input 队列 |
| F09 截断标记 | §3.3 truncated + §4.6 xterm.write |
| CSP 合规 | §4 构建期折叠 + assertStaticRendererBundle |
| 与只读回放并存 | §2 子标签切换 |
| Workspace Actions | §10 注入当前 PTY |

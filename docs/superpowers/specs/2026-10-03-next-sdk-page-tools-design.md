# DSH 桌面入口 Next SDK 页面工具接入设计

## 目标

在 DSH Electron 桌面渲染层接入 `@opentiny/next-sdk`，让页面级工具（读 DOM、点击、输入、滚动）通过 `document.modelContext` 注册，经 IPC 暴露给宿主，使模型能像调用 `write`/`read` 一样调用页面工具。

## 范围与排除

**含**：构建期折叠 `@opentiny/next-sdk` 为经典脚本；渲染层初始化 `document.modelContext`；注册固定页面工具集；新增 IPC 通道让宿主列出并调用页面工具；bridge 测试与 `--ui-smoke` 断言。

**不含**：`@opentiny/next-remoter`（Vue 聊天组件——DSH 已有 TinyRobot 消息面，不装第二套）；Web Agent 服务（远程遥控模式——本批只做纯前端模式，不跑 Node.js 代理）；外部 MCP 客户端接入（VS Code/CodeX 等——属远程模式，本批不做）；模型真凭证（仍 BLOCKED）。

## 架构

```
渲染层 (renderer/)
  ├── app.js              — 启动时调 initializeBuiltinWebMCP()
  ├── page-tools.js       — 注册页面工具到 document.modelContext
  └── vendor/next-sdk.iife.js — 构建期折叠产物
        ↑ IPC
主进程 (main.cjs + preload.cjs)
  ├── dsh:pageToolsList   — 渲染层向主进程登记页面工具清单
  └── dsh:pageToolCall    — 主进程向渲染层转发工具调用
        ↑ NDJSON/JSON-RPC stdio
宿主 (apps/host)
  └── extension/list 合并页面工具；extension/call 路由到渲染层
```

## 已核验前提

- `@opentiny/next-sdk` 0.4.11：`"type": "module"`（纯 ESM，无 UMD/IIFE）
- esbuild 折叠（仅引入 `initializeBuiltinWebMCP` + `WebMcpClient`）：1.8 MB IIFE，0 个动态 `import(`、0 个 `new Function`、0 个裸 `"vue"` 引用
- 1 个 `eval(` 存在：`PageController.executeJavascript(script, signal)` —页面代理功能的方法，不在 `initializeBuiltinWebMCP` 或 `WebMcpClient` 的调用链上；CSP `script-src 'self'` 只在调用时拦截 `eval`，不在解析时拦截
- DSH CSP：`default-src 'self'; style-src 'self'; script-src 'self'`（`renderer/index.html:5`）

## 组件

### 1. 折叠脚本 `scripts/pack-next-sdk.mjs`

沿用 `pack-tinyvue.mjs` / `pack-tinyrobot.mjs` 的模式：
- 入口仅引入 `initializeBuiltinWebMCP` 与 `WebMcpClient`
- esbuild `--bundle --format=iife --global-name=__nextSDK --platform=browser`
- 产物 `renderer/vendor/next-sdk.iife.js`（gitignore）
- 自检：无 `eval(` **在活跃路径上**（PageController 的 eval 允许存在但不得被 initializeBuiltinWebMCP 或 WebMcpClient 调用到）、无残留 `import(`、无裸 `"vue"` 说明符、`globalThis.__nextSDK` 已设

### 2. 渲染层初始化 `renderer/app.js`

在 Vue 挂载前调 `initializeBuiltinWebMCP()`，polyfill `document.modelContext`。

### 3. 页面工具集 `renderer/page-tools.js`

注册 4 个工具（均有 `inputSchema` + `execute` + `AbortSignal` 绑定）：

| 工具名 | 描述 | 入参 | 返回 |
| --- | --- | --- | --- |
| `page.readState` | 读页面当前状态 | `{}` | `{ title, elementCount, visibleText }` |
| `page.clickElement` | 按索引点击元素 | `{ index: number }` | `{ success, message }` |
| `page.inputText` | 按索引输入文本 | `{ index: number, text: string }` | `{ success, message }` |
| `page.scroll` | 滚动页面 | `{ direction: "up"\|"down", amount: number }` | `{ success, message }` |

状态只在页面内存（计数器、代次标识），不接文件、账号或凭证。工具经 `document.modelContext.registerTool(def, { signal })` 注册，`onUnmounted` 时 abort。

### 4. IPC 通道

`preload.cjs` 新增两个通道（沿用按动作命名、逐字段校验的有限集合模式）：

| 通道 | 方向 | 载荷 | 用途 |
| --- | --- | --- | --- |
| `dsh:pageToolsList` | 渲染→主 | `{ tools: [{ name, description, inputSchema }] }` | 渲染层向主进程登记当前页面工具清单 |
| `dsh:pageToolCall` | 主→渲染 | `{ name: string, args: object }` → `{ result }` 或 `{ error }` | 主进程向渲染层转发工具调用 |

`bridge.test.mjs` 新增用例：
- `pageToolsList` 返回 4 个工具且每个含 `name`/`description`/`inputSchema`
- `pageToolCall` 对 `page.readState` 返回页面标题与元素数
- `pageToolCall` 对未知工具名返回错误
- `pageToolCall` 对参数缺失返回错误

### 5. 宿主集成

`apps/host/src/main.cj` 的 `extension/list` 响应合并页面工具（主进程在转发时附加）；`extension/call` 对页面工具名（前缀 `page.`）路由到 `dsh:pageToolCall`。页面工具一律需要审批（`requiresApproval = true`）。

### 6. `--ui-smoke` 断言

新增：
- `document.modelContext` 存在
- `page.readState` 返回的 `title` 是 `DSH Harness`
- `page.clickElement` 对越界索引返回 `{ success: false }`

## 验收标准

1. `scripts/pack-next-sdk.mjs` 产物通过自检（无活跃路径 `eval`、无 `import(`、无裸 `"vue"`、`globalThis.__nextSDK` 已设）
2. `cd apps/desktop && node --test` 全绿（bridge 新增 4 条 + paths 3 + 原有 bridge 条目）
3. `npm run ui-smoke` 新增 3 条页面工具断言全绿
4. 折叠产物不在 git 里（`renderer/vendor/` 已 gitignore）
5. `@opentiny/next-remoter` 不安装（不装第二套聊天组件）

## 测试策略

- **折叠自检**：Node 脚本断言产物字面不含活跃 `eval`、`import(`、裸 `"vue"`
- **bridge 单测**：`bridge.test.mjs` 模拟渲染层与主进程的 IPC 往返
- **ui-smoke**：Electron 真机打开页面，调用 `document.modelContext.executeTool()` 验证页面工具执行
- **变异反证**：去掉 `initializeBuiltinWebMCP()` 调用 → `document.modelContext` 为 undefined → bridge 测试红

## 约束

- CSP `script-src 'self'` 不改（不加 `unsafe-eval`）
- 不安装 Web Agent 服务
- 不安装 `@opentiny/next-remoter`
- IPC 通道按动作命名、逐字段校验，不提供「发任意方法」通道
- 页面工具一律需审批（凭据只能是工单号）
- commit 注释一律中文；`renderer/vendor/` 不入库

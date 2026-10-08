# Browser Use 设计规格（接管用户已登录浏览器）

- 状态：v0.1，供架构评审；尚未开始实现。
- 日期：2026-10-08。
- 范围：让 Agent 通过用户已打开、已登录的 Chrome/Edge 完成网页任务；CLI 与桌面共享同一工具管线。
- 不在范围：无头浏览器抓取（已有 `bu_exec.cj` 的 `--dump-dom` provider，保留为独立能力，不冒充接管）。

## 1. 目标

让模型像调用 `read`/`bash` 一样调用浏览器工具：发现用户已打开的标签页、认领并操作（导航、点击、输入、滚动、截图、对话框处理、上传下载），操作完毕释放。复用用户现有登录态，不另建无头浏览器、不要求开放远程调试端口。

参考 Qwen Code 的 Browser Use 架构（官方源码 `fe4d4e3`，2026-10-08 固定），但不承诺兼容其扩展或协议。借鉴其连接拓扑、会话隔离与标签页归属模式；安全边界与审批策略按本仓自主产品定位加强。

## 2. 架构

### 2.1 连接拓扑

```text
CLI / 桌面 / 共享 daemon 的 Agent 会话
  → 仓颉核心：工具声明、参数校验、审批、审计、取消（TurnToken）
  → 独立 Node 浏览器 provider（NDJSON JSON-RPC 子进程）
      Playwright-core：Locator、快照、坐标输入
      ChromeExtensionTransport：本地 IPC 客户端
  → profile 级 Native Host（Node 子进程，由扩展启动）
      会话登记、请求/响应关联、事件路由、断线通知
  → SaCode 浏览器扩展
      chrome.debugger 附加、CDP 转发、标签页归属权威
  → 用户的 Chrome / Edge（标签页、配置、登录状态）
```

### 2.2 组件职责与不允许承担的职责

| 组件 | 职责 | 不允许承担的职责 |
| --- | --- | --- |
| 仓颉核心 | 工具注册、Schema、审批、审计事件、TurnToken 取消 | 不直接 spawn 浏览器进程，不持有 Playwright 对象 |
| Node 浏览器 provider | Playwright 操作、结果转换、输出预算、截图编码 | 不拥有 Agent 循环，不成为第二份会话真源，不绕过核心审批 |
| Native Host | IPC 服务器、客户端连接管理、会话登记、请求重映射、事件路由 | 不执行浏览器语义操作，不持有 Playwright，不成为 Agent |
| 浏览器扩展 | 标签页发现/认领/释放、`chrome.debugger` attach/detach、CDP 转发、归属权威 | 不做业务决策，不直接响应模型，不持有 Agent 状态 |
| Playwright-core | Locator、AI 无障碍快照、ref、frame、导航等待、操作和事件 | 不开放 WebSocket 监听（经 ExtensionTransport 适配） |

### 2.3 与现有代码的关系

| 现有模块 | 关系 |
| --- | --- |
| `core/src/bu_exec.cj` | 保留为无头 DOM provider（`--dump-dom`），不扩展为完整浏览器驱动 |
| `core/src/bu.cj` | `BrowserUseLedger` 的 verb 白名单与审计事件复用，扩展为完整 provider 注册契约 |
| `core/src/model_tool_runtime.cj` | 新增浏览器工具声明注册至此，走同一审批管线 |
| `core/src/mcp_client.cj` | 浏览器 provider 不经 MCP client；它是核心直管的 NDJSON 子进程 |
| `core/src/extproc.cj` | 浏览器 provider 复用 `extproc` 的子进程 spawn/NDJSON 帧模式 |
| `apps/desktop/renderer/pages/plugin-descriptions.ts` | `browser-use` 描述已有，需更新为实际能力 |

## 3. 协议设计

### 3.1 传输层

- **扩展 ↔ Native Host**：Chrome Native Messaging（stdio 帧格式：4 字节长度前缀 + JSON 载荷）。
- **Node provider ↔ Native Host**：本地 IPC。
  - Windows：named pipe `\\.\pipe\sacode-browser-use-<user>`。
  - Linux/macOS：Unix domain socket，私有目录 `0700`、socket `0600`，拒绝不安全 ownership 与符号链接。
- **Node provider ↔ 仓颉核心**：NDJSON JSON-RPC over stdio（与 `extproc.cj` 一致）。

### 3.2 帧格式

JSON 消息类型：

| 类型 | 方向 | 用途 |
| --- | --- | --- |
| `hello` | 扩展→Host | 握手：`protocolVersion`、`extensionId`、`extensionInstanceId` |
| `client.hello` | provider→Host | 客户端注册：`protocolVersion`、`extensionInstanceId`、`hostInstanceId` |
| `session.open` | Host→扩展 | 注册新会话 |
| `session.close` | provider→Host | 显式关闭会话 |
| `request` | provider→Host | 工具调用：`browserSessionId`、`id`、`method`、`params` |
| `response` | Host→provider | 结果：`browserSessionId`、`id`、`ok`、`result`/`error` |
| `event` | Host→provider | 异步通知：`browserSessionId`、`tabId`、`method`、`params` |
| `error` | 双向 | 协议错误：`code`、`message` |

帧大小上限：16 MiB（序列化后 UTF-8 字节）。超大操作结果返回有界 `OPERATION_FAILED`，不断开会话。

### 3.3 发现与握手

1. 扩展安装并启用后，`service worker` 调用 `chrome.runtime.connectNative()` 启动 Host。
2. Host 监听 IPC，发布私有发现记录（`extensionInstanceId`、`hostInstanceId`、`protocolVersion`、`socketPath`、`pid`）。
3. provider 读取发现记录，校验 `extensionInstanceId` 与 `protocolVersion` 匹配后连接。
4. Host 校验 `client.hello` 的 `extensionInstanceId`、`hostInstanceId` 与 `protocolVersion`；不匹配拒绝连接。
5. Host 分配 `browserSessionId`，向扩展发 `session.open`；注册成功后返回会话 hello。

### 3.4 会话模型

- 每个 Agent 会话对应一个 `browserSessionId`。
- 一个标签页同一时间只能被一个会话认领（`TAB_OWNERSHIP_CONFLICT`）。
- 会话关闭时释放认领的标签页、解除 debugger attach、移除扩展侧 overlay。
- Transport 断开后旧句柄以 `STALE_BROWSER_SESSION` 失败，不静默重绑。
- 重新连接创建新一代句柄，旧一代保留失效。

## 4. 扩展设计

### 4.1 权限

```json
{
  "manifest_version": 3,
  "permissions": ["tabs", "tabGroups", "webNavigation", "storage", "debugger", "alarms", "nativeMessaging"],
  "host_permissions": []
}
```

- `history` 权限不在首版 manifest 中声明；后续阶段首次使用历史查询时，经 `chrome.permissions.request()` 引导用户授予。
- `debugger` 权限会在商店审核时触发人工审查，需在商店说明中正当化。
- `host_permissions` 留空：扩展不直接请求网页内容权限，CDP 经 `chrome.debugger` 走，不经内容脚本注入。

### 4.2 Service worker 职责

- 启动/重连 Native Host（`connectNative`）。
- 维护标签页归属表（`chrome.storage.session`）。
- 处理 `chrome.debugger` attach/detach（按标签页串行）。
- CDP 帧转发（扩展↔Host）。
- 派生标签页归属（`webNavigation.onCreatedNavigationTarget`，`sourceTabId` 在 2500ms 因果窗口内）。
- 断线清理：detach 受控标签页、移除 overlay、清除归属、解除分组（不关闭页面）。

### 4.3 侧边栏（可选，后续阶段）

- 展示连接状态：未安装 Host / 未连接扩展 / 已连接 / 操作进行中。
- 不承载 Agent 对话（对话留在桌面主窗口或 CLI）。

## 5. Node 浏览器 provider 设计

### 5.1 进程模型

- 由仓颉核心以子进程方式 spawn（复用 `extproc.cj` 的 NDJSON 模式）。
- provider 导入 `playwright-core@1.62.1`（与 Qwen 相同固定版本，从 bundle 自身位置解析）。
- provider 经 `ChromeExtensionTransport` 连接 Native Host，而非直接监听 WebSocket。
- `playwright-core` 的 `chromium.connectOverCDP(transport)` 接受自定义 CDP transport。

### 5.2 操作集

面向模型的工具（核心注册的 ToolSpec）：

| 工具 | Schema 概要 | 需审批 |
| --- | --- | --- |
| `browser.tabs.list` | `{ browserId }` | 否 |
| `browser.tabs.get` | `{ browserId, tabId }` | 否 |
| `browser.tabs.new` | `{ browserId, url }` | 是 |
| `browser.tabs.finalize` | `{ browserId, keep: [tabId] }` | 是 |
| `browser.navigate` | `{ tabId, url }` | 是 |
| `browser.screenshot` | `{ tabId, clip?, fullPage? }` | 否 |
| `browser.snapshot` | `{ tabId }` → AI 无障碍快照 | 否 |
| `browser.click` | `{ tabId, ref }` 或 `{ tabId, x, y }` | 是 |
| `browser.fill` | `{ tabId, ref, text }` | 是 |
| `browser.press_key` | `{ tabId, key }` | 是 |
| `browser.scroll` | `{ tabId, x?, y? }` | 是 |
| `browser.evaluate` | `{ tabId, function | script }` | 是 |
| `browser.dialog.handle` | `{ tabId, action: accept\|dismiss, text? }` | 是 |
| `browser.upload` | `{ tabId, ref, filePath }` | 是 |
| `browser.download` | `{ tabId, ref }` | 是 |

- `browserId` = `chrome:<profileId>` 或 `chrome`（默认 profile）。
- 截图返回 JPEG + 元数据（原始尺寸、视口、设备像素比），经核心传给桌面渲染层。
- 快照受 20,000 字符预算约束。
- Locator plan 最多 32 步、32 层嵌套。
- 操作超时 1–120,000ms 整数；零以 `INVALID_ARGUMENT` 拒绝。

### 5.3 结果格式

- 文本结果：NDJSON `{"type":"text","text":"..."}`。
- 截图结果：NDJSON `{"type":"image","mime":"image/jpeg","data":"<base64>","meta":{...}}`。
- 错误：`{"type":"error","code":"TAB_OWNERSHIP_CONFLICT","message":"..."}`。

## 6. 核心接线

### 6.1 工具注册

在 `ModelToolRuntime` 的构造函数新增 `browser!: Bool = false` 参数；`browser` 为 true 时注册上述工具组。与 `files` 分支并列，可独立开关。
- `name`、`description`、`params`（JSON Schema）、`requiresApproval`。
- 写操作（navigate/click/fill/press_key/scroll/evaluate/dialog/upload/download/new/finalize）`requiresApproval = true`。
- 只读操作（list/get/screenshot/snapshot）`requiresApproval = false`。

### 6.2 执行管线

```text
模型 tool_call
  → ModelToolRuntime.execute(call)
  → registry.has(name)?
  → approval(call) → 审批工单
  → ToolRuntime.executeWithApproval(name, args, approvalId, guard, desk)
  → BrowserProvider（NDJSON 子进程）.invoke(name, args, token)
  → 结果回传，落审计事件 browser/exec::<verb>::<code>
```

### 6.3 审计

- 权限面：`BrowserUseLedger.perform(verb, target)` → `browser-use/action` 事件。
- 执行面：`log.append("browser/exec", "<verb>::<code>")`。
- 截图事件：`browser/screenshot`（保留图像引用，不入模型历史正文）。

### 6.4 取消

- `TurnToken.cancelled()` 在 provider 调用前与等待响应期间每步检查。
- 取消时终止 provider 调用，不自动重试已发出的浏览器动作。
- 扩展侧：断线时 detach 受控标签页，不关闭页面。

## 7. 安全与授权

### 7.1 与 Qwen 的差异

Qwen 把"安装扩展即授权 Browser Use"作为首个版本决策，不提供专用站点白名单、上传根目录白名单或快照脱敏。本仓**不照搬此策略**：

1. 首次连接需用户**明确选择 profile** 并同意操作范围（只读 / 可写 / 可上传下载）。
2. `browser.evaluate` 一律走审批，不能伪装成只读工具。
3. 写操作（点击、输入、导航、上传、下载）每次调用都需审批工单；只读操作（列表、截图、快照）免审批但落审计。
4. 扩展不直接请求 `host_permissions`；CDP 经 `chrome.debugger` 走，不注入内容脚本。

### 7.2 本地 IPC 认证

- Host 端校验连接来源：
  - Windows：named pipe DACL 限制当前用户。
  - Linux/macOS：socket 文件权限 `0600`、目录 `0700`、拒绝符号链接。
- 不设通用 token 认证层（同 Qwen），但保留 `extensionInstanceId` 校验防止跨 profile 冒用。

### 7.3 隔离边界

- 同一系统用户的本地进程处于信任边界内（与 Qwen 一致）。
- 不同 profile 的 Host 互不干扰。
- 标签页归属以扩展为权威来源，provider 维护对应的会话缓存。
- 断连后旧句柄失效，不静默重绑。

## 8. 平台策略

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| Windows + Chrome/Edge | 首先实测 | named pipe；扩展经商店或开发者模式加载 |
| Linux + Chrome/Edge | 独立验收 | Unix domain socket；路径长度限制 |
| macOS | 后续 | Unix domain socket；路径 103 字节限制 |
| 鸿蒙 | 保留产品目标 | Chrome 扩展路线不适用；需另核浏览器与壳的适配 |

Native Host 安装器：
- Windows：注册注册表 `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.sacode.browser_use`。
- Linux/macOS：写入 `~/.config/google-chrome/NativeMessagingHosts/` 或 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`。
- 按内容寻址安装，不覆盖他方文件；Host 修订号递增触发替换。

## 9. 测试与验收

### 9.1 阶段与门槛

| 阶段 | 交付 | 门槛 |
| --- | --- | --- |
| S1 连接基础 | 扩展、Host 注册/发现、协议握手 | 错误凭据、错误扩展 ID、版本不匹配均被拒绝；有逐用例计数与退出码 |
| S2 真实操作 | 自有测试页完成 navigate→snapshot→click→fill→screenshot | 页面实际状态变化被断言（不只看返回 ok）；导航后旧 ref 失效 |
| S3 核心接线 | 真模型经 CLI 与桌面调用同一工具管线 | 拒绝审批时页面零副作用；调用及结果可从日志重建 |
| S4 会话与故障 | 双会话不同 tab 并行、竞争 claim、单方退出 | 存活方不受影响；断连重启后旧句柄拒绝、迟到响应不串会话 |
| S5 完整操作面 | iframe、弹窗、对话框、上传下载、后台输入 | 逐项 PASS；不支持的行为明确 FAIL，不缩范围 |
| S6 发布交付 | npm 安装态与 Electron 安装态独立验证 | 不借开发目录依赖；安装/升级/卸载不覆盖他方文件 |

### 9.2 变异反证

每项安全检查必须有变异反证：去掉检查后指定测试变红。

| 变异 | 应转红的断言 |
| --- | --- |
| 移除 `browserSessionId` 校验 | 跨会话借用句柄被拒 |
| 移除 `extensionInstanceId` 校验 | 跨 profile 冒用连接被拒 |
| 绕过审批直接执行写操作 | 审批工单缺失时页面零副作用 |
| 放行过期句柄 | `STALE_BROWSER_SESSION` 断言 |
| 响应 ID 不重映射 | 请求/响应配对断言 |

### 9.3 证据要求

- 每项只记 PASS/FAIL/BLOCKED，带用例条数、退出码、源码与产物版本。
- 空测试集（TOTAL: 0）按 FAIL。
- BLOCKED 写清前提与解锁动作。
- 固定提交隔离复验（`git worktree add --detach HEAD`）。

## 10. 交付物清单

| 交付物 | 路径（计划） |
| --- | --- |
| 浏览器扩展 | `packages/chrome-extension/`（新建目录） |
| Native Host | `packages/browser-host/`（新建目录） |
| Node 浏览器 provider | `packages/browser-provider/`（新建目录） |
| 核心工具注册 | `core/src/browser_tool.cj`（新） |
| 核心审计 | `core/src/bu.cj`（扩展） |
| 桌面 IPC | `apps/desktop/preload.cjs`（扩展） |
| 打包脚本 | `scripts/pack-browser-host.mjs`（新） |

## 11. 风险与边界

- **`chrome.debugger` 权限**：商店审核触发人工审查，需正当化说明；开发者模式加载不受此限。
- **Playwright 版本固定**：AI 无障碍快照格式与 `aria-ref` locator 配对与版本有关，每次升级需真实 Chrome 冒烟。
- **标签页归属竞态**：attach/detach 串行执行；竞争 claim 返回 `TAB_OWNERSHIP_CONFLICT`，保持现有 owner。
- **页面副作用不可撤销**：浏览器动作可能已执行，取消只结束调用方等待，不回滚页面状态。
- **完整 profile 重启**：`chrome.storage.session` 清空，归属记录丢失；旧 handle 失效但分组清理待验收（与 Qwen 同边界）。

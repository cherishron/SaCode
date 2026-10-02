# CLI / 桌面端 能力对齐矩阵（M0）

> 状态：对齐规划 M0 —— 列出 daemon 已具备、但 CLI 缺少对应子命令的能力缺口，以及桌面端 TS 层仅做解析、零业务逻辑的原则核对。
> 关联：`docs/design/cli-desktop-parity-plan.md`、`runtime/src/daemon/mod.rs`（单一真源）、`interfaces/cli/src/cmd/mod.rs`。

## 0. 单一真源原则（重申）

- 所有核心逻辑在 `kernel` / `runtime`；CLI 子命令与桌面端组件**都只是调用方**。
- 桌面端 TS（`ui/logic/*.ts`）**零业务逻辑**：只解析 daemon 返回的原始字节/JSON，不重写算法。
- 任一端新增能力 = 先在 `runtime`/daemon 落地，再补 CLI 子命令与桌面端组件。

## 1. 缺口类型

| 类型 | 说明 | 数量级 |
|------|------|--------|
| ① 接线缺口 | daemon/命令已实现，但桌面端 Tauri 未注册对应 command，或 CLI 未暴露子命令 | 中 |
| ② 能力不对称 | daemon 有路由，但 CLI 完全没有对应子命令 | 中 |
| ③ TS 逻辑重写风险 | `ui/logic/*.ts` 中疑似含业务逻辑，需审计收敛为纯解析 | 需逐文件核 |

## 2. 已确认缺口（M0 核对后修正版，2026-10-01）

> 核对方法：通读 `runtime/src/daemon/mod.rs` `build_router` 全量路由宏 + `interfaces/cli/src/cmd/mod.rs` `CliCommand` 枚举（38 变体）+ `interfaces/client-core/src/daemon-client.ts` 实际调用路径。
> **关键修正**：桌面端经 `daemon_proxy`（client-core `DaemonClient`）访问全部 daemon 路由——automation / knowledge / agent-backends / task / queue 在桌面端**均已接线**，此前"main.rs 未注册"为误判（设计上就走 daemon_proxy，token 留在 Rust 进程）。**真正的缺口只在 CLI 侧**。

| 能力 | daemon 路由（已核对） | 桌面端 | CLI 子命令 | 缺口类型 |
|------|----------------------|--------|------------|----------|
| Git 工作区状态 | N/A（Tauri 命令） | ✅ `git_workspace_status`/`diff` 已实施（本地待提交） | 无（`git` 子命令仅 auth） | ① 已实施 |
| 自动化 | `/api/automation/rules` CRUD + toggle + run + `/api/automation/history` | ✅ 经 daemon_proxy（`AutomationView.vue`） | **无** | ② 仅 CLI |
| Agent 后端 | `/api/agent-backends` GET、`/:id` PUT、`/:id/probe` POST | ✅ 经 daemon_proxy（`agent-backends.ts`） | **无** | ② 仅 CLI |
| 知识库 | `/api/knowledge/entries|notes|search` | ✅ 经 daemon_proxy（`KnowledgeView.vue`） | **无** | ② 仅 CLI |
| 任务管理 | `/task` POST、`/tasks` GET、`/task/:id` status/result/changes/checkpoint/retry/cancel、DELETE | ✅ 经 daemon_proxy（ChatPane 会话流） | **无**（无 task 子命令） | ② 仅 CLI |
| 队列 | `/queue/status`、`/queue/pending` | ✅ 经 daemon_proxy | **无** | ② 仅 CLI |
| 会话（conversations） | `/api/desktop/conversations` CRUD + archive/restore/settings | ✅ 经 daemon_proxy | 无（`session` 子命令非同物） | ② 仅 CLI（低优） |
| 审批 | `/task/:id/approve`、`/task/:id/approvals` | ✅ 经 daemon_proxy + SSE | 无（run 模式走进程内审批） | 按 Run 模式设计，非缺口 |

`CliCommand` 枚举实测：Run/Orchestrator/Profile/Plugin/Doctor/Diff/Hooks/Ide/Config/Keybindings/Outstyle/Prompt/Wiki/Vim/Skill/Sandbox/Mcp/Acp/Account/Audit/Design/Git/Lsp/Memory/Insight/Serve/Init/Mistakes/Repl/Tui/Checkpoint/Status/Update/Session/DumpConfig/Bundle/Help/Version——**确无** task/automation/agent-backends/knowledge/queue，§2 判断成立。

## 3. 提议新增 CLI 子命令（补齐类型②）

| 子命令 | 对应 daemon 能力 | 输入/输出 |
|--------|------------------|-----------|
| `sacode automation list/create/run/delete` | automation | 与 daemon 同构 JSON |
| `sacode agent-backends list/set` | agent-backends | 列出/切换后端 |
| `sacode knowledge index/query` | knowledge | 索引/检索知识库 |
| `sacode task list/show/cancel` | task 管理 | 任务列表/详情/取消 |
| `sacode queue status` | queue | 队列深度/状态 |

原则：CLI 子命令参数与输出 schema **直接镜像** daemon 路由，不做二次转换。

## 4. 接线修复（类型①，M1 — 已实施）

1. ~~在 `interfaces/desktop/src-tauri/src/main.rs` 的 `invoke_handler` 注册 `git_workspace_status` / `git_workspace_diff`~~ ✅ 已实施（2026-10-01）：两个 Tauri command + `GitWorkspaceStatus` 结构体 + bridge 函数 + `WorkspaceTools.vue` "Git 工作区"面板。因 WIP 混合保留本地待提交。
2. ~~核对 `git-changes.ts` 解析逻辑~~ ✅ 已接入 `WorkspaceTools.vue`（纯解析保留：`parseGitStatusPorcelainZ` / `gitEntryToRow` / `applyDiffToRow`）。
3. CLI 侧补 `git status`/`git diff` 工作区子命令 —— **仍待做**（现 `git` 子命令仅 auth）。

## 5. 验收（DoD-with-parity）

- 同一任务在 CLI 与桌面端执行，核心输出逐字节一致（golden test）。
- 新增子命令均有 `--json` 与结构化输出，供桌面端直接消费。
- `ui/logic/*.ts` 审计完成：标记每个文件的「纯解析 / 含逻辑」，含逻辑者回抽至 `runtime`。

## 6. 待核对清单（M0 收尾，2026-10-01 执行结果）

- [x] 通读 `runtime/src/daemon/mod.rs` 全量路由，校正 §2 路由名 —— 已核对 `build_router` 全量 route 宏（75 路由），§2 修正完成。
- [x] 通读 `interfaces/cli/src/cmd/mod.rs` `CliCommand` 枚举 —— 已核对（38 变体），确无 task/automation/agent-backends/knowledge/queue，§2 判断成立。
- [x] 修正桌面端接线误判 —— automation/knowledge/agent-backends/task/queue 经 daemon_proxy 已接线，缺口收敛为"仅 CLI"。
- [x] 审计 `interfaces/desktop/src/ui/logic/*.ts`（20 个）标注纯解析/含逻辑 —— **已完成，见 §7**。
- [x] CLI 补 task/queue/automation/agent-backends/knowledge 子命令（§3）—— **已完成（提交 f81b22a，2026-10-01）**：`daemon_admin.rs` 瘦 HTTP 客户端（镜像 daemon 路由、零逻辑复制、`--raw` 原始 JSON、路径段转义防注入、`.no_proxy()` 绕过本机代理）；serve 自动 token 时向 owner 终端打印 `daemon_token=`（D9 L1 衔接）；端到端冒烟 6/6 通过（5 组子命令 + 401 指引）。

## 7. ui/logic/*.ts 逻辑重写审计（2026-10-01，20 文件）

> 判定标准：是否重写 daemon/kernel 已有算法（回抽对象） vs 纯解析 daemon 数据 / 纯 UI 状态 / localStorage 前端自有状态（合规）。

| 文件 | 行数 | 判定 | 说明 |
|------|------|------|------|
| agent-backends.ts | 75 | ✅ 纯 UI | 健康徽标/额度文案格式化，数据来自 client-core 类型 |
| conversation-manage.ts | 121 | ⚠️ 遗留兜底 | 鸭子类型探测真 API；daemon 端点已存在（见下），localStorage 兜底为死代码可清理 |
| conversation-queue.ts | 56 | ✅ 纯 UI | 发送队列为前端自有概念，daemon 无对应 |
| git-changes.ts | 122 | ✅ 纯解析 | porcelain -z / diff 统计解析，配套 Tauri git 命令（已接线） |
| kv-rows.ts | 40 | ✅ 纯 UI | 表单 KV 行编辑纯函数 |
| local-mode.ts | 173 | ✅ 纯 UI | 模式横幅推断（前端展示推断，不重写 daemon 算法；有 TODO 待 daemon 返回真实 mode） |
| markdown.ts | 39 | ✅ 纯渲染 | marked + dompurify 懒加载 |
| preferences.ts | 215 | ✅ 纯 UI | 偏好类型 + localStorage 落盘 |
| sadesign-state.ts | 698 | ✅ 纯 UI 状态 | 设计工作台状态机，实际操作经 services → daemon /api/design/* |
| services.ts | 1646 | ✅ 接线层 | DesktopApp = daemon 生命周期 + DaemonClient 包装，按设计就是调用方 |
| session-search.ts | 25 | ✅ 纯 UI | 会话列表子串过滤（契约 §3.2 明确首版不做向量） |
| session-visibility.ts | 35 | ⚠️ 遗留兜底 | localStorage 归档与 daemon archive/restore 端点重复（同 conversation-manage） |
| split-layout.ts | 96 | ✅ 纯 UI | 布局树模型 |
| split-persist.ts | 141 | ✅ 纯 UI | 布局存档（形状校验失败整档作废，正确） |
| split-slots.ts | 39 | ✅ 纯 UI | 槽位纯函数，判重单点收口 |
| split-tree.ts | 508 | ✅ 纯 UI | 分屏二叉树（tmux 同构），全部纯函数 |
| terminal-input.ts | 31 | ✅ 纯 UI | 键盘事件→PTY 字节映射（终端前端固有职责） |
| turn-events.ts | 532 | ✅ 纯解析/展示模型 | 轮次事件类型 + frames→events 兼容映射（消费 daemon 产出） |
| ui-document-editor.ts | 256 | ✅ 纯 UI | UI 文档草稿编辑命令系统，提交走 daemon PATCH |
| ui-document-preview.ts | 220 | ✅ 纯渲染 | 预览渲染 + SAFE_STYLE_KEYS 白名单（安全合理） |

**审计结论**：18/20 合规、2 处轻度遗留（`conversation-manage.ts` + `session-visibility.ts` 的 localStorage 归档兜底）。**已二次确认**：`DaemonClient` 已挂 `renameDesktopConversation`/`archiveDesktopConversation`/`restoreDesktopConversation` 三方法（daemon-client.ts:2274-2290），与鸭子类型探测名完全匹配 → 探测恒成功走真 API，localStorage 兜底为**死代码**。清理动作（删除兜底路径 + 过期 TODO 注释 + `session-visibility.ts` 本地归档集合）留待桌面 WIP 合入后执行——两文件均为未跟踪 WIP，本轮不触碰。**无 P0 逻辑重写风险，审计通过。**

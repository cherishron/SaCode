# CLI / Desktop 功能一致性保障方案（v0.1）

> 目标：开发 Desktop 功能时，同步保证 CLI 与 Desktop 两端**核心功能、业务逻辑、输入输出结果完全一致**；仅交互与展示方式不同（Desktop=GUI，CLI=命令行）。
> 关联：AGENTS.md（分层架构）、`runtime/src/daemon/mod.rs`（共享后端）、`interfaces/cli/src/cmd/mod.rs`（CLI 分发）、`interfaces/desktop/src-tauri/src/main.rs`（sidecar 代理）。
> 本文件为「架构/流程保障方案」，落地代码在确认后按路线图实施。

---

## 1. 架构事实：两端早已共享同一套逻辑

```
                ┌──────────────────────────────────────────┐
                │   sacode_kernel / sacode_runtime (Rust)    │  ← 纯逻辑 + 副作用（唯一事实源）
                │   executor / daemon (HTTP API ~100 路由)   │
                └───────────────┬──────────────┬────────────┘
                  daemon HTTP   │              │   daemon HTTP
                                ▼              ▼
                  ┌──────────────────┐   ┌──────────────────────────┐
                  │  CLI (TUI/文本)   │   │  Desktop (Tauri+Vue3)      │
                  │  run_task / 子命令 │   │  main.rs: sidecar(CLI二进制)│
                  │  直连 executor     │   │  daemon_proxy / 事件桥      │
                  └──────────────────┘   └──────────────────────────┘
```

- **Desktop 的后端就是 CLI 的守护进程**：`main.rs` 的 `start_daemon` 拉起 `default_sacode_binary()`（CLI 二进制）作为 sidecar，`daemon_proxy` / `start_event_bridge` 把 WebView 请求代理到该 daemon 的 HTTP/SSE。
- 因此：**任何经由 daemon 路由的业务逻辑，两端天然一致**。一致性风险不在"各写一份逻辑"，而在下面三类缺口。

---

## 2. 一致性原则（铁律）

1. **单一事实源**：业务逻辑只存在于 `kernel`/`runtime`（Rust）。CLI 子命令与 Desktop 组件都只是**调用方**，不得重写逻辑。
2. **TS 层零逻辑**：`interfaces/desktop/src/ui/logic/*.ts` 与 `client-core` 仅做「调用 daemon API」或「解析 daemon 返回的原始字节」（如 `git-changes.ts` 解析 `git status --porcelain` 原始输出）。任何"在 TS 里重新算一遍"都是违规。
3. **能力三件套**：一个核心能力 = 1 个 daemon 路由 + 1 个 CLI 子命令 + 1 个 Desktop 界面/组件。缺任一即缺口。
4. **定义完成（DoD）含对等**：新增/修改一个核心能力，必须同时具备 daemon 路由、CLI 子命令、Desktop 界面三者，并通过对等测试，才算完工。

---

## 3. 范围边界：核心能力 vs CLI 基础设施

并非所有 CLI 子命令都需在 Desktop 有 GUI——否则会强行给 GUI 塞进终端操作。

- **核心能力（必须两端对等）**：任务执行/管理、会话、账号/模型、Provider、MCP、技能、设计、知识、自动化、代理后端、Git 鉴权、Hooks、审计、队列。这些是**用户面向的产品功能**。
- **CLI 基础设施（CLI 专属，无需 Desktop GUI）**：`doctor`（环境自检）、`hooks install`、`ide`、`bundle`（打包）、`vim`、`lsp`/`acp serve`、`serve`、`repl`/`tui`（CLI 自身交互）、`init`、`profile`、`sandbox`、`keybindings`、`outstyle`、`prompt`、`update`、`config`、`status`、`diff`、`plugins`、`mistakes`、`wiki`、`insight`、`checkpoint`、`memory`。这些是**开发者/终端运维操作**，交互方式本质不同，不计入"功能缺失"。

> 边界判定标准：该能力是否依赖 GUI 才能被终端用户使用？否 → CLI 专属；是 → 必须对等。

---

## 4. 当前缺口清单（已查证，需闭环）

### 4.1 接线缺口（最紧急，功能半接线）
- **`git-changes.ts`** 注释声明数据源来自 Tauri 命令 `git_workspace_status` / `git_workspace_diff`，但 `main.rs` `invoke_handler` 仅注册 13 个命令（start_daemon/stop_daemon/daemon_proxy/terminal_*/set_tray_enabled/set_autostart/system_integration_status/select_workspace_folder/daemon_info/start_event_bridge），**不含这两个 git 命令** → 该面板数据来源未接通。
  - 修复：在 `main.rs` 注册 `git_workspace_status`/`git_workspace_diff`（内部调用 runtime 的 git 逻辑），或改为走 daemon `/workspace/*` 路由经 `daemon_proxy` 获取。

### 4.2 能力不对称（daemon 有路由 + Desktop 有界面，但 CLI 缺子命令）
| 能力 | daemon 路由 | Desktop 界面 | CLI 现状 | 缺口 |
|------|-------------|--------------|----------|------|
| 任务管理（列表/状态/取消/重试/检查点） | `/tasks`、`/task/:id/{status,cancel,retry,checkpoint}` | 任务列/分格 | 仅 `run`/`orchestrator` 执行，无管理命令 | ⚠️ CLI 缺 |
| 代理后端 | `/api/agent-backends/*` | 后端管理视图 | 无 | ⚠️ CLI 缺 |
| 自动化规则 | `/api/automation/*` | 自动化视图 | 无 | ⚠️ CLI 缺 |
| 知识库 | `/api/knowledge/*` | 知识视图 | `memory`（待核对是否同语义） | ⚠️ 待核对 |
| 设计会话 | `/api/design/sessions/*` | 设计视图 | `design`（疑似仅生成，非全量会话管理） | ⚠️ 部分 |

### 4.3 逻辑重写风险（待审计）
- `git-changes.ts` 处理正确（解析 daemon 原始输出，注释强调"共用同一份代码"）。
- 其余 19 个 `ui/logic/*.ts`（`conversation-manage`、`agent-backends`、`kv-rows`、`markdown`、`services`、`turn-events`、`sadesign-state` 等）需逐一审计：是否仅调用 daemon / 解析原始数据，还是重写了本属 Rust 的逻辑。**任何重写都必须下沉到 `kernel`/`runtime`**。

---

## 5. 能力对等矩阵（维护模板）

> 每新增/修改能力，先在此表登记一行。状态：✅ 三件套齐 / ⚠️ 缺 CLI / ❌ 缺 Desktop / 🔌 接线缺口。

| 能力 | daemon 路由 | CLI 子命令 | Desktop 界面 | 状态 |
|------|-------------|------------|--------------|------|
| 任务执行 | `/task` POST | `sacode "<t>"` / `orchestrator` | Composer 发送 | ✅ |
| 任务管理 | `/tasks`,`/task/:id/{status,cancel,retry,checkpoint}` | ❌ | 任务列/分格 | ⚠️ CLI 缺 |
| 多轮会话 | `/api/desktop/conversations` | REPL/TUI（等价形态） | 对话流 | ✅ |
| 账号/模型 | `/account/*` | `account` | 设置-账号 | ✅ |
| 本地 Provider | `/providers/local` | `config`（待核对） | 设置-模型 | ⚠️ 待核对 |
| MCP 服务 | `/api/mcp/*` | `mcp` | 设置-MCP | ✅ |
| 技能 | `/api/skills` | `skill` | 设置-技能 | ✅ |
| 设计系统/会话 | `/api/design/*` | `design`（部分） | 设计视图 | ⚠️ 部分 |
| 知识库 | `/api/knowledge/*` | `memory`（待核对） | 知识视图 | ⚠️ 待核对 |
| 自动化规则 | `/api/automation/*` | ❌ | 自动化视图 | ⚠️ CLI 缺 |
| 代理后端 | `/api/agent-backends/*` | ❌ | 后端管理 | ⚠️ CLI 缺 |
| Git 鉴权 | `/api/git-auth/*` | `git` | 设置-Git | ✅ |
| Hooks/导入 | `/api/hooks`,`/api/import` | `hooks` | 设置-Hooks | ✅ |
| 审计 | `/audit` | `audit` | 审计视图 | ✅ |
| 队列 | `/queue/*` | ❌ | 状态栏 | ⚠️ CLI 缺 |
| Git 变更面板 | （Tauri `git_workspace_*`） | — | 变更列表 | 🔌 接线缺口 |

---

## 6. 保障流程（写入开发规范）

1. **新增核心能力时**：在 `kernel`/`runtime` 实现逻辑 → 在 `daemon/mod.rs` 注册路由 → 在 `cli/cmd/` 加子命令（薄封装，调同一 executor/daemon）→ 在 Desktop 加组件（经 `daemon_proxy` 调用）。四步同源。
2. **DoD 检查单**：① daemon 路由有测试；② CLI 子命令有 `--json` 输出且结构与 daemon 响应一致；③ Desktop 组件不重写逻辑；④ 对等矩阵已更新；⑤ 对等测试通过。
3. **TS 审计红线**：PR 中含 `ui/logic/*.ts` 新增逻辑时，必须说明"逻辑来自 daemon 原始数据解析"，否则打回。
4. **CLI 命令必须可机读**：每个核心子命令提供 `--json` 输出，结构与对应 daemon 响应字段对齐，作为对等测试的基准。

---

## 7. 对等测试策略

- **原理**：两端共享 daemon，若均不重写逻辑，则**同一输入经 CLI 与 Desktop 必得相同结构化输出**。测试即验证"无逻辑分叉"。
- **结构对等测试**（推荐优先）：对 `ui/logic/*.ts` 的纯解析函数，直接用 daemon 侧相同原始输入跑 Rust 单测 + TS 单测，断言输出一致（照搬 `git-changes.ts` 注释里的"共用同一份代码"做法）。
- **端到端对等测试**（CI）：同一任务描述，分别经 `sacode "<t>" --json` 与 Desktop 经 daemon 创建任务，断言 `/task/:id/result` 与 CLI `--json` 结果的业务字段一致（忽略展示层字段）。
- **矩阵门禁**：CI 读取第 5 节矩阵，任何 ⚠️/🔌/❌ 的核心能力阻断发布（或显式标注为已知豁免）。

---

## 8. 落地路线图

| 阶段 | 产物 | 关键动作 | 验收 |
|------|------|----------|------|
| M0 矩阵补全 | 第 5 节矩阵填全 | 扫描全部 daemon 路由 × CLI 子命令 × Desktop 组件，登记状态 | 无遗漏核心能力 |
| M1 接线修复 | `git_workspace_*` 接通 | `main.rs` 注册 + 内部调 runtime git 逻辑（或改走 daemon `/workspace/*`） | 变更面板有数据 |
| M2 TS 逻辑审计 | 审计报告 | 逐一核对 19 个 `ui/logic/*.ts`，重写项下沉 `kernel`/`runtime` | 零 TS 逻辑重写 |
| M3 补 CLI 命令 | `task`/`agent-backends`/`automation`/`queue` 子命令 | 薄封装调 daemon，带 `--json` | 矩阵对应行转 ✅ |
| M4 对等测试 | 测试套件 | 结构对等 + 端到端对等 + CI 矩阵门禁 | CI 可拦分叉 |
| M5 边界裁定 | 文档 | 把 §3 边界写入 CONTRIBUTING/开发规范 | 新 PR 有 DoD 检查 |

---

## 9. 风险

- **M1 触碰 `main.rs`**：该文件在桌面团队未提交 WIP 中，注册命令需与团队协调或独立提交，避免冲突。
- **`memory` 是否等于 `knowledge`**：语义需核对，避免重复建设或误判为缺口。
- **过度 GUI 化**：不要把 CLI 基础设施（doctor/bundle/vim）硬塞进 Desktop，守住 §3 边界。
- **输出格式漂移**：CLI `--json` 与 daemon 响应字段需显式对齐契约，否则对等测试误报。

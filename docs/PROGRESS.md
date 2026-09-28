# SaCode 进度（当前实际状态）

> 更新：2026-09-27 · 分支 `dev`（当前核对：`79bc5b7`，修改本文档前工作区干净）
>
> **历史验证记录（Desktop 多轮会话；本次未复跑）**：Desktop 会话持久化与多轮上下文已落地。后端新增 `desktop_turns` SQLite 表和 `/api/desktop/conversations` CRUD 路由（list/get/create/append/delete），会话内续发注入最近 12 轮用户消息与助手输出（超 32000 字符拒绝），上一轮未结束时续发返回 409。派发失败时事务化回滚 `desktop_turns`/`tasks`/`task_changes`，不残留孤儿记录。删除会话级联取消队列与执行器任务、清理审批、移除内存与 SQLite 记录，重启后不复活。前端侧栏显示会话列表（localStorage 自定义排序），分屏切换同步 `currentConversationId`/`conversationTurns`，输入框按会话最后一轮状态禁用，新建任务后自动打开分屏。**此前记录的实测**：daemon 定向测试 41/41（含两轮持久化+重启恢复+删除级联+技能拒绝四项端到端）；Rust 库测试排除外部 `live_opencode_acp_probe_and_prompt` 后 **788 通过、1 忽略**；client-core **24/24**、Desktop **29/29**，两处 TS typecheck、Vite Web 构建（输出 `D:\temp\SaCode\desktop-web-build`）均通过。已用隔离 `create_daemon_in(tempdir)` 做路由层 HTTP 端到端测试；**当时未验证**真实监听端口与认证请求、交互式 Desktop GUI 和 Tauri 打包。以上数字为历史记录；本次复测结果见「验证状态」，不可混同为本次全量测试。
> 本文件是该仓的**进度单一真源**；产品线级总览见 [`../../docs/STATUS.md`](../../docs/STATUS.md)。
> 状态词汇遵循 [`../../docs/README.md`](../../docs/README.md)。
> 与 [`README.md`](../README.md)（是什么 / 怎么用）分工：本文件只回答**已经做到哪、验证到什么程度**。

## 一句话状态

**离线 CLI/TUI 编码助手、统一身份客户端（I3）和 Tauri Desktop M2 已纳入 `dev`；Desktop 多轮会话与会话边缘导航的实现也在当前分支。** 修改本文档前工作区干净。上方长段及下方 I3/M2 专项表为历史记录；**本次已复跑定向检查，完成真实端口的 client-core ↔ daemon 联调，并验证 Tauri Rust sidecar/代理的本地带令牌请求；交互式 GUI 尚未验收**。

## workspace 结构

```toml
members = [
  "kernel", "runtime",
  "interfaces/cli", "interfaces/acp", "interfaces/lsp",
  "integrations/acp",
  "interfaces/desktop/src-tauri",
]
```

界面覆盖：终端（CLI/TUI/REPL）、VSCode 扩展、Desktop（Tauri）。`interfaces/client-core`（TS）与 `sdk/`、`npm-package/` 为独立发布单元，不在 Cargo workspace 内。

## 已落地

| 能力 | 位置 | 状态 |
|---|---|---|
| 统一身份客户端（OIDC + PKCE） | `runtime/src/identity/*`（config · pkce · oidc · gateway · secret_store · session · callback · provider_bridge · service · headless · mod） | 已落地 |
| OS keyring 密钥存储 | `kernel` 的 `SecretRefKind::OsKeyring`；`provider.json` 的 `sa-ai` 条目 `api_key` 恒为空、仅写 `secret_ref` | 已落地 |
| CLI 账号命令 | `sacode account login\|status\|logout\|models`（含 `--dry-run`） | 已落地 |
| 手动 Provider 向导 | 既有 `/login` 流程保持兼容 | 已落地 |
| Device grant 支持 | 配合 sa-idp 的 RFC 8628 | 已落地 |
| Tauri Desktop M2 | sidecar 持 token + IPC 代理 + MVP UI（session/approval/changes/settings） | 已纳入 `dev` |
| ACP 后端 | `interfaces/acp` + `integrations/acp`；OpenCode ACP 接入 | 已落地 |
| Task protocol v1 | 验收记录 + 结构化失败分类 | 已落地 |

## 验证状态

### 2026-09-27 本次定向复测（`dev` / `79bc5b7`）

| 检查 | 本次结果 |
|---|---|
| `cargo test -p sacode-runtime daemon -- --test-threads=8` | 79 通过、0 失败；另有 723 项未纳入该过滤范围 |
| client-core：`npm run typecheck`、`npm test`、`npm run build` | 类型检查和构建通过；测试 24/24 |
| Desktop：`npm run typecheck`、`npm test`、`npx vite build` | 类型检查和 Web 构建通过；测试 39/39 |
| Desktop：`npm audit --omit=dev` | 生产依赖 0 项告警 |
| Desktop：`npm audit --json` | 开发依赖 Vite / esbuild 共 2 项告警（1 高、1 中）；未升级依赖 |
| CLI：`cargo build -p sacode-cli` | 构建通过；以此二进制运行以下真实端口联调 |
| 真实端口联调：`sacode serve --host 127.0.0.1 --port 0 --ready-file` | 通过：临时工作区启动、nonce/ready-file 校验（不含 token）、无令牌/错误令牌访问会话路由 401、正确令牌 200；client-core 经 HTTP 完成两轮会话、重启恢复、删除 |
| 原生 Desktop：`cargo test -p sacode-desktop` | 4 通过；1 项需显式启用的真实端口联调测试忽略 |
| 原生代理联调：`SACODE_TEST_BINARY=... cargo test -p sacode-desktop native_sidecar_proxies_authenticated_requests -- --ignored` | 1 通过：Rust `start_sidecar` 启动真实本地 daemon，ready-file/DTO 不含 token，无令牌请求 401；`ProxySnapshot::proxy` 自动带令牌请求 200，错误 skill 的 POST 返回 400，绝对 URL 被拒绝 |

Desktop 首次类型检查因 client-core 尚未构建、缺少其导出的类型声明而失败；先在 `interfaces/client-core` 运行 `npm run build` 后重跑通过。daemon 的 79 项定向测试使用隔离路由层；另以 CLI 子进程进行了真实 loopback TCP 与 Bearer 令牌联调。隔离环境未配置模型，两轮任务均以 `failed` 结束，因此仅证明认证、请求和持久化链路，不代表模型生成或多轮上下文效果通过。本次已验证 Tauri Rust 原生 sidecar/代理代码路径，但未运行 WebView IPC 命令链路或交互式 GUI、完整 Rust 测试及 Tauri 安装包构建。Vite / esbuild 的开发服务器安全告警需独立评估升级方案；不要把生产依赖审计为 0 误认为开发依赖无风险。

### 本次未复跑，沿用 spec 原始记录

| 项 | 记录值 | 来源 |
|---|---|---|
| `cargo check -p sacode-kernel -p sacode-runtime -p sacode-cli` | PASS | `docs/compose/spec/sacode-identity-i3.md` |
| `cargo test -p sacode-runtime identity` | 17 passed | 同上 |
| `cargo test -p sacode-cli --lib parse_args_parses_account_subcommand` | 1 passed | 同上 |
| `cargo test -p sacode-cli --lib provider_store` / `provider_config` | 4 + 13 passed | 同上 |
| `cargo test -p sacode-kernel --lib` | 53 passed | 同上 |
| desktop：`npm run typecheck` + `npm test` | PASS 6 | `docs/compose/spec/tauri-desktop-m2.md` |
| desktop：`npm run build` | PASS | 同上 |
| `cargo check -p sacode-desktop` | PASS | 同上 |
| `cargo test -p sacode-desktop` | PASS 3 | 同上 |

### 服务端依赖（已在对应仓独立验证）

- sa-idp **已实现** `/oauth/authorize` `/oauth/token`（见 [`../../sa-idp/docs/PROGRESS.md`](../../sa-idp/docs/PROGRESS.md)）
- gateway-rs **已实现** `/api/auth/exchange`（见 [`../../SaAiApiGateway/docs/PROGRESS.md`](../../SaAiApiGateway/docs/PROGRESS.md)）
- 客户端侧在此契约上以 Memory mock 完成测试

## 当前仓库状态

核对 `dev` 的 `79bc5b7` 时，`git status` 为干净；此前记载的 I3 与 Tauri Desktop M2 未提交清单已过期。Desktop 多轮会话的持久化、daemon 路由和前端会话状态可在 `runtime/src/store/desktop_conversations.rs`、`runtime/src/daemon/desktop_conversations.rs`、`interfaces/desktop/src/app/service.ts` 查到；会话边缘导航已由 `79bc5b7` 提交。这里只确认代码存在与修改本文档前的工作区状态，不代表本次运行验收。





此前记载的 `runtime/sacode_video_test_28468.mp4` 当前不存在。



## 遗留与阻塞

| 优先级 | 项 |
|---|---|
| 高 | Desktop WebView IPC 命令链路与交互式 GUI 验收；Rust 原生 sidecar/代理与 client-core 的真实 loopback 认证已测，但模型生成、多轮上下文效果未测 |
| 高 | I3 真机联调：keyring 实际读写（`login --insecure-file-secrets` 仅适用于无 keyring 环境，生产默认 OS keyring） |
| 中 | 两套 catalog 形状需 lockstep（登录写 `provider.json` 走 runtime `provider_bridge`，与 CLI store 并存），宜后续收敛为一套 |
| 中 | 评估 Desktop 开发依赖 Vite / esbuild 的 npm 审计告警（1 高、1 中），评估升级与兼容性后再决定改动 |
| 中 | 核对 Tauri Desktop 的 NSIS/DMG 打包、多 workspace 多 sidecar、远程 TLS daemon、完整 Diff 渲染等历史待办是否仍适用，再逐项验收 |
| 低 | 本次仅完成定向检查；发布前仍需 workspace 级测试与 Tauri 构建验收 |

## 相关文档

- 本仓：[README.md](../README.md) · [AGENTS.md](../AGENTS.md) · [CHANGELOG.md](../CHANGELOG.md) · [docs/README.md](./README.md)
- 专项 spec：[compose/spec/sacode-identity-i3.md](./compose/spec/sacode-identity-i3.md) · [compose/spec/tauri-desktop-m2.md](./compose/spec/tauri-desktop-m2.md)
- 评估与规划：[report.md](./report.md) · [report-plan.md](./report-plan.md) · [plans/](./plans/)
- 产品线：[STATUS.md](../../docs/STATUS.md) · [design-sacode.md](../../docs/clients/design-sacode.md)

## 维护约定

行为或状态变化时**先改本文件**，再同步 `README.md` 与产品线 `docs/`，避免漂移。

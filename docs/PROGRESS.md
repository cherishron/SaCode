# SaCode 进度（当前实际状态）

> 更新：2026-09-27 · 分支 `dev`
>
> **本轮增量（Desktop 多轮会话，工作区尚未提交）**：Desktop 会话持久化与多轮上下文已落地。后端新增 `desktop_turns` SQLite 表和 `/api/desktop/conversations` CRUD 路由（list/get/create/append/delete），会话内续发注入最近 12 轮用户消息与助手输出（超 32000 字符拒绝），上一轮未结束时续发返回 409。派发失败时事务化回滚 `desktop_turns`/`tasks`/`task_changes`，不残留孤儿记录。删除会话级联取消队列与执行器任务、清理审批、移除内存与 SQLite 记录，重启后不复活。前端侧栏显示会话列表（localStorage 自定义排序），分屏切换同步 `currentConversationId`/`conversationTurns`，输入框按会话最后一轮状态禁用，新建任务后自动打开分屏。**本轮实测**：daemon 定向测试 41/41（含两轮持久化+重启恢复+删除级联+技能拒绝四项端到端）；Rust 库测试排除外部 `live_opencode_acp_probe_and_prompt` 后 **788 通过、1 忽略**；client-core **24/24**、Desktop **29/29**，两处 TS typecheck、Vite Web 构建（输出 `D:\temp\SaCode\desktop-web-build`）均通过。已用隔离 `create_daemon_in(tempdir)` 做路由层 HTTP 端到端测试；**未验证**真实监听端口与认证请求、交互式 Desktop GUI 和 Tauri 打包。以下历史记录不代表本轮验证结论。
> 本文件是该仓的**进度单一真源**；产品线级总览见 [`../../docs/STATUS.md`](../../docs/STATUS.md)。
> 状态词汇遵循 [`../../docs/README.md`](../../docs/README.md)。
> 与 [`README.md`](../README.md)（是什么 / 怎么用）分工：本文件只回答**已经做到哪、验证到什么程度**。

## 一句话状态

**离线 CLI/TUI 编码助手与统一身份客户端（I3）已落地；Tauri Desktop M2 和知识库/自动化增量仍有未提交改动。** 本轮知识库/自动化验证见上方实测摘要；下表保留旧版 I3/M2 专项 spec 的历史记录，**这些旧结论本轮未独立复核**。

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
| Tauri Desktop M2 | sidecar 持 token + IPC 代理 + MVP UI（session/approval/changes/settings） | 已交付（未提交） |
| ACP 后端 | `interfaces/acp` + `integrations/acp`；OpenCode ACP 接入 | 已落地 |
| Task protocol v1 | 验收记录 + 结构化失败分类 | 已落地 |

## 验证状态

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

## 未提交的工作区变更（风险项）

工作区**脏**，全部为本次盘点实测所得：

**已修改（tracked）**：`Cargo.toml` · `Cargo.lock` · `interfaces/cli/src/cmd/account.rs` · `interfaces/client-core/tsconfig.json` · `interfaces/desktop/src-tauri/{Cargo.toml,src/main.rs,src/sidecar.rs,tauri.conf.json}` · `interfaces/desktop/src/{main.ts,styles.css,tauri-bridge.ts}` · `runtime/src/identity/{config,mod,pkce,service,session}.rs`

**未跟踪（untracked）**：`docs/compose/spec/tauri-desktop-m2.md` · `interfaces/desktop/src-tauri/{capabilities/,gen/,icons/}` · `interfaces/desktop/src/{app/,dom.ts,ipc-transport.ts}` · `interfaces/desktop/test/ipc-transport.test.ts` · `runtime/src/identity/headless.rs` · `scripts/smoke-device.ps1`

**垃圾文件（建议清理）**：`runtime/sacode_video_test_28468.mp4`

> ⚠️ 未提交 = 无版本保护。建议尽快按主题拆分为两个提交：**I3 身份客户端增量** 与 **Tauri Desktop M2**。提交策略归仓库所有者。

## 遗留与阻塞

| 优先级 | 项 |
|---|---|
| 高 | 提交上述未提交变更；清理 `runtime/` 下的测试视频垃圾文件 |
| 高 | I3 真机联调：keyring 实际读写（`login --insecure-file-secrets` 仅适用于无 keyring 环境，生产默认 OS keyring） |
| 中 | 两套 catalog 形状需 lockstep（登录写 `provider.json` 走 runtime `provider_bridge`，与 CLI store 并存），宜后续收敛为一套 |
| 中 | Tauri Desktop：NSIS/DMG 发布打包门禁、多 workspace 多 sidecar、远程 TLS daemon、完整 Diff 渲染（当前 Changes 为工具事件卡片）均未做 |
| 低 | 本次未做全量构建/测试复核，建议在提交前跑一次 workspace 级 `cargo test` 并回填本节 |

## 相关文档

- 本仓：[README.md](../README.md) · [AGENTS.md](../AGENTS.md) · [CHANGELOG.md](../CHANGELOG.md) · [docs/README.md](./README.md)
- 专项 spec：[compose/spec/sacode-identity-i3.md](./compose/spec/sacode-identity-i3.md) · [compose/spec/tauri-desktop-m2.md](./compose/spec/tauri-desktop-m2.md)
- 评估与规划：[report.md](./report.md) · [report-plan.md](./report-plan.md) · [plans/](./plans/)
- 产品线：[STATUS.md](../../docs/STATUS.md) · [design-sacode.md](../../docs/clients/design-sacode.md)

## 维护约定

行为或状态变化时**先改本文件**，再同步 `README.md` 与产品线 `docs/`，避免漂移。

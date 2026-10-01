# SaCode 进度（当前实际状态）

> 更新：2026-09-28 · 分支 `dev`（当前核对：`5c6bdf9`）
>
> 本文件是该仓的**进度单一真源**；产品线级总览见 [`../../docs/STATUS.md`](../../docs/STATUS.md)。
> 状态词汇遵循 [`../../docs/README.md`](../../docs/README.md)。
> 与 [`README.md`](../README.md)（是什么 / 怎么用）分工：本文件只回答**已经做到哪、验证到什么程度**。

## 一句话状态

**统一身份双客户端、Vue 账号/权益/License/设备激活、文件抽屉、SaDesign/SaNative/自动化后端均已落地。** 本地三件套（sa-idp:8080 / gateway-rs:8090 / sa-entitlement:8091）已可启动就绪；**Vue 新壳仍缺 SaDesign/知识库/自动化入口与设置四页**，GUI 真机登录验收未完成。

## workspace 结构

```toml
members = [
  "kernel", "runtime",
  "interfaces/cli", "interfaces/acp", "interfaces/lsp",
  "integrations/acp",
  "interfaces/desktop/src-tauri",
]
```

界面覆盖：终端（CLI/TUI/REPL）、VSCode 扩展、Desktop（Tauri + Vue）。`interfaces/client-core`（TS）与 `sdk/`、`npm-package/` 为独立发布单元。

## 已落地（含本轮 desktop-backend-wiring）

| 能力 | 位置 | 状态 |
|---|---|---|
| 统一身份客户端（OIDC + PKCE） | `runtime/src/identity/*` | 已落地 |
| **双客户端权益 token**（`sacode` aud=saai-api + `sacode-ent` aud=saai-entitlement） | `identity/entitlement_token.rs` + sa-idp `apply_sacode_ent_client` | 已落地 |
| **权益查询** `GET /v1/entitlements/me` | `identity/entitlement_client.rs`；daemon `/account/entitlements` | 已落地 |
| **License v1 离线验签**（Ed25519 + JCS + 域分离） | `identity/license.rs`；`/account/license` | 已落地 |
| **设备指纹 + 激活请求 v1** | `identity/device_fingerprint.rs`；`/account/activation-request` | 已落地 |
| **企业审计导出门禁** `sacode_audit_export` | `daemon/audit_export.rs` → `/api/audit/export` | 已落地 |
| Vue Settings 账号页（登录/同步/退出/权益/License/激活） | `interfaces/desktop/src/ui/components/SettingsView.vue` | 已落地 |
| 文件抽屉：文件夹优先排序、彩色图标、代码高亮 / Markdown 预览 | `FilesSidePanel` + `file-kind` + `FileGlyph` | 已落地 |
| Desktop 会话持久化 / 分屏 / sidecar 代理 | `desktop_conversations` + `src-tauri` | 已落地 |
| **SaDesign 设计工作台后端** | `daemon/design.rs` + `design_patch.rs` → `/api/design/*` | 已落地 |
| **SaNative 知识库后端** | `daemon/knowledge.rs` → `/api/knowledge/*` | 已落地 |
| **自动化规则/调度后端** | `daemon/automation.rs` + `scheduler.rs` + SQLite | 已落地 |
| CLI 账号命令 / Device grant / keyring | I3 既有 | 已落地 |

## 前后端对照（Desktop）

| 能力 | 后端 | 旧 UI (`src/app`) | Vue (`src/ui`) |
|---|---|---|---|
| 会话 / 任务 / 提问 / 附件 | `/api/desktop/*` `/task/*` | 有 | **有** |
| 文件树 / 预览 | `/workspace/*` | 有 | **有**（排序/图标/代码/MD） |
| 终端 PTY | Tauri invoke | 有 | **有** |
| 账号 / 模型同步 | `/account/*` | 有 | **有** |
| 权益 / License / 激活 / 审计导出 | `/account/*` `/api/audit/export` | 部分 | **账号页有**（审计导出按钮未挂） |
| MCP / 技能 | `/api/mcp/*` `/api/skills*` | 有 | **有** |
| 模型与执行 / Git / 安全扫描 / 配置导入 | providers · git-auth · audit · import | 有 | **占位** |
| SaDesign | `/api/design/*` | 有 | **无** |
| SaNative 知识库 | `/api/knowledge/*` | 有 | **无** |
| 自动化 | `/api/automation/*` | 有 | **无** |

### 新增 daemon 端点

| 路径 | 用途 |
|---|---|
| `GET /account/entitlements?product=` | 本人权益（401 + `needs_entitlement_auth` 表示需二次授权） |
| `POST /account/entitlement-login` | `sacode-ent` PKCE 二次登录 |
| `GET/POST /account/license` | License 状态 / 导入 |
| `POST /account/activation-request` | 设备激活请求 v1 |
| `POST /api/audit/export` | 企业审计导出（能力门禁） |

### 配置

- `SACODE_ENTITLEMENT_BASE_URL`（默认 `http://127.0.0.1:8091`）
- `SACODE_ENTITLEMENT_CLIENT_ID`（默认 `sacode-ent`）
- `SACODE_LICENSE_PUBLIC_KEYS`（`kid=base64url32;...`，离线验签公钥；未配置则 fail-closed）

## 验证状态

### 2026-09-28 desktop-backend-wiring + 三件套冒烟

| 检查 | 结果 |
|---|---|
| `cargo test -p sacode-runtime identity` | 49 passed |
| `cargo test -p sacode-runtime daemon` | 81 passed |
| client-core typecheck / build | PASS |
| desktop typecheck / test / vite build | 80 tests PASS |
| Tauri `cargo build --release` | `target/release/sacode-desktop.exe` |
| 本地三件套 readyz | sa-idp ready · gateway-rs ok（`.env.local`）· sa-entitlement ready |
| `apply_sacode_ent_client` | 入库成功：aud=`saai-entitlement` |
| `GET /v1/entitlements/me` 无 token | 401（预期） |
| `smoke-oauth.ps1 -ClientId sacode-ent` | 注册 PASS；登录 **429 限流** 未跑通 PKCE |

### 2026-09-27 历史定向复测（沿用）

真实端口 client-core ↔ daemon 与 Tauri sidecar 代理曾通过；**模型生成与交互式 GUI 未测**。

### 服务端依赖

- sa-idp：`sacode` / `sacode-ent` PKCE；per-client `access_token_audience`（迁移 `20260925000006`）
- gateway-rs：`/api/auth/exchange`、`/v1/models`
- sa-entitlement：`GET /v1/entitlements/me`（aud `saai-entitlement` + `entitlement:read`）

## 构建与运行（桌面）

```powershell
# Web
cd interfaces/client-core; npm run build
cd ../desktop; npm run build

# Tauri 壳
cargo build --manifest-path interfaces/desktop/src-tauri/Cargo.toml --release

# 运行
$env:SACODE_BINARY_PATH = "D:\Project\sa\saai\sa-code\target\debug\sacode.exe"
.\target\release\sacode-desktop.exe
# 或开发：cd interfaces/desktop; npm run dev
```

## 遗留与阻塞 / 接下来

| 优先级 | 项 |
|---|---|
| **高** | **GUI 真机验收**：账号登录 → 同步模型 → 授权权益 → 权益列表；License 导入 / 激活请求 |
| **高** | 绕过或放宽登录限流后跑 `smoke-oauth.ps1`（sacode / sacode-ent）PKCE 全链路 |
| **高** | **Vue 迁入 SaDesign / SaNative / 自动化**（后端已齐，UI 在旧壳） |
| 中 | Vue 设置四页：模型与执行 / Git / 安全扫描 / 配置导入（API 已有） |
| 中 | 账号页挂上「企业审计导出」按钮（`POST /api/audit/export`） |
| 中 | 主登录后自动串 `sacode-ent`；License 公钥内置 + kid 轮换 |
| 中 | keyring 真机；provider catalog 收敛；Vite/esbuild 告警 |
| 低 | Tauri NSIS 打包；完整 workspace 测试与发布门禁 |

## 相关文档

- 本仓：[README.md](../README.md) · [AGENTS.md](../AGENTS.md) · [docs/README.md](README.md)
- 本轮 spec：[compose/spec/desktop-backend-wiring.md](specs/spec-desktop-backend-wiring.md)
- 既有：[compose/spec/sacode-identity-i3.md](specs/spec-sacode-identity-i3.md) · [compose/spec/tauri-desktop-m2.md](specs/spec-tauri-desktop-m2.md)
- 布局：[plans/desktop-layout-contract.md](plans/plan-desktop-layout-contract.md)
- 产品线：[STATUS.md](../../docs/STATUS.md) · [local-dev.md](../../docs/guides/local-dev.md) · [licensing/](../../docs/licensing)

## 维护约定

行为或状态变化时**先改本文件**，再同步 `README.md` 与产品线 `docs/`，避免漂移。

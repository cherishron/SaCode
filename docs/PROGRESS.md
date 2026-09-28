# SaCode 进度（当前实际状态）

> 更新：2026-09-28 · 分支 `dev`（当前核对：`6cc8fb5`，修改本文档前工作区仅剩 `.probe.txt` 未跟踪）
>
> 本文件是该仓的**进度单一真源**；产品线级总览见 [`../../docs/STATUS.md`](../../docs/STATUS.md)。
> 状态词汇遵循 [`../../docs/README.md`](../../docs/README.md)。
> 与 [`README.md`](../README.md)（是什么 / 怎么用）分工：本文件只回答**已经做到哪、验证到什么程度**。

## 一句话状态

**统一身份双客户端（sa-idp + saaiapigateway + sa-entitlement）、Vue 工作台账号/权益/License/设备激活、文件抽屉增强均已纳入 `dev` 并推送到 Gitee。** 桌面 release 二进制已可构建运行；交互式 GUI 与真实后端三件套联调仍是验收重点。

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
| CLI 账号命令 / Device grant / keyring | I3 既有 | 已落地 |

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

### 2026-09-28 desktop-backend-wiring

| 检查 | 结果 |
|---|---|
| `cargo test -p sacode-runtime identity` | 49 passed |
| `cargo test -p sacode-runtime daemon` | 81 passed |
| client-core `npm run typecheck` / `build` | PASS |
| desktop `npm run typecheck` | PASS |
| desktop `npm test` | 80 passed |
| desktop `npm run build`（Vite） | PASS |
| `cargo build --manifest-path interfaces/desktop/src-tauri/Cargo.toml --release` | PASS → `target/release/sacode-desktop.exe` |

审查修复：设备绑定 License 导出改为带本地 fingerprint；在线权益按 status + 有效期过滤后再授予权限。

### 2026-09-27 历史定向复测（沿用）

见 git 历史与 `docs/compose/spec/desktop-backend-wiring.md`、`sacode-identity-i3.md`。真实端口 client-core ↔ daemon 与 Tauri sidecar 代理曾通过；**模型生成与交互式 GUI 未测**。

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
| **高** | **真机联调**：sa-idp `:8080` + gateway-rs `:8090` + sa-entitlement `:8091` 跑通 login → models → entitlements/me；应用 `sacode-ent` / audience 迁移 |
| **高** | Desktop 交互式 GUI 验收（账号页登录、License 导入、激活请求、审计导出） |
| 高 | I3 keyring 真机读写验收 |
| 中 | License 公钥注册正式化（目前 env 注入；生产内置公钥集 + kid 轮换） |
| 中 | `sacode-ent` 主登录后自动串联二次授权（当前需点「授权权益」） |
| 中 | 两套 provider catalog 收敛；Vite/esbuild 依赖告警 |
| 中 | Tauri NSIS 打包、多 workspace 多 sidecar、Diff 渲染完善 |
| 低 | 完整 workspace 级 `cargo test --workspace` 与发布门禁 |

## 相关文档

- 本仓：[README.md](../README.md) · [AGENTS.md](../AGENTS.md) · [docs/README.md](./README.md)
- 本轮 spec：[compose/spec/desktop-backend-wiring.md](./compose/spec/desktop-backend-wiring.md)
- 既有：[compose/spec/sacode-identity-i3.md](./compose/spec/sacode-identity-i3.md) · [compose/spec/tauri-desktop-m2.md](./compose/spec/tauri-desktop-m2.md)
- 布局：[plans/desktop-layout-contract.md](./plans/desktop-layout-contract.md)
- 产品线：[STATUS.md](../../docs/STATUS.md) · [local-dev.md](../../docs/guides/local-dev.md) · [licensing/](../../docs/licensing/)

## 维护约定

行为或状态变化时**先改本文件**，再同步 `README.md` 与产品线 `docs/`，避免漂移。

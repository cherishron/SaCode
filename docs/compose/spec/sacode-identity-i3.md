---
feature: sacode-identity-i3
status: delivered
updated: 2026-09-20
branch: dev
commits: 35bacb0 (feat(saai): I3 identity client, OpenCode ACP backend, client-core, desktop sidecar); 后续增量仍留在工作区未提交 — 见 docs/PROGRESS.md
---

# SaCode 统一身份客户端（I3 · sa-idp OIDC）

## Report

**What was built** — SaCode I3 客户端骨架：以 **sa-idp 独立 IdP** 为真源的 OIDC 授权码 + PKCE 登录链路。新增 `runtime/src/identity/*`（配置、PKCE、token/网关 HTTP、SecretStore、session、loopback callback、login 编排）；`kernel` 扩展 `SecretRefKind::OsKeyring`；`provider.json` 的 `sa-ai` 条目 `api_key` 恒为空、仅写 `secret_ref`；CLI 新增 `sacode account login|status|logout|models`（含 `--dry-run`）。既有手动 `/login` Provider 向导保持兼容。`docs/product/unified-identity-prd.md` 升为 v2，废弃网关内嵌身份路径。

服务端：sa-idp **已实现** `/oauth/authorize` `/oauth/token`（I3 e2e PASS）；gateway-rs **已实现** `/api/auth/exchange`。客户端按上述契约 + Memory mock 测试。

**Verification**
- `cargo check -p sacode-kernel -p sacode-runtime -p sacode-cli` — PASS
- `cargo test -p sacode-runtime identity` — 17 passed
- `cargo test -p sacode-cli --lib parse_args_parses_account_subcommand` — 1 passed
- `cargo test -p sacode-cli --lib provider_store` / `provider_config` — 4+13 passed
- `cargo test -p sacode-kernel --lib` — 53 passed

**Journey log**
1. SaCode 旧 PRD（网关 `/api/auth/*` 直接回 api_key）与产品线 sa-idp 设计冲突；v2 已对齐 OIDC 真源。
2. 用户确认主工作区 + 脏文件并存；Compose 默认 worktree 被显式覆盖，提交策略留给用户。
3. 审查后修复：CLI flag > env 优先级、models 失败可见、secret 解析多后端回退（keyring→file→env）、session 拒写明文、config.json 路径保留 secret_ref、PKCE 去模偏置、logout revoke 带 token。
4. 登录写 `provider.json` 走 runtime `provider_bridge`（非 CLI store）；两套 catalog 形状需 lockstep，后续宜收敛。
5. `login --insecure-file-secrets` 仅适合无 keyring 环境；生产默认 OS keyring。

## [S1] Problem

SaCode 目前只有手动 Provider 配置（`/login` 写入 `base_url` + 明文 `api_key` 到 `.sacode/provider.json`）。saai 产品线已确定独立 IdP 模型：**sa-idp 管认证（OIDC + PKCE）**，**SaAiApiGateway 管数据面 api_key / 模型路由**。

产品线路线图 I3 要求 SaCode：

1. 以 OAuth2 公开客户端（`client_id=sacode`）走 sa-idp 授权码 + PKCE；
2. 用 access_token 向网关换数据面 api_key（`sa-xxx`）；
3. api_key / refresh_token **存系统 keyring**，配置文件只留 `secret_ref`；
4. 拉取 `GET /v1/models` 写入可用模型与 default_model（登录即用）。

约束：**sa-idp I0/I1 业务端点尚未上线**，网关换钥契约也未实现。本次交付 **SaCode 客户端完整骨架 + 契约 mock 测试**。

## [S2] Design

### S2.1 真源与角色

| 项 | 结论 |
|---|---|
| 身份真源 | `E:\Project\sa\saai\docs\unified-identity.md` + `sa-idp`（独立 IdP） |
| 废弃 | SaCode 旧 PRD 中「网关 `POST /api/auth/login/*` 直接返回 api_key」路径 |
| SaCode 角色 | OAuth2/OIDC **公开客户端**（PKCE，`token_endpoint_auth_method=none`） |
| 网关角色 | 资源服务器：签发/绑定数据面 api_key，提供 `/v1/*` |
| 工作区 | 主工作区 `E:\Project\sa\saai\SaCode`（用户确认，分支 `dev`） |

### S2.2 端点契约（客户端侧 · 已与 sa-idp / gateway-rs 对齐）

**sa-idp** — 真源 `sa-idp routes.rs`（**非** `/oauth2/*`）：

| 用途 | 路径 |
|---|---|
| Authorize | `GET {idp}/oauth/authorize` |
| Token | `POST {idp}/oauth/token` |
| JWKS | `GET {idp}/oauth/jwks` |
| Revoke | `POST {idp}/oauth/revoke`（可选） |

Authorize：`response_type=code`、`client_id=sacode`、`redirect_uri`、`scope=openid profile offline_access`、`state`、`nonce`、`code_challenge`、`code_challenge_method=S256`。

Token code：`grant_type=authorization_code` + `code` + `redirect_uri` + `client_id` + `code_verifier`。

Token refresh：`grant_type=refresh_token` + `refresh_token` + `client_id`。

响应字段：`access_token`、`token_type`、`expires_in`、`refresh_token`、`id_token`（可选）。

**网关**

| 用途 | 路径 |
|---|---|
| 换 api_key | `POST {gateway}/api/auth/exchange`（**非** 旧值 `/api/identity/gateway-key`） |
| 拉模型 | `GET {gateway}/v1/models` |

换钥响应：`api_key`（`sa-`）、可选 `prefix`/`id`。`/v1/models` 为 OpenAI 兼容 `data[].id`。

代码常量：`runtime/src/identity/mod.rs`（`IDP_*`、`GATEWAY_KEY_EXCHANGE_PATH`）。

IdP 公开客户端 loopback 任意端口（RFC 8252）；服务端迁移 `0002` 更新 sacode redirect。

e2e：`scripts/e2e-identity-i3.ps1`（模拟浏览器 authorize + cookie）。

### S2.3 配置

用户级：`~/.sacode/identity/config.json`（无密钥）。优先级：**CLI flag > env > 文件 > 默认**。

| 环境变量 | 字段 |
|---|---|
| `SACODE_IDP_BASE_URL` | idp_base_url |
| `SACODE_GATEWAY_BASE_URL` | gateway_base_url |
| `SACODE_IDENTITY_CLIENT_ID` | client_id |

`redirect_uri` 为空时监听 `http://127.0.0.1:{ephemeral}/callback`。

### S2.4 密钥存储

| 材料 | locator |
|---|---|
| 网关 api_key | `os-keyring:sacode/identity/gateway-api-key` |
| refresh_token | `os-keyring:sacode/identity/refresh-token` |

**安全基线**：

1. `provider.json` 中 sa-ai 条目 `api_key` 必须为空，仅 `secret_ref`。
2. refresh_token / gateway api_key 不得写入项目配置 JSON。
3. 日志脱敏；session 拒绝写入疑似明文。
4. 解析顺序（无注入 store）：OS keyring → FileSecretStore（insecure 模式）→ env 逃生舱。

### S2.5 会话文件

`~/.sacode/identity/session.json` — 仅 refs + 元数据，**不含**明文 api_key / refresh_token。

### S2.6 模块布局

| 位置 | 职责 |
|---|---|
| `kernel/src/model/provider.rs` | `SecretRefKind::OsKeyring` |
| `runtime/src/identity/*` | OIDC/gateway/keyring/session/编排 |
| `interfaces/cli/src/cmd/account.rs` | CLI |
| `provider_config` / `provider_runtime` | secret_ref 解析链路 |

### S2.7–S2.8 命令与编排

`sacode account login|status|logout|models`；`--dry-run` 不触网。与手动 `/login` 并存。

### S2.10 测试策略

Memory store + dyn mock HTTP；PKCE RFC 向量；session/provider.json 无明文断言；CLI parse 测试。

## [S3] Out of Scope

- sa-idp / 网关服务端实现
- 微信/短信登录、TUI/Desktop UI
- 强制迁移全部历史 provider
- P1 群组多租户
- 生产 IdP/Gateway 真实地址联调

## Tasks

- [x] T1: kernel SecretRef OsKeyring + ProviderConfig.secret_ref — acceptance: 序列化/加载兼容旧 JSON (covers: S2.4, S2.9)
- [x] T2: SecretStore trait + Memory 后端 + 文件会话 — acceptance: 无 keyring 可 mock 登录；session.json 无明文 (covers: S2.4, S2.5, S2.10)
- [x] T3: PKCE + OIDC token 客户端 — acceptance: S256 向量 + mock 兑换/刷新 (covers: S2.2, S2.7)
- [x] T4: 网关换钥 + models 客户端 — acceptance: mock 换 sa-key 并解析 models (covers: S2.2)
- [x] T5: login/logout/status/models 编排 + provider 写入 — acceptance: sa-ai api_key 空 + os_keyring secret_ref (covers: S2.7, S2.8, S2.9)
- [x] T6: CLI `sacode account` 子命令与 help — acceptance: parse_args + dry-run (covers: S2.3, S2.8)
- [x] T7: 文档对齐 unified-identity-prd → sa-idp 真源 — acceptance: v2 OIDC，废弃网关内嵌路径 (covers: S2.11)
- [x] T8: 验证 cargo test（相关包）— acceptance: 上表命令通过 (covers: S2.10)
- [x] T9: 独立审查并修复 Major 项 — acceptance: flag/env 优先级、models 告警、多后端 secret 解析、session 拒写、config secret_ref、PKCE 偏置、revoke token (covers: S1–S2)

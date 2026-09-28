---
feature: desktop-backend-wiring
status: delivered
updated: 2026-09-28
branch: dev
commits: d804a39..70593f3
---

# Vue 工作台全量接入后端（sa-idp · saaiapigateway · sa-entitlement / License）

## Report

**What was built** — 身份/权益双客户端链路与 Vue 账号页：新增 OAuth 客户端 `sacode-ent`（aud=saai-entitlement）注册示例；`IdentityConfig` 扩展 `entitlement_base_url` / `entitlement_client_id`；`entitlement_token` 支持权益 token 存取与 refresh；`entitlement_client` 对接 `GET /v1/entitlements/me`；daemon 新增 `/account/entitlements`、`/account/entitlement-login`、`/account/license`、`/account/activation-request`、`/api/audit/export`；Vue Settings「账号」页实现登录/同步/退出与权益列表；License v1 解析+Ed25519 验签（JCS + 域分离）；设备指纹 v1 与激活请求导出；企业审计导出按 `sacode_audit_export` 门禁（缺失能力仅拒绝导出）。

**Verification**
- `cargo test -p sacode-runtime identity` — 49 passed
- `cargo test -p sacode-runtime daemon` — 81 passed
- `interfaces/client-core` `npm run typecheck` — PASS
- `interfaces/desktop` `npm run typecheck` — PASS
- `interfaces/desktop` `npm test` — 80 passed

**Journey log**
1. sa-idp audience 按 OAuth client 固定，网关 `sacode` 与权益 `sacode-ent` 必须双 token。
2. 权益服务不可达 / 未授权不得阻断登录与模型同步。
3. License 无公钥注册表时 fail-closed，不把「仅解析通过」当成能力授予。
4. 审查修复：设备绑定 License 须带本地 fingerprint 验签；在线权益能力按 status+有效期过滤后再授予。

## [S1] Problem

SaCode 的统一身份客户端（I3）与 daemon `/account/*` 已落地，但 **Vue 工作台**（`interfaces/desktop/src/ui/`）仍未真正接上产品线后端：

1. Settings 导航有「账号」，**内容为空**，无法登录/退出/同步模型。
2. 模型选择、执行链路依赖本地 daemon，但 **网关 api_key / `/v1/models`** 未在工作台形成闭环验收。
3. **sa-entitlement 权益与 License 完全未接入**：无法查询 `GET /v1/entitlements/me`、无法展示/导入 License、无设备激活请求、`sacode_audit_export` 无门禁。
4. 产品线契约在外层 `D:\Project\sa\saai\docs\`（identity / gateway / licensing），客户端不得偏离。

## [S2] Design

### S2.1 真源与职责边界

| 服务 | 回答 | 客户端用法 |
|---|---|---|
| **sa-idp** | 你是谁 | OIDC 授权码 + PKCE（`client_id=sacode`）；Device grant 可选 |
| **SaAiApiGateway (gateway-rs)** | 能调什么模型 | `POST /api/auth/exchange` 换 `sa-*` api_key → `/v1/models`、`/v1/chat/completions` |
| **sa-entitlement** | 获授了什么能力 | `GET /v1/entitlements/me`（`entitlement:read`）；License 离线验签（客户端） |

产品 ID：`sacode`。首批 capability：`sacode_audit_export`（只门禁「企业审计导出」；**不得**阻塞基础启动、登录、模型同步、普通 `sacode audit`）。

### S2.2 Token 与 audience（关键契约）

sa-idp **按 OAuth client 固定** `access_token_audience`（见 `sa-idp/backend/src/domain/oauth_client.rs`）：

| client_id | aud | 用途 |
|---|---|---|
| `sacode` | `saai-api`（默认） | 网关 exchange / `/v1/*` |
| `sa-entitlement-admin` | `saai-entitlement` | 权益管理台（admin） |
| **`sacode-ent`（本特性新增）** | `saai-entitlement` | SaCode 读本人权益 |

**设计决策**：注册公开客户端 `sacode-ent`（PKCE，`token_endpoint_auth_method=none`），`allowed_scopes` 含 `openid profile offline_access entitlement:read`，`access_token_audience=saai-entitlement`。

登录编排（`runtime/src/identity/service.rs` 扩展）：

1. 主链路：`sacode` PKCE → access_token(aud=saai-api) → gateway exchange → api_key → `/v1/models`（既有 I3）。
2. 权益链路：IdP 会话 cookie 已建立后，对 `sacode-ent` 再做一次 PKCE authorize（浏览器无感或极短交互）→ access_token(aud=saai-entitlement) + refresh → 存 keyring（locator `os-keyring:sacode/identity/entitlement-token` / `entitlement-refresh`）。
3. 权益 token 过期用 refresh；失败则 UI 提示「权益需重新授权」，**不阻断**网关模型功能。

密钥仍不落明文：`provider.json` 仅 `secret_ref`；session 文件拒写明文（沿用 I3 基线）。

### S2.3 Vue 工作台接线（`interfaces/desktop/src/ui`）

**Settings「账号」页**（`SettingsView.vue` 补齐，复用 `DesktopApp` / client-core）：

| 操作 | 调用 | 展示 |
|---|---|---|
| 登录 | `POST /account/login` → 轮询 `GET /account/status` | `login_state`、`AccountStatus` |
| 状态 | `GET /account/status` | `logged_in`、`subject`、`provider_name`、`models_count`、`gateway_base_url` |
| 同步模型 | `POST /account/sync-models` | 模型数变化反馈 |
| 退出 | `POST /account/logout` | 清理 UI 会话态 |
| IdP / 网关地址 | 身份配置（`IdentityConfig`）读写 | 只读展示 + 允许改 `idp_base_url`/`gateway_base_url`（经 daemon 代理写入 `~/.sacode/identity/config.json`） |

**权益区块**（账号页内）：

- `GET /account/entitlements`（daemon 新路由）→ `GET {entitlement}/v1/entitlements/me?product=sacode`
- 列表展示 entitlement / capabilities / 有效期；未知 capability **忽略且不扩权**
- License：导入 `.lic` / license JSON（按 `docs/licensing/license-format-v1.md`）、显示状态（valid/expired/revoked 未知时显示 offline-check 结果）
- 设备激活：生成 `saai-device-activation-request/v1` JSON 导出（ENT-09），便于企业内网离线签发

**模型选择**：Composer / NewTaskForm 的模型列表来自 `getWorkspaceCapabilities().models`（已含 identity merge）；登录后 `accountSyncModels` 触发刷新。

### S2.4 Daemon 侧新增（`runtime/src`）

| 模块 | 职责 |
|---|---|
| `identity/entitlement_client.rs` | HTTP：`GET /v1/entitlements/me`，Bearer entitlement access_token |
| `identity/license.rs` | License 文件解析（schema/alg/kid）、Ed25519 验签（内置公钥集）、claims 校验（product/exp/subject/device） |
| `identity/device_fingerprint.rs` | device_secret（OS keyring）+ fingerprint v1 + 激活请求 JSON |
| `daemon/account.rs` 扩展 | `/account/entitlements`、`/account/license`（GET/POST 导入）、`/account/activation-request` |
| `daemon/audit_export.rs` | 企业审计导出：**先查 capability `sacode_audit_export`**，无则 403 + 可操作错误；有则导出 `audit.log` 受限集 |

依赖方向不变：`interfaces → runtime → kernel`。License 验签纯逻辑可放 `kernel`（若需单测无 IO）。

### S2.5 配置

扩展 `IdentityConfig`：

| 字段 / env | 含义 |
|---|---|
| `entitlement_base_url` / `SACODE_ENTITLEMENT_BASE_URL` | 默认 `http://127.0.0.1:8091`（local-dev 建议端口；与 gateway 8090 区分） |
| `entitlement_client_id` / `SACODE_ENTITLEMENT_CLIENT_ID` | 默认 `sacode-ent` |

本地联调端口约定（真源 `saai/docs/guides/local-dev.md`）：sa-idp `8080`、gateway-rs `8090`、sa-entitlement `8091`。**Issuer 必须是 `http://127.0.0.1:8080` 字面量。**

### S2.6 失败与门禁行为

| 场景 | 行为 |
|---|---|
| 未登录 | 账号页显示未登录；模型用本地 provider；权益区空态 |
| 网关 models 空 | 沿用 `model_status` 文案，不伪造模型 |
| 权益服务不可达 | 权益区错误提示；**不影响**登录/模型/普通功能 |
| License 缺失/无效/过期 | 仅拒绝 `sacode_audit_export`；基础功能不受影响 |
| 未知 capability | 忽略，不授予额外权限 |

### S2.7 测试边界

- 单测：license 验签向量（篡改/过期/错误 product/未知 kid/设备不匹配失败关闭）；激活请求 schema；capability 门禁；entitlement JSON 解析。
- 客户端契约：daemon 路由 mock sa-entitlement HTTP。
- 联调：本地 `sa-idp` + `gateway-rs` + `sa-entitlement`（8091）跑通 login → models → entitlements/me；**不**在本特性内实现权益 admin 写接口或 License 签发。

## [S3] Out of Scope

- sa-entitlement 管理写接口（创建/续期/终止/签发/吊销，当前 501）与生产 License 私钥
- 支付/订单自动授予（ENT-12）
- 微信/短信真发通道、SSO 密钥申请
- Go 网关对照、Nacos、sa-app 真机
- 把 License 私钥或临时签发逻辑写进 Desktop / sa-idp（禁止）
- 旧版 vanilla UI（`src/app/settings.ts`）全面重写（仅必要时共享 service API）

## Tasks

- [x] T1: 注册 OAuth 客户端 `sacode-ent` 并扩展 IdentityConfig — acceptance: 迁移/示例可写入 `idp_oauth_clients`（aud=saai-entitlement，PKCE，scope 含 entitlement:read）；配置可读 entitlement_base_url/client_id (covers: S2.2, S2.5)
- [x] T2: 双客户端登录编排（sacode + sacode-ent）— acceptance: mock 下主登录成功后权益 token 可获取并入 keyring；refresh 可续期 (covers: S2.2; depends: T1)
- [x] T3: entitlement HTTP 客户端 + daemon `/account/entitlements` — acceptance: mock 返回 items；UI 无关的单元/路由测试通过 (covers: S2.4; depends: T2)
- [x] T4: Vue Settings「账号」页（登录/状态/同步/退出 + 权益列表）— acceptance: 点击登录可轮询状态；权益区展示 capabilities 与有效期；错误可读 (covers: S2.3; depends: T3)
- [x] T5: License 导入 + 本地验签 + 状态展示 — acceptance: 合法 License 通过；篡改/过期/错 product/未知 kid 失败关闭且只影响企业导出 (covers: S2.3, S2.4, S2.6)
- [x] T6: 设备指纹 + 激活请求 v1 导出 — acceptance: 导出 JSON 符合 `device-activation-request-v1.md`；device_secret 只进 keyring (covers: S2.3, S2.4; depends: T5)
- [x] T7: 企业审计导出 + `sacode_audit_export` 门禁 — acceptance: 无能力 403 且基础功能不受影响；有能力可导出受限 audit 记录 (covers: S2.4, S2.6; depends: T5)
- [x] T8: 本地联调与回归 — acceptance: typecheck/tests 通过；有服务时 smoke：login → models → entitlements/me；无服务时 mock 测试仍绿 (covers: S2.7; depends: T4, T7)

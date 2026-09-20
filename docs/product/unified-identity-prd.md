# SaCode 统一账号体系 PRD（sa-idp 对齐）

> 文档状态：**实施中 · I3 客户端骨架已交付**
> 文档版本：v2.0（对齐 saai 产品线独立 IdP 真源）
> 更新时间：2026-09-20
> 适用范围：sa-idp（身份提供方）/ SaAiApiGateway（资源服务器）/ SaCode CLI·Desktop / SaApp / 微信小程序
>
> **真源**：产品线设计以 `E:\Project\sa\saai\docs\unified-identity.md` 与 sa-idp 为准。
> **I3 实现真源**：[docs/compose/spec/sacode-identity-i3.md](../compose/spec/sacode-identity-i3.md)
>
> v1.x 曾描述「网关内嵌身份 + `POST /api/auth/login/*` 直接返回 api_key」。**该路径已废弃**，身份统一由 **sa-idp** 承载，SaCode 作为 OIDC 公开客户端接入。

## 1. 决策摘要（v2）

1. **独立 IdP**：`sa-idp` 管「你是谁」；网关管「你能用什么、扣多少」。
2. **协议**：OIDC / OAuth2 授权码 + **PKCE**；`client_id=sacode`（公开客户端，`token_endpoint_auth_method=none`）。
3. **令牌三件套**：`id_token` + `access_token`(JWT 短命) + `refresh_token`(opaque，keyring 存储，可轮换)。
4. **数据面 api_key 归网关**：登录后用 access_token 换 `sa-xxx`，**不**由 IdP 签发。
5. **登录即用**：换 key → 存 OS keyring → `GET /v1/models` → 写 `provider.json` 的 `sa-ai`（`api_key=""` + `secret_ref`）。
6. **安全基线**：gateway api_key / refresh_token **禁止**明文写配置；仅 `secret_ref`。

## 2. SaCode 客户端流程（I3）

```text
sacode account login
  → OIDC authorize（PKCE S256 + state/nonce）→ 浏览器登录 sa-idp
  → loopback callback → POST {idp}/oauth/token
  → POST {gateway}/api/auth/exchange（Bearer access_token）
  → api_key + refresh_token → OS keyring
  → GET {gateway}/v1/models
  → 写 session.json（仅 refs）+ provider.json 的 sa-ai 条目
```

| 命令 | 说明 |
|---|---|
| `sacode account login` | 统一身份登录（可 `--dry-run`） |
| `sacode account status` | 会话状态（脱敏） |
| `sacode account logout [--revoke]` | 本地清理（可选远端 revoke） |
| `sacode account models` | 拉取网关模型列表 |

配置：`~/.sacode/identity/config.json`；环境变量 `SACODE_IDP_BASE_URL` / `SACODE_GATEWAY_BASE_URL` / `SACODE_IDENTITY_CLIENT_ID`。

既有 TUI/REPL `/login` **仍保留**，用于手动配置自定义 OpenAI 兼容 Provider，与产品线 `sa-ai` 身份条目并存。

## 3. 服务端契约（2026-09-20 已落地）

| 端点 | 归属 | 状态 |
|---|---|---|
| `GET /.well-known/openid-configuration` | sa-idp | ✅ `sa_idp_stage=oauth-core` |
| `GET /oauth/authorize` | sa-idp | ✅ 授权码 + PKCE S256 |
| `POST /oauth/token` | sa-idp | ✅ authorization_code / refresh_token |
| `GET /oauth/jwks` | sa-idp | ✅ |
| `POST {gateway}/api/auth/exchange` | SaAiApiGateway | ✅ gateway-rs（原规划 `/api/identity/gateway-key` 已废弃） |
| `GET {gateway}/v1/models` | SaAiApiGateway | ✅ api_key 认证 |

> 路径以 **sa-idp `routes.rs` / gateway-rs** 为准：`/oauth/*`（非 `/oauth2/*`）。

## 4. 验收（产品线 P0 · 与 SaCode 相关）

1. 同一账号在多端登录归一到同一 `users.id`（依赖 sa-idp）。
2. **SaCode 登录后无需手动配置 Provider 即可用网关模型；api_key 在 keyring，provider.json 无明文。**
3. `logout-all` 后 refresh 失效（session_epoch，依赖 sa-idp）。
4. 网关现有 `/api/admin/*` 与 `/v1/*` 行为零回归。

## 5. 与旧文档关系

- 网关内嵌身份方案（v1）**废弃**，不再作为实现依据。
- 建库脚本与身份表结构真源见 sa-idp `migrations/` 与产品线 `unified-identity.md`。
- Desktop 凭据/keyring 约定与本 PRD 一致（`secret_ref`，见 desktop-multi-agent-prd §12.1）。

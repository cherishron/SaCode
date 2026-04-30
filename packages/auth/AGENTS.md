# @sacode/auth

> 认证模块 — 本地认证 + OAuth 5 提供商 + 中间件

---

## 子目录映射

| 目录 | 职责 |
|------|------|
| `types/` | 共享类型定义（User, AuthResult, OAuthConfig 等） |
| `local/` | 本地认证服务 — bcrypt 密码验证 + JWT Token |
| `oauth/` | OAuth 提供商实现（5 个） |
| `middleware/` | Express 认证中间件 |

## OAuth 提供商

| 提供商 | 文件 | 环境变量 |
|--------|------|----------|
| GitHub | `oauth/github.ts` | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| Google | `oauth/google.ts` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| 微信 | `oauth/wechat.ts` | `WECHAT_APP_ID`, `WECHAT_APP_SECRET` |
| QQ | `oauth/qq.ts` | `QQ_APP_ID`, `QQ_APP_KEY` |
| 企业微信 | `oauth/wework.ts` | `WEWORK_CORP_ID`, `WEWORK_AGENT_ID`, `WEWORK_SECRET` |

## 核心用法

```typescript
// 本地认证
const authService = new LocalAuthService({
  config: { jwt: { secret: "...", expiresIn: "7d" } },
  getUserWithPassword: async (username) => db.user.findFirst(...),
});
const result = await authService.login("user", "pass");

// 认证中间件
const authMiddleware = createAuthMiddleware({
  getTokenFromHeader: (req) => req.headers.authorization?.replace("Bearer ", ""),
  verifyToken: (token) => authService.verifyToken(token),
  getUserById: async (id) => db.user.findUnique(...),
});
```

## OAuth 流程

```
用户 → /api/auth/oauth/:provider → 重定向到 OAuth 提供商
  → 用户授权 → /api/auth/oauth/:provider/callback
  → 创建/查找用户 → 生成 JWT → 重定向到 /auth/callback?token=xxx
```

## 测试

- `src/__tests__/local.test.ts` — 14 个测试用例
